const moteidSelect = document.getElementById('moteidSelect');
const windowSelect = document.getElementById('windowSelect');
const columnsSelect = document.getElementById('columnsSelect');
const applyBtn = document.getElementById('applyFilters');

const ctx = document.getElementById('chart');
let chart;

// Initialize chart
function ensureChart(labels = [], seriesDict = {}) {
  const datasets = Object.keys(seriesDict).map((col) => ({
    label: col,
    data: seriesDict[col],
    borderWidth: 2,
    tension: 0.2,
    pointRadius: 0,
  }));

  if (chart) {
    chart.data.labels = labels;
    chart.data.datasets = datasets;
    chart.update();
    return chart;
  }

  chart = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets },
    options: {
      animation: false,
      responsive: true,
      scales: {
        x: {
          title: { display: true, text: "Epoch #" },
        },
        y: {
          beginAtZero: false,
          title: { display: true, text: "Value" }
        }
      },
      plugins: { legend: { position: 'bottom' } }
    }
  });
  return chart;
}

// Populate moteid list
async function loadMoteIds() {
  const res = await fetch('/api/sensors/list');
  const ids = await res.json();
  moteidSelect.innerHTML = '';
  ids.forEach(id => {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = id;
    moteidSelect.appendChild(opt);
  });
}

// Default chart columns
const ALL_COLS = ['temperature', 'humidity', 'light', 'voltage'];

function setDefaultColumns() {
  columnsSelect.innerHTML = '';
  ALL_COLS.forEach(col => {
    const opt = document.createElement('option');
    opt.value = col;
    opt.textContent = col;
    columnsSelect.appendChild(opt);
  });
  // Default = temperature selected
  [...columnsSelect.options].forEach(o => {
    o.selected = (o.value === 'temperature');
  });
}

// Selected columns helper
function getSelectedColumns() {
  return [...columnsSelect.selectedOptions].map(o => o.value);
}

async function fetchSeries() {
  const moteid = moteidSelect.value;
  const windowVal = windowSelect.value;
  const cols = getSelectedColumns();

  if (!moteid || cols.length === 0) return;

  const params = new URLSearchParams({
    window: windowVal,
    cols: cols.join(','),
  });

  const res = await fetch(`/api/sensors/${moteid}/series?` + params.toString());
  if (!res.ok) return;

  // { epochs: [...], series: { temperature:[], humidity:[], ... } }
  const payload = await res.json();
  const epochs = payload.epochs;
  const series = payload.series;

  ensureChart(epochs, series);
}

// Polling
let pollHandle = null;

function startPolling() {
  if (pollHandle) clearInterval(pollHandle);
  pollHandle = setInterval(fetchSeries, 2000);
}

applyBtn.addEventListener('click', fetchSeries);

// Init
(async function init() {
  await loadMoteIds();
  setDefaultColumns();
  await fetchSeries();
  startPolling();
})();
