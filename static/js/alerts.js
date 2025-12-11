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

// --- Configuration Logic ---

const modal = document.getElementById('config-modal');

function openConfig() {
    modal.classList.add('open');
    loadConfig();
}

function closeConfig() {
    modal.classList.remove('open');
}

// Close if clicked outside
window.onclick = function (event) {
    if (event.target == modal) {
        closeConfig();
    }
}

async function loadConfig() {
    try {
        const res = await fetch('/api/alerts/config');
        const settings = await res.json();

        // Populate checkboxes
        for (const [key, enabled] of Object.entries(settings)) {
            const el = document.getElementById(`cfg-${key}`);
            if (el) el.checked = enabled;
        }
    } catch (e) {
        console.error("Failed to load config", e);
    }
}

async function saveConfig() {
    const settings = {
        "offline": document.getElementById('cfg-offline').checked,
        "incomplete": document.getElementById('cfg-incomplete').checked,
        "outlier_temperature": document.getElementById('cfg-outlier_temperature').checked,
        "outlier_humidity": document.getElementById('cfg-outlier_humidity').checked,
        "outlier_light": document.getElementById('cfg-outlier_light').checked,
        "outlier_voltage": document.getElementById('cfg-outlier_voltage').checked,
    };

    try {
        await fetch('/api/alerts/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(settings)
        });
        closeConfig();
        // Refresh alerts immediately to reflect changes (e.g. if we turned off a type)
        fetchAndRender();
    } catch (e) {
        console.error("Failed to save config", e);
        alert("Failed to save settings");
    }
}
