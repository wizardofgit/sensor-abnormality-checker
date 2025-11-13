from time import sleep, time
import pandas as pd
from queue import Queue
from threading import Thread
import flask
from flask import render_template, jsonify, request

try:
    assert open("data.csv")
except FileNotFoundError:
    print("The file 'data.csv' was not found.")
except:
    print("An unexpected error occurred while trying to open the file.")

columns = ['date', 'time', 'epoch', 'moteid', 'temperature', 'humidity', 'light', 'voltage']
data = pd.read_csv("data.csv", names=columns, header=None, sep=' ')

# create global queue
data_queue = Queue()

# create thread to add to queue
def add_to_queue(data, queue, batch_size=1000, tick_delay=1.0, loop=False):
    """
    Push data to queue in batches of `batch_size`.
    after each batch, wait `tick_delay` seconds.
    """
    n = len(data)

    while True:
        for start in range(0, n, batch_size):
            batch = data.iloc[start:start+batch_size]

            for _, row in batch.iterrows():
                queue.put(row)

            # One tick ends here
            sleep(tick_delay)

        if not loop:
            break

queue_thread = Thread(
    target=add_to_queue,
    args=(data, data_queue),
    kwargs={"batch_size": 1000, "tick_delay": 1.0, "loop": True},
    daemon=True
).start()

# create thread to process data from queue
sensors = {}
sensor_data = {}
def process_queue(queue, sensors):
    while True:
        if not queue.empty():
            row = queue.get()

            moteid = int(row['moteid'])
            now_epoch = time()

            sensors[moteid] = {
                'last_date': row['date'],
                'last_time': row['time'],
                'last_temperature': float(row['temperature']),
                'last_light': float(row['light']),
                'last_humidity': float(row['humidity']),
                'last_voltage': float(row['voltage']),
                'last_seen_epoch': now_epoch,
                # Optional: if you have coordinates per sensor, add them here
                'lat': row.get('lat', None),
                'lon': row.get('lon', None),
            }

            if moteid not in sensor_data:
                sensor_data[moteid] = {
                    'epoch': [],
                    'temperature': [],
                    'light': [],
                    'humidity': [],
                    'voltage': [],
                }

            sensor_data[moteid]['epoch'].append(now_epoch)
            sensor_data[moteid]['temperature'].append(float(row['temperature']))
            sensor_data[moteid]['light'].append(float(row['light']))
            sensor_data[moteid]['humidity'].append(float(row['humidity']))
            sensor_data[moteid]['voltage'].append(float(row['voltage']))

        else:
            sleep(0.05)

sensors_thread = Thread(target=process_queue, args=(data_queue, sensors)).start()

# create flask app to serve data from queue
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
def api_list_sensors():
    return jsonify(sorted(list(sensors.keys())))

# ---- API: status for map (green/red via last_seen_epoch) ----
@app.route("/api/sensors/status")
def api_sensors_status():
    # Choose which metric to show inside the circle (here: temperature)
    payload = []
    for moteid, s in sensors.items():
        payload.append({
            "moteid": moteid,
            "lat": s.get("lat"),     # provide coords if you have them
            "lon": s.get("lon"),
            "last_seen_epoch": s.get("last_seen_epoch"),
            "last_temperature": s.get("last_temperature"),
            "last_humidity": s.get("last_humidity"),
            "last_light": s.get("last_light"),
            "last_voltage": s.get("last_voltage"),
            "last_value": s.get("last_temperature"),
        })
    return jsonify(payload)

# ---- API: time series with filters ----
@app.route("/api/sensors/<int:moteid>/series")
def api_sensor_series(moteid):
    window = request.args.get("window", "15m")
    cols = request.args.get("cols", "temperature").split(",")

    if moteid not in sensor_data:
        return jsonify({"timestamps": [], "series": {c: [] for c in cols}})

    # Parse window
    seconds = 900
    try:
        if window.endswith('m'):
            seconds = int(window[:-1]) * 60
        elif window.endswith('h'):
            seconds = int(window[:-1]) * 3600
        elif window.endswith('d'):
            seconds = int(window[:-1]) * 86400
    except:
        pass

    now = time()
    epochs = sensor_data[moteid]['epoch']
    start_idx = 0
    # Find first index within window
    for i in range(len(epochs) - 1, -1, -1):
        if now - epochs[i] <= seconds:
            start_idx = i
        else:
            break

    timestamps = epochs[start_idx:]
    series = {}
    for c in cols:
        if c not in sensor_data[moteid]:
            series[c] = []
        else:
            series[c] = sensor_data[moteid][c][start_idx:]

    return jsonify({"timestamps": timestamps, "series": series})

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True, threaded=True)