// server/scrapers/raceRegistry/jsonLdEvent.js
const cheerio = require("cheerio");

function isEventType(type) {
  return type === "Event" || (Array.isArray(type) && type.includes("Event"));
}

// Extracts schema.org Event objects from a page's JSON-LD script tags.
// Ticketing/registration platforms (Loket, RunSociety, race.id) commonly embed
// structured event data this way for SEO - far more stable to parse than
// hand-picked CSS classes that change with every redesign.
function extractJsonLdEvents(html) {
  const $ = cheerio.load(html);
  const events = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    let data;
    try {
      data = JSON.parse($(el).contents().text());
    } catch {
      return;
    }
    const items = Array.isArray(data) ? data : [data];
    for (const item of items) {
      if (isEventType(item["@type"])) events.push(item);
      if (Array.isArray(item["@graph"])) {
        for (const g of item["@graph"]) {
          if (isEventType(g["@type"])) events.push(g);
        }
      }
    }
  });
  return events;
}

module.exports = { extractJsonLdEvents };
