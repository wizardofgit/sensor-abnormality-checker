const seenAlerts = new Map();

function createPopupContainer() {
    let container = document.getElementById('notification-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'notification-container';
        container.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 9999;
            display: flex;
            flex-direction: column;
            gap: 10px;
            width: 300px;
        `;
        document.body.appendChild(container);
    }
    return container;
}

function showPopup(alert) {
    const container = createPopupContainer();

    const popup = document.createElement('div');
    const isCritical = alert.level === 'critical';
    const bgColor = isCritical ? '#fff5f5' : '#fffaf0';
    const borderColor = isCritical ? '#fc8181' : '#fbd38d';
    const textColor = isCritical ? '#c53030' : '#c05621';
    const icon = isCritical ? '🚨' : '⚠️';

    popup.style.cssText = `
        background: ${bgColor};
        border-left: 4px solid ${borderColor};
        padding: 16px;
        border-radius: 4px;
        box-shadow: 0 4px 6px rgba(0,0,0,0.1);
        position: relative;
        overflow: hidden;
        animation: slideIn 0.3s ease-out;
        font-family: 'Inter', sans-serif;
        cursor: pointer;
    `;

    popup.onclick = (e) => {
        // Don't redirect if clicking the close button
        if (e.target.tagName === 'BUTTON') return;
        window.location.href = '/alerts';
    };

    popup.innerHTML = `
        <div style="display: flex; align-items: start; gap: 12px;">
            <span style="font-size: 20px;">${icon}</span>
            <div style="flex: 1;">
                <h4 style="margin: 0 0 4px 0; color: ${textColor}; font-size: 14px; font-weight: 600;">
                    ${isCritical ? 'Critical Alert' : 'Warning'}
                </h4>
                <p style="margin: 0; color: #4a5568; font-size: 13px; line-height: 1.4;">
                    ${alert.msg}
                </p>
            </div>
            <button onclick="event.stopPropagation(); this.parentElement.parentElement.remove()" style="background: none; border: none; cursor: pointer; color: #a0aec0; font-size: 18px; padding: 0;">&times;</button>
        </div>
        <div style="position: absolute; bottom: 0; left: 0; height: 3px; background: ${borderColor}; width: 100%; animation: shrink 5s linear forwards;"></div>
    `;

    // Add keyframes if not exists
    if (!document.getElementById('notification-styles')) {
        const style = document.createElement('style');
        style.id = 'notification-styles';
        style.textContent = `
            @keyframes slideIn {
                from { transform: translateX(100%); opacity: 0; }
                to { transform: translateX(0); opacity: 1; }
            }
            @keyframes shrink {
                from { width: 100%; }
                to { width: 0%; }
            }
        `;
        document.head.appendChild(style);
    }

    container.appendChild(popup);

    // Auto remove
    setTimeout(() => {
        popup.style.animation = 'slideIn 0.3s ease-in reverse';
        setTimeout(() => popup.remove(), 300);
    }, 5000);
}

async function checkAlerts() {
    try {
        const res = await fetch('/api/alerts');
        if (!res.ok) return;
        const alerts = await res.json();

        const now = Date.now() / 1000;

        alerts.forEach(alert => {
            const key = `${alert.moteid}:${alert.type}`;
            const lastTs = seenAlerts.get(key);

            // If new or updated timestamp
            if (!lastTs || alert.timestamp > lastTs) {
                seenAlerts.set(key, alert.timestamp);

                // Only show popup if it's recent (within last 10 seconds)
                if (now - alert.timestamp < 10) {
                    showPopup(alert);
                }
            }
        });
    } catch (e) {
        console.error('Alert check failed:', e);
    }
}

// Start polling
setInterval(checkAlerts, 2000);
checkAlerts();
