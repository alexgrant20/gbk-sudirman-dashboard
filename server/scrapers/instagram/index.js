// server/scrapers/instagram/index.js
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const { parseCaption } = require("./parseCaption");
const { geocode } = require("../../geocode");
const { isTodayOrFuture } = require("../../dateUtils");

const SOURCES_FILE = path.join(__dirname, "..", "..", "data", "instagramSources.json");
const REQUEST_DELAY_MS = 3000;
const MAX_POSTS_PER_TARGET = 12;

function loadSources() {
  try {
    return JSON.parse(fs.readFileSync(SOURCES_FILE, "utf8"));
  } catch {
    return { accounts: [], hashtags: [] };
  }
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Scrapes public post captions from a curated list of race-organizer accounts and
// hashtags (server/data/instagramSources.json) via a headless browser - Instagram
// blocks plain HTTP scraping. This is accepted-risk: it violates Instagram's ToS
// and may get blocked/rate-limited or break when their markup changes. Deliberately
// scoped to specific accounts/hashtags rather than general search (the least
// detectable pattern), and never retried on failure - server/scrapers/index.js sets
// retries: 0 for this source so a block isn't compounded by hammering it further.
async function scrape() {
  const { accounts = [], hashtags = [] } = loadSources();
  const targets = [
    ...accounts.map((a) => ({ type: "account", value: a, url: `https://www.instagram.com/${a}/` })),
    ...hashtags.map((h) => ({ type: "hashtag", value: h, url: `https://www.instagram.com/explore/tags/${h}/` })),
  ];
  if (!targets.length) return [];

  const browser = await chromium.launch({ headless: true });
  const events = [];
  try {
    const page = await browser.newPage({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
    });
    for (const target of targets) {
      try {
        await page.goto(target.url, { waitUntil: "domcontentloaded", timeout: 30000 });
        await page.waitForTimeout(2000);
        const captions = await page.$$eval(
          "article img[alt]",
          (imgs, max) => imgs.slice(0, max).map((img) => img.getAttribute("alt") || ""),
          MAX_POSTS_PER_TARGET
        );
        for (const caption of captions) {
          const parsed = parseCaption(caption);
          if (!parsed || !isTodayOrFuture(parsed.date)) continue;
          const place = await geocode(`${parsed.name} Indonesia`);
          events.push({
            ...parsed,
            venue: place ? place.label : "",
            location: place ? place.label : "",
            lat: place ? place.lat : null,
            lon: place ? place.lon : null,
            routeImage: null,
            routeGeo: null,
            sourceUrl: target.url,
            source: "instagram",
            confidence: place ? "medium" : "low",
          });
        }
      } catch (err) {
        console.warn(`[instagram] failed ${target.type} ${target.value}: ${err.message}`);
      }
      await delay(REQUEST_DELAY_MS);
    }
  } finally {
    await browser.close();
  }
  return events;
}

module.exports = { scrape };
