let chartInstance = null;
let updating = false;

// Improved color palette
const colorMap = {
    temperature: "rgb(255, 99, 132)",   // Red
    humidity: "rgb(54, 162, 235)",      // Blue
    light: "rgb(255, 206, 86)",         // Yellow
    voltage: "rgb(75, 192, 192)"        // Teal
};

// Axis configuration for each metric
const axisConfig = {
    temperature: {
        id: 'y-temp',
        type: 'linear',
        position: 'left',
        title: { display: true, text: 'Temperature (°C)' },
        grid: { drawOnChartArea: true } // Main grid
    },
    humidity: {
        id: 'y-hum',
        type: 'linear',
        position: 'right',
        title: { display: true, text: 'Humidity (%)' },
        grid: { drawOnChartArea: false }
    },
    light: {
        id: 'y-light',
        type: 'linear',
        position: 'right',
        title: { display: true, text: 'Light (Lux)' },
        grid: { drawOnChartArea: false }
    },
    voltage: {
        id: 'y-volt',
        type: 'linear',
        position: 'left',
        title: { display: true, text: 'Voltage (V)' },
        grid: { drawOnChartArea: false }
    }
};

function showLoading(show) {
    const el = document.getElementById("loading");
    if (el) el.style.display = show ? "flex" : "none";
}

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
            x: ts * 1000,   // seconds → ms for Chart.js
            y: yVals[i] ?? null,
        }));

        datasets.push({
            label: col.charAt(0).toUpperCase() + col.slice(1), // Capitalize
            data: points,
            borderColor: colorMap[col],
            backgroundColor: colorMap[col],
            borderWidth: 2,
            pointRadius: 0,
            pointHoverRadius: 4,
            tension: 0.3, // Smoother lines
            yAxisID: axisConfig[col] ? axisConfig[col].id : 'y',
            spanGaps: true
        });
    });

    return datasets;
}

function createChart(datasets, columns) {
    const ctx = document.getElementById("chart").getContext("2d");

    // Dynamically build scales based on selected columns
    const scales = {
        x: {
            type: "time",
            time: {
                tooltipFormat: "yyyy-MM-dd HH:mm:ss",
                displayFormats: {
                    millisecond: "HH:mm:ss.SSS",
                    second: "HH:mm:ss",
                    minute: "HH:mm",
                    hour: "HH:mm",
                    day: "MMM dd",
                }
            },
            title: { display: true, text: 'Time' },
            grid: { color: '#e2e8f0' },
            ticks: {
                maxRotation: 0,
                autoSkip: true,
                callback: function (val, index, ticks) {
                    // Get the timestamp for this tick
                    const tickDate = new Date(this.getLabelForValue(val));
                    const tickTime = tickDate.getHours() + ':' + String(tickDate.getMinutes()).padStart(2, '0');

                    // Always show time
                    let label = tickTime;

                    // Show date if it's the first tick or if the day changed from the previous tick
                    if (index === 0) {
                        const dateStr = tickDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                        return [dateStr, label]; // Multiline label
                    } else {
                        // Use the 'ticks' array passed to the callback
                        if (index > 0 && ticks[index - 1]) {
                            const prevVal = ticks[index - 1].value;
                            const prevDate = new Date(prevVal);
                            if (prevDate.getDate() !== tickDate.getDate()) {
                                const dateStr = tickDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                                return [dateStr, label];
                            }
                        }
                    }
                    return label;
                }
            }
        }
    };

    // Add Y axes for selected columns
    columns.forEach(col => {
        if (axisConfig[col]) {
            scales[axisConfig[col].id] = axisConfig[col];
        }
    });

    chartInstance = new Chart(ctx, {
        type: "line",
        data: { datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            interaction: {
                mode: 'index',
                intersect: false,
            },
            plugins: {
                legend: {
                    position: 'top',
                    labels: {
                        usePointStyle: true,
                        padding: 20,
                        font: { family: "'Inter', sans-serif", size: 12 }
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(255, 255, 255, 0.9)',
                    titleColor: '#2d3748',
                    bodyColor: '#2d3748',
                    borderColor: '#e2e8f0',
                    borderWidth: 1,
                    padding: 10,
                    boxPadding: 4,
                    usePointStyle: true,
                    callbacks: {
                        label: function (context) {
                            let label = context.dataset.label || '';
                            if (label) {
                                label += ': ';
                            }
                            if (context.parsed.y !== null) {
                                label += context.parsed.y.toFixed(2);
                            }
                            return label;
                        }
                    }
                }
            },
            scales: scales
        }
    });
}

function updateChartData(datasets, columns) {
    chartInstance.data.datasets = datasets;

    // Update scales if columns changed
    const currentScaleIds = Object.keys(chartInstance.options.scales);
    const newScaleIds = ['x', ...columns.map(c => axisConfig[c]?.id).filter(Boolean)];

    // Simple check if scales need update (length or content mismatch)
    const needsScaleUpdate = currentScaleIds.length !== newScaleIds.length ||
        !newScaleIds.every(id => currentScaleIds.includes(id));

    if (needsScaleUpdate) {
        chartInstance.destroy();
        createChart(datasets, columns);
    } else {
        chartInstance.update('none');
    }
}

async function updateChart(silent = false) {
    if (updating) return;
    updating = true;
    if (!silent) showLoading(true);

    try {
        const moteid = document.getElementById("moteSelect").value;
        if (!moteid) return; // No mote selected yet

        // Get selected columns from active toggle buttons
        const selectedColumns = Array.from(
            document.querySelectorAll(".toggle-btn.active")
        ).map(btn => btn.dataset.value);

        // Ensure at least one metric is selected
        if (selectedColumns.length === 0) {
            // Optional: show a message or just clear the chart
            if (chartInstance) {
                chartInstance.data.datasets = [];
                chartInstance.update();
            }
            return;
        }

        const resolution = document.getElementById("resolutionSelect").value;

        const seriesData = await fetchSeries(moteid, selectedColumns, resolution);
        const datasets = buildDatasets(seriesData, selectedColumns);

        if (!chartInstance) {
            createChart(datasets, selectedColumns);
        } else {
            updateChartData(datasets, selectedColumns);
        }
    } catch (e) {
        console.error("Failed to update chart:", e);
    } finally {
        if (!silent) showLoading(false);
        updating = false;
    }
}

document.addEventListener("DOMContentLoaded", async () => {
    try {
        await loadMoteList();
    } catch (e) {
        console.error("Error loading motes:", e);
    }

    // Initialize toggle buttons
    document.querySelectorAll(".toggle-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            btn.classList.toggle("active");
            updateChart(false); // Trigger update immediately
        });
    });

    await updateChart();

    document.getElementById("refreshBtn").addEventListener("click", () => updateChart(false));

    // Instant updates when controls change
    document.getElementById("moteSelect").addEventListener("change", () => updateChart(false));
    document.getElementById("resolutionSelect").addEventListener("change", () => updateChart(false));

    // Auto-refresh every 2 seconds (silent)
    setInterval(() => updateChart(true), 2000);
});
