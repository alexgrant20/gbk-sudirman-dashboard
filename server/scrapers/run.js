const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const jadwallari = require("./jadwallari");
const gbkNews = require("./gbkNews");
const cfdSchedule = require("./cfdSchedule");
const { isTodayOrFuture } = require("../dateUtils");

const EVENTS_FILE = path.join(__dirname, "..", "data", "events.json");

function dedupeKey(ev) {
  return `${ev.source}|${ev.name}|${ev.date}`.toLowerCase();
}

function loadExisting() {
  try {
    return JSON.parse(fs.readFileSync(EVENTS_FILE, "utf8"));
  } catch {
    return [];
  }
}

async function run() {
  const existing = loadExisting();
  const manual = existing.filter((e) => e.source === "manual");

  const results = await Promise.allSettled([
    jadwallari.scrape(),
    gbkNews.scrape(),
    Promise.resolve(cfdSchedule.scrape()),
  ]);

  const scraped = [];
  const labels = ["jadwallari.id", "gbkNews", "cfdSchedule"];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") {
      // Safety net: each scraper already filters to today+future, but re-check here
      // in case a scraper's own date logic slips - scraped (non-manual) events should
      // never carry a past date into events.json.
      const upcoming = r.value.filter((ev) => isTodayOrFuture(ev.date));
      console.log(`[scrape] ${labels[i]}: ${upcoming.length} upcoming events (${r.value.length - upcoming.length} past dropped)`);
      scraped.push(...upcoming);
    } else {
      console.warn(`[scrape] ${labels[i]} failed: ${r.reason.message}`);
    }
  });

  const seen = new Map();
  for (const ev of [...manual, ...scraped]) {
    const key = dedupeKey(ev);
    if (!ev.id) ev.id = crypto.randomUUID();
    if (!seen.has(key)) seen.set(key, ev);
  }

  const merged = Array.from(seen.values()).sort((a, b) => a.date.localeCompare(b.date));
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
