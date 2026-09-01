// server/scrapers/raceRegistry/loket.js
const { createPlatformScraper } = require("./platformScraper");

// Loket (loket.com) lists events as cards linking to "/event/<slug>" detail pages,
// same URL shape as race.id but a different domain and event catalog.
function extractLinks($) {
  const links = new Set();
  $('a[href*="/event/"]').each((_, el) => {
    const href = $(el).attr("href");
    if (href) links.add(new URL(href, "https://www.loket.com").toString());
  });
  return [...links];
}

const scraper = createPlatformScraper({
  name: "loket",
  listingUrls: ["https://www.loket.com/search?category=sport-running"],
  extractLinks,
  sourceLabel: "raceRegistry:loket",
});

module.exports = { ...scraper, extractLinks };
