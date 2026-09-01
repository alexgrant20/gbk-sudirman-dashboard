// server/scrapers/run.js
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const { SOURCES } = require("./index");
const { dedupeKey, downloadRouteImage } = require("./scraperUtils");
const { isTodayOrFuture } = require("../dateUtils");

const EVENTS_FILE = path.join(__dirname, "..", "..", "public", "data", "events.json");
const ROUTES_DIR = path.join(__dirname, "..", "..", "public", "data", "routes");

function loadExisting() {
  try {
    return JSON.parse(fs.readFileSync(EVENTS_FILE, "utf8"));
  } catch {
    return [];
  }
}

async function scrapeWithRetries(source) {
  const maxAttempts = source.retries + 1;
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await source.module.scrape();
    } catch (err) {
      lastErr = err;
      if (attempt < maxAttempts) {
        console.warn(`[scrape] ${source.name} attempt ${attempt} failed: ${err.message}, retrying`);
      }
    }
  }
  throw lastErr;
}

async function run() {
  const existing = loadExisting();
  const manual = existing.filter((e) => e.source === "manual");

  const active = SOURCES.filter((s) => s.enabled);
  const results = await Promise.allSettled(active.map(scrapeWithRetries));

  const scraped = [];
  results.forEach((r, i) => {
    const label = active[i].name;
    if (r.status === "fulfilled") {
      const upcoming = r.value.filter((ev) => isTodayOrFuture(ev.date));
      console.log(`[scrape] ${label}: ${upcoming.length} upcoming events (${r.value.length - upcoming.length} past dropped)`);
      scraped.push(...upcoming);
    } else {
      console.warn(`[scrape] ${label} failed after retries: ${r.reason.message}`);
    }
  });

  const seen = new Map();
  for (const ev of [...manual, ...scraped]) {
    const key = dedupeKey(ev);
    if (!ev.id) ev.id = crypto.randomUUID();
    if (!seen.has(key)) seen.set(key, ev);
  }

  const merged = Array.from(seen.values());
  for (const ev of merged) {
    if (ev.routeImage && /^https?:\/\//.test(ev.routeImage)) {
      const filename = await downloadRouteImage(ev.routeImage, ROUTES_DIR, ev.id);
      ev.routeImage = filename ? `data/routes/${filename}` : null;
    }
  }
  merged.sort((a, b) => a.date.localeCompare(b.date));

  fs.mkdirSync(path.dirname(EVENTS_FILE), { recursive: true });
  fs.writeFileSync(EVENTS_FILE, JSON.stringify(merged, null, 2));
  console.log(`[scrape] wrote ${merged.length} total events (${manual.length} manual preserved) to ${EVENTS_FILE}`);
  return { total: merged.length, manual: manual.length };
}

module.exports = { run };

if (require.main === module) {
  run().catch((err) => {
    console.error("[scrape] fatal error:", err);
    process.exit(1);
  });
}
