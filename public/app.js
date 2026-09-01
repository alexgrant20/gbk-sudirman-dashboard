const CATEGORY_COLORS = {
  "road run": "#eb6834",
  "fun run": "#eb6834",
  "trail run": "#eb6834",
  "virtual run": "#eb6834",
  "charity run": "#eb6834",
  "news roundup": "#1baf7a",
};
const DEFAULT_COLOR = "#4a3aa7";

const SOURCE_LABELS = {
  "jadwallari.id": "jadwallari.id",
  "raceRegistry:race.id": "race.id",
  "raceRegistry:loket": "Loket",
  "raceRegistry:runSociety": "RunSociety",
  news: "News roundup",
  instagram: "Instagram",
};

function colorFor(category) {
  return CATEGORY_COLORS[(category || "").toLowerCase()] || DEFAULT_COLOR;
}

// --- Map setup ---
const map = L.map("map").setView([-2.5, 118], 5);

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

// TODO(Task 17): full implementation lands here
function showEventDetail(ev) {}

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
  const res = await fetch("./data/events.json");
  allEvents = await res.json();
  buildSourceFilters(allEvents);
  applyFilters();
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
      </div>
    `;
    card.addEventListener("click", () => {
      if (ev.lat != null && ev.lon != null) openEventOnMap(ev);
      showEventDetail(ev);
    });
    list.appendChild(card);
  }
}

loadEvents();
