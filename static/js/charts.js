let chartInstance = null;
let updating = false;

// Stable color map (never changes)
const colorMap = {
    temperature: "rgb(255,99,132)",
    humidity: "rgb(54,162,235)",
    light: "rgb(255,205,86)",
    voltage: "rgb(75,192,192)"
};

async function loadMoteList() {
    const res = await fetch("/api/sensors/list");
    const motes = await res.json();

    const select = document.getElementById("moteSelect");
    select.innerHTML = "";

    motes.forEach(m => {
        const opt = document.createElement("option");
        opt.value = m;
        opt.textContent = "Mote " + m;
        select.appendChild(opt);
    });

    if (motes.length > 0) {
        select.value = motes[0];
    }
}

async function fetchSeries(moteid, columns, resolution) {
    const colStr = columns.join(",");
    const url = `/api/sensors/${moteid}/series?cols=${colStr}&res=${resolution}`;

    const res = await fetch(url);
    return await res.json();
}

function buildDatasets(seriesData, columns) {
    const timestamps = seriesData.timestamps;
    const series = seriesData.series;

    const datasets = [];

    columns.forEach(col => {
        const yVals = series[col];

        const points = timestamps.map((ts, i) => ({
            x: ts * 1000,   // seconds → ms for Chart.js time scale
            y: yVals[i] ?? null,
        }));

        datasets.push({
            label: col,
            data: points,
            borderColor: colorMap[col],
            backgroundColor: "transparent",
            borderWidth: 2,
            pointRadius: 0,
            tension: 0.2
        });
    });

    return datasets;
}

function createChart(datasets) {
    const ctx = document.getElementById("chart").getContext("2d");

    chartInstance = new Chart(ctx, {
        type: "line",
        data: { datasets },
        options: {
            responsive: true,
            animation: false,
            parsing: false,
            scales: {
                x: {
                    type: "time",
                    time: {
                        unit: "minute",
                        tooltipFormat: "yyyy-MM-dd HH:mm:ss",
                        displayFormats: {
                            millisecond: "yyyy-MM-dd HH:mm:ss",
                            second: "yyyy-MM-dd HH:mm:ss",
                            minute: "yyyy-MM-dd HH:mm",
                            hour: "yyyy-MM-dd HH:mm",
                            day: "yyyy-MM-dd",
                        }
                    }
                }
            }
        }
    });

    chartInstance.update('none');
}

function updateChartData(datasets) {
    chartInstance.data.datasets = datasets;
    chartInstance.update('none');
}

async function updateChart() {
    if (updating) return;  // prevent overlapping refreshes
    updating = true;

    const moteid = document.getElementById("moteSelect").value;

    const selectedColumns = Array.from(
        document.getElementById("columnSelect").selectedOptions
    ).map(opt => opt.value);

    const resolution = document.getElementById("resolutionSelect").value;

    const seriesData = await fetchSeries(moteid, selectedColumns, resolution);

    const datasets = buildDatasets(seriesData, selectedColumns);

    if (!chartInstance) {
        createChart(datasets);
    } else {
        updateChartData(datasets);
    }

    updating = false;
}

document.addEventListener("DOMContentLoaded", async () => {
    await loadMoteList();
    await updateChart();

    document.getElementById("refreshBtn").addEventListener("click", updateChart);

    // smooth auto-refresh
    setTimeout(() => {
        setInterval(updateChart, 5000);
    }, 1000);
});
