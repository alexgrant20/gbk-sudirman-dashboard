// server/scrapers/raceRegistry/raceId.js
const { createPlatformScraper } = require("./platformScraper");

// race.id lists running events as cards linking to "/event/<slug>" detail pages.
function extractLinks($) {
  const links = new Set();
  $('a[href*="/event/"]').each((_, el) => {
    const href = $(el).attr("href");
    if (href) links.add(new URL(href, "https://www.race.id").toString());
  });
  return [...links];
}

const scraper = createPlatformScraper({
  name: "race.id",
  listingUrls: ["https://www.race.id/event-category/running/"],
  extractLinks,
  sourceLabel: "raceRegistry:race.id",
});

module.exports = { ...scraper, extractLinks };
