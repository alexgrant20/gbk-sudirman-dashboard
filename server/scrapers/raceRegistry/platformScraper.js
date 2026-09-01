// server/scrapers/raceRegistry/platformScraper.js
const cheerio = require("cheerio");
const { extractJsonLdEvents } = require("./jsonLdEvent");
const { mapWithConcurrency, parseCategoriesFromText } = require("../scraperUtils");
const { geocode } = require("../../geocode");
const { isTodayOrFuture } = require("../../dateUtils");

const DETAIL_FETCH_CONCURRENCY = 5;
const RUNNING_KEYWORDS = /run|lari|marathon|maraton/i;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function schemaEventToOurEvent(schemaEvent, detailUrl, sourceLabel) {
  const startDate = (schemaEvent.startDate || "").slice(0, 10);
  if (!ISO_DATE_RE.test(startDate)) return null;

  const offersRaw = schemaEvent.offers;
  const offers = Array.isArray(offersRaw) ? offersRaw : offersRaw ? [offersRaw] : [];
  const categories = offers.length
    ? offers.map((o) => ({
        distance: o.name || "General",
        price: o.price != null ? Number(o.price) : null,
        cutoffMinutes: null,
      }))
    : parseCategoriesFromText(schemaEvent.description);

  const venue = (schemaEvent.location && schemaEvent.location.name) || "";
  const geo = schemaEvent.location && schemaEvent.location.geo;
  const hasGeo = geo && geo.latitude != null && geo.longitude != null;

  return {
    name: schemaEvent.name || "Untitled event",
    date: startDate,
    dateRaw: schemaEvent.startDate || startDate,
    categories,
    category: "Road Run",
    location: venue,
    venue,
    lat: hasGeo ? Number(geo.latitude) : null,
    lon: hasGeo ? Number(geo.longitude) : null,
    routeImage: null,
    routeGeo: null,
    sourceUrl: detailUrl,
    source: sourceLabel,
    confidence: hasGeo ? "high" : "medium",
  };
}

async function resolveMissingGeo(event) {
  if (event.lat != null && event.lon != null) return event;
  const place = (await geocode(`${event.name} ${event.venue}`)) || (await geocode(event.venue));
  if (!place) return event;
  return { ...event, lat: place.lat, lon: place.lon, venue: event.venue || place.label };
}

function createPlatformScraper({ name, listingUrls, extractLinks, sourceLabel }) {
  async function fetchHtml(url) {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; GBKEventDashboard/2.0)" },
    });
    if (!res.ok) throw new Error(`${name} fetch failed: ${res.status} ${url}`);
    return res.text();
  }

  async function scrape() {
    const links = new Set();
    for (const listingUrl of listingUrls) {
      const html = await fetchHtml(listingUrl);
      extractLinks(cheerio.load(html)).forEach((l) => links.add(l));
    }

    const detailResults = await mapWithConcurrency([...links], DETAIL_FETCH_CONCURRENCY, async (url) => {
      try {
        const html = await fetchHtml(url);
        const schemaEvents = extractJsonLdEvents(html).filter((e) =>
          RUNNING_KEYWORDS.test(`${e.name || ""} ${e.description || ""}`)
        );
        return schemaEvents.map((se) => schemaEventToOurEvent(se, url, sourceLabel)).filter(Boolean);
      } catch (err) {
        console.warn(`[${name}] failed ${url}: ${err.message}`);
        return [];
      }
    });

    const flat = detailResults.flat().filter((ev) => isTodayOrFuture(ev.date));
    return mapWithConcurrency(flat, DETAIL_FETCH_CONCURRENCY, resolveMissingGeo);
  }

  return { scrape };
}

module.exports = { createPlatformScraper, schemaEventToOurEvent };
