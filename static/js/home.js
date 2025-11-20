document.addEventListener("DOMContentLoaded", async () => {
    const loadingEl = document.getElementById("loading-stats");
    const contentEl = document.getElementById("stats-content");
    const totalEl = document.getElementById("total-sensors");
    const activeEl = document.getElementById("active-sensors");
    const avgTempEl = document.getElementById("avg-temp");

    try {
        const res = await fetch("/api/sensors/status");
        const data = await res.json();

        // Calculate stats
        const totalSensors = data.length;

        // Consider active if seen in the last 60 seconds (matching map logic)
        const now = Date.now() / 1000;
        const activeSensors = data.filter(s => s.last_seen_epoch && (now - s.last_seen_epoch) < 60).length;

        // Calculate average temperature
        const validTemps = data.map(s => s.last_temperature).filter(t => t !== null && t !== undefined);
        const avgTemp = validTemps.length > 0
            ? (validTemps.reduce((a, b) => a + b, 0) / validTemps.length).toFixed(1) + "°C"
            : "N/A";

        // Update UI
        totalEl.textContent = totalSensors;
        activeEl.textContent = activeSensors;
        avgTempEl.textContent = avgTemp;

        loadingEl.style.display = "none";
        contentEl.style.display = "grid";

    } catch (e) {
        console.error("Failed to load system stats:", e);
        loadingEl.textContent = "Failed to load system status.";
        loadingEl.style.color = "red";
    }
});
