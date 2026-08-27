const fs = require("fs");
const path = require("path");
const cheerio = require("cheerio");
const { geocode } = require("../geocode");
const { isTodayOrFuture } = require("../dateUtils");

const SOURCES_FILE = path.join(__dirname, "..", "data", "newsSources.json");

const ID_MONTHS = {
  januari: "01", februari: "02", maret: "03", april: "04", mei: "05",
  juni: "06", juli: "07", agustus: "08", september: "09",
  oktober: "10", november: "11", desember: "12",
};

// Best-effort: finds the first "<day> <month(name)> <year>" in text and returns ISO date.
function findFirstIndoDate(text) {
  const monthPattern = Object.keys(ID_MONTHS).join("|");
  const re = new RegExp(`(\\d{1,2})\\s+(${monthPattern})\\s+(\\d{4})`, "i");
  const m = text.match(re);
  if (!m) return null;
  const day = m[1].padStart(2, "0");
  const month = ID_MONTHS[m[2].toLowerCase()];
  const year = m[3];
  return `${year}-${month}-${day}`;
}

// Best-effort scraper: news roundup articles are unstructured prose, not a feed.
// Each configured source URL becomes at most one low-confidence "see article" event card
// summarizing what's happening at GBK that weekend, geocoded to the most specific venue
// keyword found in the article text. Individual sources are skipped (not fatal) if the
// site blocks scraping (403) or the request otherwise fails.
async function scrape() {
  let sources = [];
  try {
    sources = JSON.parse(fs.readFileSync(SOURCES_FILE, "utf8"));
  } catch {
    return [];
  }

  const events = [];
  for (const url of sources) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; GBKEventDashboard/1.0)" },
      });
      if (!res.ok) {
        console.warn(`[gbkNews] skipped ${url}: HTTP ${res.status}`);
        continue;
      }
      const html = await res.text();
      const $ = cheerio.load(html);
      const title = $("h1").first().text().trim() || $("title").text().trim();
      const bodyText = $("article, .side-article, body").first().text().replace(/\s+/g, " ").trim();

      const date = findFirstIndoDate(title) || findFirstIndoDate(bodyText);
      if (!date) {
        console.warn(`[gbkNews] no date found in ${url}, skipping`);
        continue;
      }
      if (!isTodayOrFuture(date)) {
        console.warn(`[gbkNews] ${url} is in the past (${date}), skipping`);
        continue;
      }

      const place = geocode(title) || geocode(bodyText.slice(0, 2000)) || geocode("gbk");

      events.push({
        name: title || "GBK event roundup",
        date,
        dateRaw: date,
        distances: "",
        category: "News roundup",
        location: place ? place.label : "GBK area",
        venue: place ? place.label : "GBK area",
        lat: place ? place.lat : null,
        lon: place ? place.lon : null,
        sourceUrl: url,
        source: "news",
        confidence: "low",
      });
    } catch (err) {
      console.warn(`[gbkNews] failed ${url}: ${err.message}`);
    }
  }
  return events;
}

module.exports = { scrape };
