// API Base URL
const API_BASE = 'http://localhost:3000/api';

// Chart instances
let weekChart = null;
let timelineChart = null;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    loadStats();
    loadParameters();
    loadVisualization();
    loadLogs();
});

// Tab switching
function showTab(tabName) {
    // Hide all tabs
    document.querySelectorAll('.tab-content').forEach(tab => {
        tab.classList.remove('active');
    });
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('active');
    });

    // Show selected tab
    document.getElementById(tabName).classList.add('active');
    event.target.classList.add('active');
}

// Show notification
function showNotification(message, type = 'success') {
    const notification = document.getElementById('notification');
    notification.textContent = message;
    notification.className = `notification ${type} show`;
    
    setTimeout(() => {
        notification.classList.remove('show');
    }, 3000);
}

// Load statistics
async function loadStats() {
    try {
        const response = await fetch(`${API_BASE}/stats`);
        const data = await response.json();
        
        document.getElementById('totalLogs').textContent = data.totalLogs || '0';
        document.getElementById('firstDate').textContent = data.firstDate || '-';
        document.getElementById('lastDate').textContent = data.lastDate || '-';
        
        // Get current status from last log
        const logsResponse = await fetch(`${API_BASE}/logs?days=1`);
        const logs = await logsResponse.json();
        if (logs.length > 0) {
            const lastLog = logs[logs.length - 1];
            document.getElementById('currentStatus').textContent = 
                lastLog.is_opening ? '📗 Open' : '📕 Dicht';
        }
    } catch (error) {
        console.error('Fout bij laden statistieken:', error);
    }
}

// Load parameters
async function loadParameters() {
    try {
        const response = await fetch(`${API_BASE}/parameters`);
        const params = await response.json();
        
        const form = document.getElementById('paramForm');
        Object.keys(params).forEach(key => {
            const input = form.elements[key];
            if (input) {
                input.value = params[key];
            }
        });
    } catch (error) {
        console.error('Fout bij laden parameters:', error);
        showNotification('Fout bij laden parameters', 'error');
    }
}

// Save parameters
async function saveParameters(event) {
    event.preventDefault();
    
    const form = event.target;
    const formData = new FormData(form);
    const params = {};
    
    for (let [key, value] of formData.entries()) {
        // Convert to appropriate type
        if (key.includes('weight')) {
            params[key] = parseFloat(value);
        } else {
            params[key] = parseInt(value);
        }
    }
    
    try {
        const response = await fetch(`${API_BASE}/parameters`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(params)
        });
        
        const result = await response.json();
        
        if (result.success) {
            showNotification('✅ Parameters succesvol opgeslagen!', 'success');
            // Reload visualization with new parameters
            setTimeout(() => {
                loadVisualization();
            }, 500);
        } else {
            showNotification('❌ Fout bij opslaan parameters', 'error');
        }
    } catch (error) {
        console.error('Fout bij opslaan parameters:', error);
        showNotification('❌ Fout bij opslaan parameters', 'error');
    }
}

// Load visualization
async function loadVisualization() {
    const days = document.getElementById('visualDays')?.value || 30;
    
    try {
        // Load filtered data and predictions in parallel
        const [filteredResponse, predictionsResponse] = await Promise.all([
            fetch(`${API_BASE}/logs/filtered?days=${days}&minDuration=30`),
            fetch(`${API_BASE}/predictions`)
        ]);
        
        const filteredData = await filteredResponse.json();
        const predictions = await predictionsResponse.json();
        
        // Render predictions
        renderPredictions(predictions);
        
        // Render week chart
        renderWeekChart(filteredData, predictions);
        
        // Render timeline
        renderTimeline(filteredData);
        
    } catch (error) {
        console.error('Fout bij laden visualisatie:', error);
        showNotification('Fout bij laden visualisatie', 'error');
    }
}

// Render predictions cards
function renderPredictions(predictions) {
    const container = document.getElementById('predictions');
    const weekDays = ['Zondag', 'Maandag', 'Dinsdag', 'Woensdag', 'Donderdag', 'Vrijdag', 'Zaterdag'];
    
    container.innerHTML = '';
    
    weekDays.forEach((day, index) => {
        const pred = predictions[index];
        const hasData = pred && pred.openTime !== null && pred.closeTime !== null;
        
        const card = document.createElement('div');
        card.className = `prediction-card ${!hasData ? 'no-data' : ''}`;
        
        const openTime = hasData ? minutesToTime(pred.openTime) : '-';
        const closeTime = hasData ? minutesToTime(pred.closeTime) : '-';
        const dataPoints = hasData ? pred.dataPoints : 0;
        
        card.innerHTML = `
            <h4>${day}</h4>
            <div>
                <div class="prediction-time">📗 ${openTime}</div>
                <div class="prediction-time">📕 ${closeTime}</div>
            </div>
            <small>${dataPoints} datapunten</small>
        `;
        
        container.appendChild(card);
    });
}

// Render week chart
function renderWeekChart(filteredData, predictions) {
    const weekDays = ['Zondag', 'Maandag', 'Dinsdag', 'Woensdag', 'Donderdag', 'Vrijdag', 'Zaterdag'];
    
    // Group data by weekday
    const weekData = Array(7).fill(null).map(() => ({ open: [], close: [] }));
    
    Object.entries(filteredData).forEach(([dateKey, data]) => {
        if (data.openTime !== null) weekData[data.weekday].open.push(data.openTime);
        if (data.closeTime !== null) weekData[data.weekday].close.push(data.closeTime);
    });
    
    // Calculate averages
    const avgOpen = weekData.map(d => d.open.length > 0 ? d.open.reduce((a, b) => a + b, 0) / d.open.length : null);
    const avgClose = weekData.map(d => d.close.length > 0 ? d.close.reduce((a, b) => a + b, 0) / d.close.length : null);
    
    // Predicted times
    const predOpen = weekDays.map((_, i) => predictions[i]?.openTime || null);
    const predClose = weekDays.map((_, i) => predictions[i]?.closeTime || null);
    
    const ctx = document.getElementById('weekChart');
    
    if (weekChart) weekChart.destroy();
    
    weekChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: weekDays,
            datasets: [
                {
                    label: 'Gemiddelde Opening',
                    data: avgOpen,
                    borderColor: '#4CAF50',
                    backgroundColor: 'rgba(76, 175, 80, 0.1)',
                    borderWidth: 3,
                    pointRadius: 5,
                    pointHoverRadius: 7,
                    tension: 0.4
                },
                {
                    label: 'Voorspelde Opening',
                    data: predOpen,
                    borderColor: '#81C784',
                    backgroundColor: 'rgba(129, 199, 132, 0.1)',
                    borderWidth: 2,
                    borderDash: [5, 5],
                    pointRadius: 4,
                    tension: 0.4
                },
                {
                    label: 'Gemiddelde Sluiting',
                    data: avgClose,
                    borderColor: '#f44336',
                    backgroundColor: 'rgba(244, 67, 54, 0.1)',
                    borderWidth: 3,
                    pointRadius: 5,
                    pointHoverRadius: 7,
                    tension: 0.4
                },
                {
                    label: 'Voorspelde Sluiting',
                    data: predClose,
                    borderColor: '#E57373',
                    backgroundColor: 'rgba(229, 115, 115, 0.1)',
                    borderWidth: 2,
                    borderDash: [5, 5],
                    pointRadius: 4,
                    tension: 0.4
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                title: {
                    display: true,
                    text: 'Open & Sluit Tijden per Weekdag',
                    font: { size: 16, weight: 'bold' }
                },
                legend: {
                    position: 'bottom',
                    labels: { padding: 15, font: { size: 12 } }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return context.dataset.label + ': ' + minutesToTime(context.parsed.y);
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: false,
                    min: 0,
                    max: 24 * 60,
                    ticks: {
                        callback: function(value) {
                            return minutesToTime(value);
                        },
                        stepSize: 60
                    },
                    title: {
                        display: true,
                        text: 'Tijd'
                    }
                }
            }
        }
    });
}

// Render timeline chart
function renderTimeline(filteredData) {
    const dates = Object.keys(filteredData).sort();
    const openTimes = dates.map(date => filteredData[date].openTime);
    const closeTimes = dates.map(date => filteredData[date].closeTime);
    
    const ctx = document.getElementById('timelineChart');
    
    if (timelineChart) timelineChart.destroy();
    
    timelineChart = new Chart(ctx, {
        type: 'scatter',
        data: {
            datasets: [
                {
                    label: 'Opening',
                    data: dates.map((date, i) => ({ x: date, y: openTimes[i] })),
                    backgroundColor: '#4CAF50',
                    pointRadius: 4,
                    pointHoverRadius: 6
                },
                {
                    label: 'Sluiting',
                    data: dates.map((date, i) => ({ x: date, y: closeTimes[i] })),
                    backgroundColor: '#f44336',
                    pointRadius: 4,
                    pointHoverRadius: 6
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                title: {
                    display: true,
                    text: 'Tijdlijn - Alle Open & Sluit Tijden',
                    font: { size: 16, weight: 'bold' }
                },
                legend: {
                    position: 'bottom'
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return context.dataset.label + ': ' + minutesToTime(context.parsed.y);
                        }
                    }
                }
            },
            scales: {
                x: {
                    type: 'time',
                    time: {
                        unit: 'day',
                        displayFormats: {
                            day: 'dd MMM'
                        }
                    },
                    title: {
                        display: true,
                        text: 'Datum'
                    }
                },
                y: {
                    min: 0,
                    max: 24 * 60,
                    ticks: {
                        callback: function(value) {
                            return minutesToTime(value);
                        },
                        stepSize: 60
                    },
                    title: {
                        display: true,
                        text: 'Tijd'
                    }
                }
            }
        }
    });
}

// Load logs table
async function loadLogs() {
    const days = document.getElementById('dataDays')?.value || 30;
    
    try {
        const response = await fetch(`${API_BASE}/logs?days=${days}`);
        const logs = await response.json();
        
        const tbody = document.getElementById('logsBody');
        tbody.innerHTML = '';
        
        if (logs.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align: center;">Geen logs gevonden</td></tr>';
            return;
        }
        
        const weekDays = ['Zondag', 'Maandag', 'Dinsdag', 'Woensdag', 'Donderdag', 'Vrijdag', 'Zaterdag'];
        
        logs.forEach(log => {
            const date = new Date(log.date_key);
            const weekday = weekDays[date.getDay()];
            
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${log.date_key}</td>
                <td>${log.time_logged}</td>
                <td><span class="badge ${log.is_opening ? 'badge-open' : 'badge-close'}">${log.is_opening ? '📗 Open' : '📕 Dicht'}</span></td>
                <td>${weekday}</td>
            `;
            tbody.appendChild(row);
        });
        
    } catch (error) {
        console.error('Fout bij laden logs:', error);
        showNotification('Fout bij laden logs', 'error');
    }
}

// Helper: Convert minutes to HH:MM
function minutesToTime(minutes) {
    if (minutes === null || minutes === undefined) return '-';
    const h = Math.floor(minutes / 60);
    const m = Math.round(minutes % 60);
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}
