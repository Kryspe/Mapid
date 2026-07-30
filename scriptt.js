// =============================================================================
// Mapid LIVE — scriptt.js (Plný rendering a vyhledávání pro 750+ vozidel)
// =============================================================================

const API_BASE_URL = window.MAPID_API_BASE || "http://127.0.0.1:5000";

const CATEGORY_CONFIG = {
    tram: { label: "Tramvaj", color: "#ef4444" },
    bus: { label: "Autobus", color: "#3b82f6" },
    metro: { label: "Metro", color: "#22c55e" },
    train: { label: "Vlak", color: "#a855f7" },
    trolleybus: { label: "Trolejbus", color: "#eab308" }
};

let mapInstance = null;
let vehicleLayerGroup = null;
let routeLayerGroup = null;
let currentVehicles = [];
const activeMarkers = new Map();
const activeFilters = new Set(Object.keys(CATEGORY_CONFIG));
let searchQuery = "";
let chatHistory = [];

document.addEventListener("DOMContentLoaded", () => {
    initLeafletMap();
    buildFilterButtons();
    setupEventListeners();

    fetchLiveVehicles();
    fetchDisruptionsData();

    setInterval(fetchLiveVehicles, 2000);
    setInterval(fetchDisruptionsData, 60000);
});

function initLeafletMap() {
    mapInstance = L.map("map", { zoomControl: false, preferCanvas: true }).setView([50.083, 14.425], 11);

    L.control.zoom({ position: "topright" }).addTo(mapInstance);

    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
        attribution: "&copy; <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap</a> &copy; <a href='https://carto.com/'>CARTO</a>",
        maxZoom: 19,
        subdomains: "abcd"
    }).addTo(mapInstance);

    vehicleLayerGroup = L.layerGroup().addTo(mapInstance);
    routeLayerGroup = L.layerGroup().addTo(mapInstance);
}

function buildFilterButtons() {
    const container = document.getElementById("filter-container");
    container.innerHTML = "";

    Object.entries(CATEGORY_CONFIG).forEach(([typeKey, config]) => {
        const btn = document.createElement("button");
        btn.className = "filter-btn active";
        btn.dataset.category = typeKey;
        btn.innerHTML = `
            <span class="filter-color-dot" style="background:${config.color}"></span>
            <span>${config.label}</span>
        `;
        btn.addEventListener("click", () => toggleCategoryFilter(typeKey, btn));
        container.appendChild(btn);
    });
}

function toggleCategoryFilter(category, btnElement) {
    if (activeFilters.has(category)) {
        activeFilters.delete(category);
        btnElement.classList.remove("active");
    } else {
        activeFilters.add(category);
        btnElement.classList.add("active");
    }
    renderVehiclesOnMap();
}

function setupEventListeners() {
    document.getElementById("search-input").addEventListener("input", (e) => {
        searchQuery = e.target.value.trim().toLowerCase();
        renderVehiclesOnMap();
    });

    document.getElementById("trip-panel-close").addEventListener("click", () => {
        document.getElementById("trip-panel").classList.remove("open");
    });

    document.getElementById("disruptions-toggle").addEventListener("click", () => {
        document.getElementById("disruptions-panel").classList.toggle("open");
    });
    document.getElementById("disruptions-close").addEventListener("click", () => {
        document.getElementById("disruptions-panel").classList.remove("open");
    });

    document.getElementById("chat-toggle").addEventListener("click", () => {
        document.getElementById("chat-panel").classList.toggle("open");
    });
    document.getElementById("chat-close").addEventListener("click", () => {
        document.getElementById("chat-panel").classList.remove("open");
    });

    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
            document.getElementById("trip-panel").classList.remove("open");
            document.getElementById("disruptions-panel").classList.remove("open");
            document.getElementById("chat-panel").classList.remove("open");
        }
    });

    document.getElementById("chat-form").addEventListener("submit", handleChatSubmit);
    document.getElementById("clear-route-btn").addEventListener("click", clearDrawnRoute);
}

async function fetchLiveVehicles() {
    try {
        const response = await fetch(`${API_BASE_URL}/api/vehicles`);
        if (!response.ok) throw new Error(`HTTP chyba ${response.status}`);
        
        const json = await response.json();
        currentVehicles = json.data || [];
        
        updateConnectionStatus(true);
        renderVehiclesOnMap();
    } catch (err) {
        console.warn("Chyba při načítání vozidel:", err);
        updateConnectionStatus(false);
    }
}

function updateConnectionStatus(isOnline) {
    const badge = document.getElementById("connection-status");
    const text = document.getElementById("status-text");

    if (isOnline) {
        badge.classList.add("online");
        text.textContent = "Živá data";
    } else {
        badge.classList.remove("online");
        text.textContent = "Bez spojení";
    }
}

function renderVehiclesOnMap() {
    const visibleVehicles = currentVehicles.filter(v => {
        const matchesCategory = activeFilters.has(v.category);
        const matchesSearch = searchQuery === "" || v.line.toLowerCase().includes(searchQuery) || v.headsign.toLowerCase().includes(searchQuery);
        return matchesCategory && matchesSearch;
    });

    const currentFrameIds = new Set();

    visibleVehicles.forEach(vehicle => {
        currentFrameIds.add(vehicle.id);
        const existingMarker = activeMarkers.get(vehicle.id);

        if (existingMarker) {
            existingMarker.setLatLng([vehicle.lat, vehicle.lng]);
            existingMarker.setIcon(createCustomIcon(vehicle));
        } else {
            const newMarker = L.marker([vehicle.lat, vehicle.lng], {
                icon: createCustomIcon(vehicle)
            });
            newMarker.on("click", () => handleVehicleClick(vehicle));
            newMarker.addTo(vehicleLayerGroup);
            activeMarkers.set(vehicle.id, newMarker);
        }
    });

    for (const [id, marker] of activeMarkers.entries()) {
        if (!currentFrameIds.has(id)) {
            vehicleLayerGroup.removeLayer(marker);
            activeMarkers.delete(id);
        }
    }

    document.getElementById("vehicle-counter").textContent = `${visibleVehicles.length} / ${currentVehicles.length} vozidel`;
}

function createCustomIcon(v) {
    const categoryInfo = CATEGORY_CONFIG[v.category] || { color: "#94a3b8" };
    const rotation = typeof v.bearing === "number" ? v.bearing : 0;

    return L.divIcon({
        className: `vehicle-marker ${v.category}`,
        html: `
            <div class="vehicle-heading" style="transform: rotate(${rotation}deg); border-bottom-color: ${categoryInfo.color};"></div>
            <div class="vehicle-bubble" style="background: ${categoryInfo.color};">
                <span>${sanitizeHtml(v.line)}</span>
            </div>
        `,
        iconSize: [24, 24],
        iconAnchor: [12, 12]
    });
}

async function handleVehicleClick(vehicle) {
    const panel = document.getElementById("trip-panel");
    const title = document.getElementById("trip-panel-title");
    const tagsContainer = document.getElementById("vehicle-tags");
    const body = document.getElementById("trip-body");

    title.textContent = `Linka ${vehicle.line} → ${vehicle.headsign}`;
    
    tagsContainer.innerHTML = `
        <span class="meta-tag">Model: ${sanitizeHtml(vehicle.model || "Neznámý")}</span>
        <span class="meta-tag">Rychlost: ${vehicle.speed} km/h</span>
        <span class="meta-tag">${vehicle.is_accessible ? "♿ Nízkopodlažní" : "Běžný spoj"}</span>
        <span class="meta-tag">${vehicle.has_ac ? "❄️ Klimatizace" : "Bez AK"}</span>
    `;

    body.innerHTML = `<div style="text-align:center; padding:30px; color:var(--text-muted);">Načítám jízdní řád…</div>`;
    panel.classList.add("open");

    try {
        const response = await fetch(`${API_BASE_URL}/api/trip/${encodeURIComponent(vehicle.trip_id)}`);
        if (!response.ok) throw new Error("Chyba při načítání detailu");
        
        const data = await response.json();
        renderTripSchedule(body, data.stops || []);
    } catch (e) {
        body.innerHTML = `<div style="color:var(--accent-red); padding:10px;">Jízdní řád není k dispozici.</div>`;
    }
}

function renderTripSchedule(container, stops) {
    if (!stops.length) {
        container.innerHTML = `<div style="color:var(--text-muted);">Žádné zastávky nebyly nalezeny.</div>`;
        return;
    }

    const htmlRows = stops.map(stop => {
        const passedClass = stop.passed ? "passed" : "";
        const delayBadge = stop.delay > 0 ? `<span class="delay-tag">+${stop.delay} min</span>` : "";
        const requestBadge = stop.is_request_stop ? `<span style="font-size:10px; opacity:0.6; margin-left:4px;">(x)</span>` : "";

        return `
            <div class="stop-row ${passedClass}">
                <span class="stop-time">${sanitizeHtml(stop.real)}</span>
                <span class="stop-name">${sanitizeHtml(stop.name)}${requestBadge}</span>
                ${delayBadge}
            </div>
        `;
    }).join("");

    container.innerHTML = `<div class="stop-list">${htmlRows}</div>`;
}

async function fetchDisruptionsData() {
    try {
        const res = await fetch(`${API_BASE_URL}/api/disruptions`);
        if (!res.ok) return;
        const data = await res.json();
        renderDisruptions(data.disruptions || []);
    } catch (e) {
        console.warn("Chyba načítání výluk:", e);
    }
}

function renderDisruptions(disruptions) {
    const container = document.getElementById("disruptions-body");
    const badge = document.getElementById("disruptions-badge");

    badge.textContent = disruptions.length;
    badge.style.display = disruptions.length > 0 ? "inline-block" : "none";

    if (!disruptions.length) {
        container.innerHTML = `<div style="color:var(--text-muted);">Žádné hlášené výluky.</div>`;
        return;
    }

    container.innerHTML = disruptions.map(item => {
        const linesBadges = (item.lines || []).map(l => `<span class="line-badge">${sanitizeHtml(l)}</span>`).join("");
        const severityClass = item.severity === "high" ? "severity-high" : "";

        return `
            <div class="disruption-card ${severityClass}">
                <div class="disruption-title">${sanitizeHtml(item.title)}</div>
                <div class="disruption-desc">${sanitizeHtml(item.description)}</div>
                <div class="disruption-lines">${linesBadges}</div>
            </div>
        `;
    }).join("");
}

async function handleChatSubmit(e) {
    e.preventDefault();
    const inputEl = document.getElementById("chat-input");
    const messageText = inputEl.value.trim();

    if (!messageText) return;

    inputEl.value = "";
    appendMessage("user", messageText);
    chatHistory.push({ role: "user", text: messageText });

    const loadingBubble = appendMessage("model", "Mapid přemýšlí…");

    try {
        const res = await fetch(`${API_BASE_URL}/api/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message: messageText, history: chatHistory })
        });

        const data = await res.json();
        loadingBubble.remove();

        const reply = data.reply || "Omlouvám se, zkus to znovu.";
        appendMessage("model", reply);
        chatHistory.push({ role: "model", text: reply });

        if (data.route && data.route.legs) {
            drawRouteOnMap(data.route.legs);
        }
    } catch (err) {
        loadingBubble.remove();
        appendMessage("model", "Chyba při komunikaci s AI serverem.");
    }
}

function appendMessage(role, text) {
    const container = document.getElementById("chat-messages");
    const bubble = document.createElement("div");
    bubble.className = `chat-bubble ${role}`;
    bubble.textContent = text;
    container.appendChild(bubble);
    container.scrollTop = container.scrollHeight;
    return bubble;
}

function drawRouteOnMap(legs) {
    clearDrawnRoute();
    const allCoordinates = [];

    legs.forEach(leg => {
        const points = (leg.intermediate_stops || []).map(s => [s.lat, s.lng]);

        if (points.length >= 2) {
            L.polyline(points, {
                color: "#3b82f6",
                weight: 6,
                opacity: 0.85,
                lineCap: "round"
            }).addTo(routeLayerGroup);

            points.forEach(pt => allCoordinates.push(pt));
        }
    });

    if (allCoordinates.length) {
        mapInstance.fitBounds(allCoordinates, { padding: [60, 60] });
        document.getElementById("clear-route-btn").style.display = "inline-block";
    }
}

function clearDrawnRoute() {
    routeLayerGroup.clearLayers();
    document.getElementById("clear-route-btn").style.display = "none";
}

function sanitizeHtml(str) {
    return String(str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
