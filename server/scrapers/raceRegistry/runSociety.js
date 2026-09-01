// server/scrapers/raceRegistry/runSociety.js
const { createPlatformScraper } = require("./platformScraper");

// RunSociety (runsociety.com) lists events under "/events/<slug>" detail pages.
function extractLinks($) {
  const links = new Set();
  $('a[href*="/events/"]').each((_, el) => {
    const href = $(el).attr("href");
    if (href) links.add(new URL(href, "https://runsociety.com").toString());
  });
  return [...links];
}

const scraper = createPlatformScraper({
  name: "runSociety",
  listingUrls: ["https://runsociety.com/events/"],
  extractLinks,
  sourceLabel: "raceRegistry:runSociety",
});

module.exports = { ...scraper, extractLinks };
