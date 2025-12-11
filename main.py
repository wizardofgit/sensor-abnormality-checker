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
    elif resolution == "day":
        df_res = df.resample("1D").mean()
    else:
        df_res = df.copy()

    # Drop rows only if ALL requested columns are NaN
    # This allows partial data to be plotted (Chart.js handles nulls)
    # df_res = df_res.dropna(how="all", subset=cols)
    # COMMENTED OUT to ensure we send data even if it looks empty (debugging)

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


# --- Alert System ---

alerts = []  # Public list of alerts
active_alerts = {}  # Internal state: (moteid, type) -> alert_dict
alert_history = {}  # (moteid, type) -> last_trigger_timestamp

def check_alerts():
    """
    Re-scan sensors for anomalies.
    - Critical: Offline (>60s), Sensor Error (missing keys or NaN)
    - Warning: Outlier data (>3 std dev)
    """
    global alerts, active_alerts, alert_history
    now = time.time()
    
    # 1. Detect current anomalies
    current_anomalies = [] # list of (moteid, type, msg, level)

    # Check each sensor
    for moteid, status in sensors.items():
        # A) Offline check
        last_seen = status.get("last_seen_epoch", 0)
        if now - last_seen > 60:
            current_anomalies.append((
                moteid, 
                "offline", 
                f"Sensor {moteid} is offline (last seen {int(now - last_seen)}s ago)", 
                "critical"
            ))

        # B) Incomplete data check
        required_keys = ["last_temperature", "last_humidity", "last_light", "last_voltage"]
        # Check for None OR NaN
        missing = []
        for k in required_keys:
            val = status.get(k)
            if val is None or (isinstance(val, float) and pd.isna(val)):
                missing.append(k)
        
        if missing:
            current_anomalies.append((
                moteid, 
                "incomplete", 
                f"Sensor {moteid} has incomplete data: {', '.join(missing)}", 
                "warning"
            ))

        # C) Outlier check (Robust Z-Score)
        if moteid in sensor_data:
            window = 20
            # Minimum difference thresholds to avoid false positives on stable signals
            min_diffs = {
                "temperature": 2.0,
                "humidity": 5.0,
                "light": 50.0,
                "voltage": 0.2
            }
            
            for field in ["temperature", "humidity", "light", "voltage"]:
                vals = sensor_data[moteid][field]
                if len(vals) < 5:
                    continue
                
                recent = vals[-window:]
                series = pd.Series(recent)
                mean = series.mean()
                std = series.std()
                
                if pd.isna(std) or std == 0:
                    continue
                
                current = vals[-1]
                diff = abs(current - mean)
                
                # Condition: > 3 sigma AND > min_diff
                if diff > 3 * std and diff > min_diffs.get(field, 0):
                    current_anomalies.append((
                        moteid, 
                        f"outlier_{field}", 
                        f"Sensor {moteid} {field} outlier: {current:.2f} (mean={mean:.2f}, std={std:.2f})", 
                        "warning"
                    ))

    # 2. Update active_alerts
    updated_keys = set()

    for moteid, type_, msg, level in current_anomalies:
        key = (moteid, type_)
        updated_keys.add(key)
        
        # Expiry duration: 
        # State alerts (offline/incomplete) expire quickly if not re-detected (e.g. 2.5s)
        # Event alerts (outlier) persist longer (e.g. 60s) so they can be seen
        is_event = "outlier" in type_
        expiry_duration = 60 if is_event else 2.5
        
        if key in active_alerts:
            # Update existing
            active_alerts[key]["msg"] = msg
            active_alerts[key]["expires"] = now + expiry_duration
            # Keep original timestamp for stability
        else:
            # New alert logic with cooldown
            # Check history
            last_trigger = alert_history.get(key, 0)
            
            # If triggered recently (< 30s), reuse the old timestamp (suppress popup)
            # Otherwise, use 'now' (trigger popup)
            if now - last_trigger < 30:
                ts = last_trigger
            else:
                ts = now
                alert_history[key] = now

            active_alerts[key] = {
                "level": level,
                "moteid": moteid,
                "type": type_,
                "msg": msg,
                "timestamp": ts,
                "expires": now + expiry_duration
            }

    # 3. Cleanup expired alerts
    to_remove = []
    for k, v in active_alerts.items():
        if now > v["expires"]:
            to_remove.append(k)
            
    for k in to_remove:
        del active_alerts[k]

    # 4. Publish to global list
    # Sort by timestamp ASC (oldest first)
    alerts = sorted(list(active_alerts.values()), key=lambda x: x["timestamp"])

def background_alert_checker():
    while True:
        try:
            check_alerts()
        except Exception as e:
            print(f"Error in alert checker: {e}")
        sleep(2.0)

Thread(target=background_alert_checker, daemon=True).start()

@app.route("/alerts")
def alerts_page():
    return render_template("alerts.html")

@app.route("/api/alerts")
def api_alerts():
    return jsonify(alerts)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True, threaded=True)