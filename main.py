from time import sleep
import time
import pandas as pd
from queue import Queue
from threading import Thread
import flask
from flask import render_template, jsonify, request
import csv

mote_coords = {}
with open("loc.csv", newline="") as f:
    reader = csv.DictReader(f)
    for row in reader:
        moteid = int(row["moteid"])
        lat = float(row["lat"])
        lon = float(row["lon"])
        mote_coords[moteid] = (lat, lon)

default_latlon = (51.1079, 17.0385)

columns = ['date', 'time', 'epoch', 'moteid',
           'temperature', 'humidity', 'light', 'voltage']

data = pd.read_csv("data.csv", names=columns, header=None, sep=' ')

# Combine date+time into datetime
data["datetime"] = pd.to_datetime(
    data["date"] + " " + data["time"],
    errors="coerce"
)

# Drop unparseable rows
data = data.dropna(subset=["datetime"])

# Sort chronologically
data = data.sort_values("datetime").reset_index(drop=True)

data_queue = Queue()
sensors = {}       # last known status per mote
sensor_data = {}   # historical series per mote


def add_to_queue(data, queue, batch_size=1000, tick_delay=1.0, loop=True):
    n = len(data)
    while True:
        for start in range(0, n, batch_size):
            batch = data.iloc[start:start + batch_size]
            for _, row in batch.iterrows():
                queue.put(row)
            sleep(tick_delay)
        if not loop:
            break

Thread(target=add_to_queue, args=(data, data_queue), daemon=True).start()


def process_queue(queue):
    while True:
        if queue.empty():
            sleep(0.05)
            continue

        row = queue.get()
        try:
            moteid = int(row["moteid"])
        except ValueError:
            continue
        now_ts = time.time()

        # Coordinates
        lat, lon = mote_coords.get(moteid, default_latlon)

        # Update latest status
        sensors[moteid] = {
            "moteid": moteid,
            "last_temperature": float(row["temperature"]),
            "last_humidity": float(row["humidity"]),
            "last_light": float(row["light"]),
            "last_voltage": float(row["voltage"]),
            "last_seen_epoch": now_ts,
            "lat": lat,
            "lon": lon,
        }

        # Init per-sensor buffer
        if moteid not in sensor_data:
            sensor_data[moteid] = {
                "timestamp": [],
                "temperature": [],
                "humidity": [],
                "light": [],
                "voltage": [],
            }

        # Append values
        ts = row["datetime"].timestamp()

        sensor_data[moteid]["timestamp"].append(ts)
        sensor_data[moteid]["temperature"].append(float(row["temperature"]))
        sensor_data[moteid]["humidity"].append(float(row["humidity"]))
        sensor_data[moteid]["light"].append(float(row["light"]))
        sensor_data[moteid]["voltage"].append(float(row["voltage"]))

Thread(target=process_queue, args=(data_queue,), daemon=True).start()


app = flask.Flask(__name__)

@app.route("/")
def home():
    return render_template("home.html")

@app.route("/sensors")
def sensors_page():
    return render_template("sensors.html")

@app.route("/charts")
def charts_page():
    return render_template("charts.html")

@app.route("/api/sensors/list")
def api_sensor_list():
    return jsonify(sorted(list(sensors.keys())))

@app.route("/api/sensors/status")
def api_sensor_status():
    payload = []

    for moteid, s in sensors.items():
        # Convert NaN → None
        fixed = {k: (None if isinstance(v, float) and pd.isna(v) else v)
                 for k, v in s.items()}

        payload.append(fixed)

    return jsonify(payload)

@app.route("/api/sensors/<int:moteid>/series")
def api_sensor_series(moteid):
    """Return aligned time-series data for one sensor."""

    if moteid not in sensor_data:
        return jsonify({"timestamps": [], "series": {}})

    cols = request.args.get("cols", "temperature").split(",")
    resolution = request.args.get("res", "raw")

    # Build DataFrame with unified timestamp index
    df = pd.DataFrame({
        "ts": pd.to_datetime(sensor_data[moteid]["timestamp"], unit="s")
    }).set_index("ts")

    # Add columns
    for col in cols:
        df[col] = sensor_data[moteid][col]

    # Resample all columns TOGETHER
    if resolution == "raw":
        df_res = df.copy()
    elif resolution == "min":
        df_res = df.resample("1min").mean()
    elif resolution == "hour":
        df_res = df.resample("1h").mean()
    else:
        df_res = df.copy()

    # Drop rows with missing values
    df_res = df_res.dropna(how="any")

    # Extract timestamps + aligned series
    timestamps = df_res.index.astype(int) // 10 ** 9

    series = {}
    for col in cols:
        values = df_res[col].tolist()
        # convert NaN → None
        values = [None if (isinstance(v, float) and pd.isna(v)) else v for v in values]
        series[col] = values

    return jsonify({
        "timestamps": timestamps.tolist(),
        "series": series
    })

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True, threaded=True)