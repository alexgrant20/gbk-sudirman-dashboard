const cheerio = require("cheerio");
const { geocode } = require("../geocode");
const { isTodayOrFuture } = require("../dateUtils");
const { parseCategoriesFromText } = require("./scraperUtils");

const SOURCE_URL = "https://jadwallari.id/events/";
const DETAIL_FETCH_CONCURRENCY = 5;

const ID_MONTHS = {
  januari: "01", februari: "02", maret: "03", april: "04", mei: "05",
  juni: "06", juli: "07", agustus: "08", september: "09",
  oktober: "10", november: "11", desember: "12",
};

// "16-17 Januari 2026" / "16 Januari – 16 Februari 2026" / "26 April 2026" -> ISO start date
function parseIndoDate(raw) {
  if (!raw) return null;
  const text = raw.replace(/–|—/g, "-").trim();
  const yearMatch = text.match(/(\d{4})\s*$/);
  if (!yearMatch) return null;
  const year = yearMatch[1];

  const full = text.match(/(\d{1,2})\s+([A-Za-z]+)/);
  if (!full) return null;
  const day = full[1].padStart(2, "0");
  const monthName = full[2].toLowerCase();
  const month = ID_MONTHS[monthName];
  if (!month) return null;
  return `${year}-${month}-${day}`;
}

// The events table only gives city-level location ("Jakarta Pusat, DKI Jakarta").
// Each event's own detail page carries a much more precise venue in its meta
// description (e.g. "Plaza Parkir Timur GBK (Gelora Bung Karno), Tanah Abang,
// Jakarta Pusat"), formatted as "<name> | <day, date> | <distances> | <venue address>".
// Fetch it and pull that last segment out.
async function fetchPreciseVenue(url) {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; GBKEventDashboard/1.0)" },
    });
    if (!res.ok) return null;
    const html = await res.text();
    const m = html.match(/<meta name="description" content="([^"]+)"/);
    if (!m) return null;
    const parts = m[1].split("|").map((s) => s.trim());
    return parts.length >= 4 ? parts.slice(3).join("|") : null;
  } catch {
    return null;
  }
}

async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function scrape() {
  const res = await fetch(SOURCE_URL, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; GBKEventDashboard/1.0)" },
  });
  if (!res.ok) throw new Error(`jadwallari.id fetch failed: ${res.status}`);
  const html = await res.text();
  const $ = cheerio.load(html);

  const table = $('table[id^="tablepress-"]')
    .filter((_, el) => !$(el).attr("id").endsWith("-mobile"))
    .first();

  const candidates = [];
  table.find("tbody tr, tr").each((_, row) => {
    const cells = $(row).find("td");
    if (cells.length < 5) return;

    const dateRaw = $(cells[0]).text().trim();
    const name = $(cells[1]).text().trim();
    const link = $(cells[1]).find("a").attr("href") || null;
    const distances = $(cells[2]).text().trim();
    const type = $(cells[3]).text().trim();
    const location = $(cells[4]).text().trim();
    if (!name || !dateRaw) return;

    const date = parseIndoDate(dateRaw);
    if (!date || !isTodayOrFuture(date)) return; // drop events that already happened

    candidates.push({ name, date, dateRaw, distances, type, location, link });
  });

  const mapped = await mapWithConcurrency(candidates, DETAIL_FETCH_CONCURRENCY, async (c) => {
    const preciseVenue = c.link ? await fetchPreciseVenue(c.link) : null;
    const geocodeText = preciseVenue ? `${c.name} ${preciseVenue}` : `${c.name} ${c.location}`;
    const place = (await geocode(geocodeText)) || (await geocode(c.location));

    let confidence = "low";
    if (place && preciseVenue) confidence = "high";
    else if (place) confidence = "medium";

    return {
      name: c.name,
      date: c.date,
      dateRaw: c.dateRaw,
      categories: parseCategoriesFromText(c.distances),
      routeImage: null,
      routeGeo: null,
      category: c.type || "Running Event",
      location: preciseVenue || c.location,
      venue: place ? place.label : preciseVenue || c.location,
      lat: place ? place.lat : null,
      lon: place ? place.lon : null,
      sourceUrl: c.link || SOURCE_URL,
      source: "jadwallari.id",
      confidence,
    };
  });

  return mapped.filter(Boolean);
}

module.exports = { scrape, SOURCE_URL };
