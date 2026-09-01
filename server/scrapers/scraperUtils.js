const fs = require("fs");
const path = require("path");

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

function dedupeKey(ev) {
  return `${ev.source}|${ev.name}|${ev.date}`.toLowerCase();
}

// "5K, 10K, HM" -> [{distance:"5K",price:null,cutoffMinutes:null}, ...]
// price/cutoffMinutes are left null here - callers fill them in when a source
// gives structured per-category data (see raceRegistry's schemaEventToOurEvent).
function parseCategoriesFromText(text) {
  if (!text) return [];
  return text
    .split(/[,/]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((distance) => ({ distance, price: null, cutoffMinutes: null }));
}

const ID_MONTHS = {
  januari: "01", februari: "02", maret: "03", april: "04", mei: "05",
  juni: "06", juli: "07", agustus: "08", september: "09",
  oktober: "10", november: "11", desember: "12",
};

// Finds the first "<day> <Indonesian month name> <year>" in free text and
// returns it as an ISO date. Used by scrapers that only have prose to work
// with (news roundups, Instagram captions) rather than a structured date field.
function parseIndoDate(text) {
  if (!text) return null;
  const monthPattern = Object.keys(ID_MONTHS).join("|");
  const re = new RegExp(`(\\d{1,2})\\s+(${monthPattern})\\s+(\\d{4})`, "i");
  const m = text.match(re);
  if (!m) return null;
  const day = m[1].padStart(2, "0");
  const month = ID_MONTHS[m[2].toLowerCase()];
  const year = m[3];
  return `${year}-${month}-${day}`;
}

// Downloads a scraped route-map image into destDir/<id>.<ext> for committing
// alongside events.json. Never throws - returns null on any failure so a
// broken image URL doesn't fail the whole scrape run.
async function downloadRouteImage(url, destDir, id) {
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const ext = (url.split(".").pop() || "jpg").split("?")[0].slice(0, 4);
    const filename = `${id}.${ext}`;
    fs.mkdirSync(destDir, { recursive: true });
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(path.join(destDir, filename), buf);
    return filename;
  } catch {
    return null;
  }
}

module.exports = {
  mapWithConcurrency,
  dedupeKey,
  parseCategoriesFromText,
  parseIndoDate,
  downloadRouteImage,
};
