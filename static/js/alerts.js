function renderAlerts(alerts) {
    const criticalContainer = document.getElementById('critical-alerts');
    const warningContainer = document.getElementById('warning-alerts');

    const critical = alerts.filter(a => a.level === 'critical');
    const warning = alerts.filter(a => a.level === 'warning');

    function createCard(alert) {
        const date = new Date(alert.timestamp * 1000);
        const timeStr = date.toLocaleTimeString();

        return `
            <div class="alert-card ${alert.level}">
                <div class="alert-content">
                    <h3>Sensor ${alert.moteid}: ${alert.type.toUpperCase()}</h3>
                    <p>${alert.msg}</p>
                </div>
                <div class="alert-time">
                    ${timeStr}
                </div>
            </div>
        `;
    }

    if (critical.length === 0) {
        criticalContainer.innerHTML = '<div class="empty-state">No critical errors found. System is healthy.</div>';
    } else {
        criticalContainer.innerHTML = critical.map(createCard).join('');
    }

    if (warning.length === 0) {
        warningContainer.innerHTML = '<div class="empty-state">No warnings found.</div>';
    } else {
        warningContainer.innerHTML = warning.map(createCard).join('');
    }
}

async function fetchAndRender() {
    try {
        const res = await fetch('/api/alerts');
        const alerts = await res.json();
        renderAlerts(alerts);
    } catch (e) {
        console.error(e);
    }
}

// Poll every 2 seconds
setInterval(fetchAndRender, 2000);
fetchAndRender();
