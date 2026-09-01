// server/scrapers/newsRoundup.js
const fs = require("fs");
const path = require("path");
const cheerio = require("cheerio");
const { geocode: defaultGeocode } = require("../geocode");
const { parseIndoDate } = require("./scraperUtils");
const { isTodayOrFuture } = require("../dateUtils");

const DEFAULT_SOURCES_FILE = path.join(__dirname, "..", "data", "newsSources.json");

// Best-effort scraper: news roundup articles are unstructured prose, not a feed.
// Each configured source URL becomes at most one low-confidence "see article" event
// card, geocoded from whatever venue text can be pulled out of the article.
// Individual sources are skipped (not fatal) if the site blocks scraping or the
// request otherwise fails - geocode and the sources file are injectable so this is
// testable without hitting the network or the real data file.
function createNewsRoundupScraper({ sourcesFile = DEFAULT_SOURCES_FILE, geocode = defaultGeocode } = {}) {
  async function scrape() {
    let sources = [];
    try {
      sources = JSON.parse(fs.readFileSync(sourcesFile, "utf8"));
    } catch {
      return [];
    }

    const events = [];
    for (const url of sources) {
      try {
        const res = await fetch(url, {
          headers: { "User-Agent": "Mozilla/5.0 (compatible; GBKEventDashboard/2.0)" },
        });
        if (!res.ok) {
          console.warn(`[newsRoundup] skipped ${url}: HTTP ${res.status}`);
          continue;
        }
        const html = await res.text();
        const $ = cheerio.load(html);
        const title = $("h1").first().text().trim() || $("title").text().trim();
        const bodyText = $("article, body").first().text().replace(/\s+/g, " ").trim();

        const date = parseIndoDate(title) || parseIndoDate(bodyText);
        if (!date) {
          console.warn(`[newsRoundup] no date found in ${url}, skipping`);
          continue;
        }
        if (!isTodayOrFuture(date)) continue;

        const place = (await geocode(title)) || (await geocode(bodyText.slice(0, 2000)));

        events.push({
          name: title || "Running event roundup",
          date,
          dateRaw: date,
          categories: [],
          category: "News roundup",
          location: place ? place.label : "",
          venue: place ? place.label : "",
          lat: place ? place.lat : null,
          lon: place ? place.lon : null,
          routeImage: null,
          routeGeo: null,
          sourceUrl: url,
          source: "news",
          confidence: "low",
        });
      } catch (err) {
        console.warn(`[newsRoundup] failed ${url}: ${err.message}`);
      }
    }
    return events;
  }

  return { scrape };
}

module.exports = { ...createNewsRoundupScraper(), createNewsRoundupScraper };
