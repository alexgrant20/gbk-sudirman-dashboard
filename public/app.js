const IDX = { lat: -6.2246, lon: 106.8092 };
const CHECK_RADIUS_KM = 1.5;

const CORRIDOR_POINTS = [
  [-6.2249, 106.7991], // Bundaran Senayan (closest to IDX/SCBD)
  [-6.2180, 106.8140],
  [-6.2050, 106.8195],
  [-6.1954, 106.8231], // Bundaran HI
];

const CATEGORY_COLORS = {
  "car free day": "#2a78d6",
  "running event": "#eb6834",
  "fun run": "#eb6834",
  "road run": "#eb6834",
  "trail run": "#eb6834",
  "virtual run": "#eb6834",
  "charity run": "#eb6834",
  "news roundup": "#1baf7a",
  "manual entry": "#eda100",
};
const DEFAULT_COLOR = "#4a3aa7";

const SOURCE_LABELS = {
  "jadwallari.id": "Running events",
  "cfd-baseline": "Car Free Day",
  news: "News roundup",
  manual: "Manual entries",
};

function colorFor(category) {
  return CATEGORY_COLORS[(category || "").toLowerCase()] || DEFAULT_COLOR;
}

function haversineKm(a, b) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// --- Map setup ---
const map = L.map("map").setView([-6.2189, 106.8140], 14);

// Esri "Light Gray Canvas": light, low-saturation basemap (no API key required) so
// colored event pins stay legible - the default OSM tile set is busy/colorful and
// pins get lost in it.
L.tileLayer(
  "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}",
  { attribution: "Esri, HERE, Garmin, &copy; OpenStreetMap contributors", maxZoom: 16 }
).addTo(map);
L.tileLayer(
  "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}",
  { maxZoom: 16 }
).addTo(map);

function pinIcon(color, size, borderColor) {
  return L.divIcon({
    className: "",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};border:3px solid ${borderColor || "#fff"};box-shadow:0 1px 4px rgba(0,0,0,0.5);"></div>`,
  });
}

L.marker([IDX.lat, IDX.lon], {
  icon: L.divIcon({
    className: "",
    iconAnchor: [11, 34],
    html: `<div style="display:flex;flex-direction:column;align-items:center;">
      <div style="background:#0b0b0b;color:#fff;font-size:11px;font-weight:700;padding:3px 8px;border-radius:10px;white-space:nowrap;margin-bottom:3px;box-shadow:0 1px 4px rgba(0,0,0,0.4)">IDX INDONESIA</div>
      <div style="width:22px;height:22px;border-radius:50%;background:#0b0b0b;border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.6)"></div>
    </div>`,
  }),
  zIndexOffset: 1000,
}).addTo(map);

L.circle([IDX.lat, IDX.lon], {
  radius: CHECK_RADIUS_KM * 1000,
  color: "#0b0b0b",
  weight: 2,
  fillOpacity: 0.04,
  dashArray: "8 6",
}).addTo(map).bindTooltip("1.5km check radius", { permanent: false });

L.polyline(CORRIDOR_POINTS, { color: "#2a78d6", weight: 5, opacity: 0.85, dashArray: "10 6" })
  .addTo(map)
  .bindTooltip("CFD Sudirman-Thamrin corridor", { permanent: false });

const clusterGroup = L.markerClusterGroup({
  maxClusterRadius: 40,
  iconCreateFunction: (cluster) => {
    const count = cluster.getChildCount();
    const size = count > 20 ? 44 : count > 8 ? 38 : 32;
    return L.divIcon({
      className: "",
      iconSize: [size, size],
      html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:#4a3aa7;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;border:3px solid #fff;box-shadow:0 1px 6px rgba(0,0,0,0.5)">${count}</div>`,
    });
  },
});
map.addLayer(clusterGroup);

let allEvents = [];
const markersById = new Map();

function renderMarkers(events) {
  clusterGroup.clearLayers();
  markersById.clear();
  events.forEach((ev) => {
    if (ev.lat == null || ev.lon == null) return;
    const color = colorFor(ev.category);
    const icon = pinIcon(color, 22, ev.confidence === "low" ? "#fab219" : "#fff");
    const m = L.marker([ev.lat, ev.lon], { icon });
    m.bindPopup(
      `<strong>${escapeHtml(ev.name)}</strong><br/>${ev.date}<br/>${escapeHtml(ev.venue || ev.location || "")}` +
        (ev.confidence === "low" ? `<br/><em>low confidence - verify via source</em>` : "") +
        (ev.sourceUrl ? `<br/><a href="${ev.sourceUrl}" target="_blank" rel="noopener">source</a>` : "")
    );
    clusterGroup.addLayer(m);
    if (ev.id) markersById.set(ev.id, m);
  });
}

// Zooms/spiderfies to reveal the marker for an event (even if buried in a cluster)
// and opens its popup - used when a card in the sidebar list is clicked.
function openEventOnMap(ev) {
  const m = markersById.get(ev.id);
  if (!m) {
    if (ev.lat != null && ev.lon != null) map.setView([ev.lat, ev.lon], 15);
    return;
  }
  clusterGroup.zoomToShowLayer(m, () => m.openPopup());
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// --- Filters ---
const filterState = { search: "", sources: null, hideLowConfidence: false };

function buildSourceFilters(events) {
  const container = document.getElementById("sourceFilters");
  const counts = new Map();
  events.forEach((ev) => counts.set(ev.source, (counts.get(ev.source) || 0) + 1));

  // Preserve existing checked state across reloads; default new/unseen sources to checked.
  const previous = filterState.sources;
  filterState.sources = new Set(
    [...counts.keys()].filter((src) => (previous ? previous.has(src) : true))
  );

  container.innerHTML = "";
  [...counts.keys()].sort().forEach((src) => {
    const id = `srcFilter-${src}`;
    const row = document.createElement("label");
    row.className = "filter-row";
    row.innerHTML = `
      <input type="checkbox" id="${id}" ${filterState.sources.has(src) ? "checked" : ""} />
      <span>${escapeHtml(SOURCE_LABELS[src] || src)}</span>
      <span class="count">${counts.get(src)}</span>
    `;
    row.querySelector("input").addEventListener("change", (e) => {
      if (e.target.checked) filterState.sources.add(src);
      else filterState.sources.delete(src);
      applyFilters();
    });
    container.appendChild(row);
  });
}

function getFilteredEvents() {
  const q = filterState.search.trim().toLowerCase();
  return allEvents.filter((ev) => {
    if (filterState.sources && !filterState.sources.has(ev.source)) return false;
    if (filterState.hideLowConfidence && ev.confidence === "low") return false;
    if (q) {
      const haystack = `${ev.name} ${ev.venue || ""} ${ev.location || ""}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
}

function applyFilters() {
  const filtered = getFilteredEvents();
  renderMarkers(filtered);
  renderEventList(filtered);
}

document.getElementById("searchInput").addEventListener("input", (e) => {
  filterState.search = e.target.value;
  applyFilters();
});
document.getElementById("hideLowConfidence").addEventListener("change", (e) => {
  filterState.hideLowConfidence = e.target.checked;
  applyFilters();
});

// --- Data loading ---
async function loadEvents() {
  const res = await fetch("/api/events");
  allEvents = await res.json();
  buildSourceFilters(allEvents);
  applyFilters();
  const dateInput = document.getElementById("checkDate");
  if (dateInput.value) checkDate(dateInput.value);
}

function renderEventList(events) {
  document.getElementById("eventCount").textContent = events.length;
  const list = document.getElementById("eventList");
  list.innerHTML = "";
  const sorted = [...events].sort((a, b) => a.date.localeCompare(b.date));
  for (const ev of sorted) {
    const card = document.createElement("div");
    card.className = "event-card";
    card.innerHTML = `
      <div class="name">${escapeHtml(ev.name)}</div>
      <div class="meta">${ev.date} &middot; ${escapeHtml(ev.venue || ev.location || "unknown location")}</div>
      <div class="badges">
        <span class="badge">${escapeHtml(ev.category || ev.source)}</span>
        ${ev.confidence === "low" ? '<span class="badge low">low confidence</span>' : ""}
        ${ev.source === "cfd-baseline" ? '<span class="badge mine">your event</span>' : ""}
      </div>
      ${ev.source === "manual" ? '<button class="del-btn" data-id="' + ev.id + '">Delete</button>' : ""}
    `;
    card.addEventListener("click", (e) => {
      if (e.target.classList.contains("del-btn")) return;
      if (ev.lat != null && ev.lon != null) openEventOnMap(ev);
    });
    list.appendChild(card);
  }
  list.querySelectorAll(".del-btn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      await fetch(`/api/events/${btn.dataset.id}`, { method: "DELETE" });
      loadEvents();
    });
  });
}

// --- Date check ---
// CFD Sudirman-Thamrin itself is excluded from the conflict check: it's the event
// the user attends to sell, not a competing one. It still shows on the map/list for
// context, it just never counts against "clear to sell".
function checkDate(dateStr) {
  const matches = allEvents.filter((ev) => {
    if (ev.date !== dateStr || ev.lat == null || ev.lon == null) return false;
    if (ev.source === "cfd-baseline") return false;
    return haversineKm(IDX, { lat: ev.lat, lon: ev.lon }) <= CHECK_RADIUS_KM;
  });

  const badge = document.getElementById("statusBadge");
  const eventsBox = document.getElementById("statusEvents");

  if (matches.length === 0) {
    badge.className = "status-badge status-clear";
    badge.textContent = `Clear to sell - no tracked events within ${CHECK_RADIUS_KM}km of IDX on ${dateStr}`;
    eventsBox.innerHTML = "";
  } else {
    badge.className = "status-badge status-conflict";
    badge.textContent = `${matches.length} event(s) within ${CHECK_RADIUS_KM}km of IDX on ${dateStr}`;
    eventsBox.innerHTML = matches
      .map(
        (ev) =>
          `<div class="item"><strong>${escapeHtml(ev.name)}</strong><br/>${escapeHtml(ev.venue || "")} &middot; ${haversineKm(IDX, { lat: ev.lat, lon: ev.lon }).toFixed(2)}km away${ev.confidence === "low" ? " · low confidence" : ""}</div>`
      )
      .join("");
  }
}

document.getElementById("checkDate").addEventListener("change", (e) => {
  if (e.target.value) checkDate(e.target.value);
});

// --- Manual scrape trigger ---
const rescrapeBtn = document.getElementById("rescrapeBtn");
rescrapeBtn.addEventListener("click", async () => {
  rescrapeBtn.disabled = true;
  const originalText = rescrapeBtn.textContent;
  rescrapeBtn.textContent = "Refreshing...";
  try {
    const res = await fetch("/api/scrape", { method: "POST" });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    await loadEvents();
    rescrapeBtn.textContent = `Done (${body.total} events)`;
  } catch (err) {
    rescrapeBtn.textContent = "Refresh failed";
    console.error("scrape failed:", err);
    alert(`Data refresh failed: ${err.message}`);
  } finally {
    setTimeout(() => {
      rescrapeBtn.textContent = originalText;
      rescrapeBtn.disabled = false;
    }, 2500);
  }
});

// --- Add event form ---
let pickingLocation = false;
const addForm = document.getElementById("addForm");
document.getElementById("pickOnMap").addEventListener("click", () => {
  pickingLocation = true;
  document.getElementById("pickOnMap").textContent = "Click the map...";
});
map.on("click", (e) => {
  if (!pickingLocation) return;
  addForm.querySelector('[name="lat"]').value = e.latlng.lat.toFixed(5);
  addForm.querySelector('[name="lon"]').value = e.latlng.lng.toFixed(5);
  pickingLocation = false;
  document.getElementById("pickOnMap").textContent = "Pick location on map";
});

addForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const data = new FormData(addForm);
  const body = Object.fromEntries(data.entries());
  await fetch("/api/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  addForm.reset();
  loadEvents();
});

loadEvents();
