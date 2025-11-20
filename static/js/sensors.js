// ---- Map init ----
const map = L.map('map', { zoomControl: true }).setView([51.11, 17.03], 12);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© OpenStreetMap contributors'
}).addTo(map);

// Keep markers by moteid
const markers = new Map();

// Helpers
function isStale(lastSeenEpochSec) {
  const now = Date.now() / 1000;
  return (now - lastSeenEpochSec) > 60; // stale if > 1 minute
}

function fmt(v) {
  return (v === null || v === undefined) ? '—' : Number(v).toFixed(2);
}

function markerHtml(sensor) {
  const stale = isStale(sensor.last_seen_epoch);
  const bg = stale ? '#ef4444' : '#22c55e';       // red / green
  const border = stale ? '#b91c1c' : '#15803d';
  const id = sensor.moteid;
  const value = fmt(sensor.last_temperature); // show temp inside circle (change if needed)

  return `
    <div style="
      width: 54px; height: 54px;
      display:flex; flex-direction:column; align-items:center; justify-content:center;
      border-radius: 9999px; background:${bg}; color: #fff; border: 2px solid ${border};
      font-family: 'Inter', sans-serif; font-size: 11px; line-height:1.1; text-align:center;
      box-shadow: 0 1px 6px rgba(0,0,0,.25);
    ">
      <div style="font-weight:700;">${id}</div>
      <div style="opacity:.9">${value}</div>
    </div>
  `;
}

function popupHtml(s) {
  const staleStr = isStale(s.last_seen_epoch) ? '❌ stale (>60s)' : '✅ live';
  return `
    <div style="font-family:'Inter',sans-serif;font-size:13px;">
      <div><strong>Sensor:</strong> ${s.moteid}</div>
      <div><strong>Status:</strong> ${staleStr}</div>
      <div><strong>Last update:</strong> ${new Date(s.last_seen_epoch * 1000).toLocaleTimeString()}</div>
      <hr style="border:none;border-top:1px solid #ddd;margin:6px 0;" />
      <div><strong>Temp:</strong> ${fmt(s.last_temperature)}</div>
      <div><strong>Humidity:</strong> ${fmt(s.last_humidity)}</div>
      <div><strong>Light:</strong> ${fmt(s.last_light)}</div>
      <div><strong>Voltage:</strong> ${fmt(s.last_voltage)}</div>
    </div>
  `;
}

function upsertMarker(sensor) {
  if (sensor.lat == null || sensor.lon == null) return;

  const icon = L.divIcon({
    className: 'sensor-div-icon',
    html: markerHtml(sensor),
    iconSize: [54, 54],
    iconAnchor: [27, 27],
  });

  const existing = markers.get(sensor.moteid);
  if (existing) {
    existing.setLatLng([sensor.lat, sensor.lon]);
    existing.setIcon(icon);
    existing.bindPopup(popupHtml(sensor));
  } else {
    const m = L.marker([sensor.lat, sensor.lon], { icon })
      .addTo(map)
      .bindPopup(popupHtml(sensor));
    markers.set(sensor.moteid, m);
  }
}

async function refreshSensors() {
  try {
    const res = await fetch('/api/sensors/status');
    if (!res.ok) throw new Error('Bad response');
    const list = await res.json();
    list.forEach(upsertMarker);
  } catch (e) {
    console.error('refreshSensors failed:', e);
  }
}

setInterval(refreshSensors, 5000);
refreshSensors();
