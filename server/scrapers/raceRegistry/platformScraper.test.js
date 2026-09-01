// server/scrapers/raceRegistry/platformScraper.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const cheerio = require("cheerio");
const { schemaEventToOurEvent, createPlatformScraper } = require("./platformScraper");

test("schemaEventToOurEvent maps offers to categories with price", () => {
  const ev = schemaEventToOurEvent(
    {
      name: "Bandung Trail Run",
      startDate: "2026-09-20",
      description: "trail run through the hills",
      offers: [{ name: "10K", price: "250000" }, { name: "21K", price: "350000" }],
      location: { name: "Dago Highland", geo: { latitude: -6.85, longitude: 107.63 } },
    },
    "https://example.com/event/bandung-trail-run",
    "raceRegistry:example"
  );
  assert.equal(ev.name, "Bandung Trail Run");
  assert.equal(ev.date, "2026-09-20");
  assert.equal(ev.lat, -6.85);
  assert.equal(ev.confidence, "high");
  assert.deepEqual(ev.categories, [
    { distance: "10K", price: 250000, cutoffMinutes: null },
    { distance: "21K", price: 350000, cutoffMinutes: null },
  ]);
});

test("schemaEventToOurEvent returns null when startDate is missing or invalid", () => {
  assert.equal(schemaEventToOurEvent({ name: "No Date Run" }, "url", "src"), null);
  assert.equal(schemaEventToOurEvent({ name: "Bad Date", startDate: "soon" }, "url", "src"), null);
});

test("schemaEventToOurEvent falls back to medium confidence with no geo", () => {
  const ev = schemaEventToOurEvent(
    { name: "Mystery Run", startDate: "2026-10-01", location: { name: "Somewhere" } },
    "url",
    "src"
  );
  assert.equal(ev.confidence, "medium");
  assert.equal(ev.lat, null);
});

test("createPlatformScraper fetches listing + detail pages and returns mapped events", async (t) => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });

  const LISTING_HTML = `<a href="/event/city-run">City Run</a>`;
  const DETAIL_HTML = `<script type="application/ld+json">
    {"@type":"Event","name":"City Run","startDate":"2099-01-01","description":"a running race",
     "location":{"name":"City Park","geo":{"latitude":-6.2,"longitude":106.8}}}
  </script>`;

  global.fetch = async (url) => {
    if (String(url).includes("/listing")) return { ok: true, text: async () => LISTING_HTML };
    return { ok: true, text: async () => DETAIL_HTML };
  };

  const scraper = createPlatformScraper({
    name: "test-platform",
    listingUrls: ["https://example.com/listing"],
    extractLinks: ($) => $("a").map((_, el) => "https://example.com" + $(el).attr("href")).get(),
    sourceLabel: "raceRegistry:test",
  });

  const events = await scraper.scrape();
  assert.equal(events.length, 1);
  assert.equal(events[0].name, "City Run");
  assert.equal(events[0].source, "raceRegistry:test");
});

test("createPlatformScraper filters out non-running events by keyword", async (t) => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });

  const LISTING_HTML = `<a href="/event/cooking-class">Cooking Class</a>`;
  const DETAIL_HTML = `<script type="application/ld+json">
    {"@type":"Event","name":"Cooking Class","startDate":"2099-01-01","description":"learn to cook"}
  </script>`;
  global.fetch = async (url) =>
    String(url).includes("/listing") ? { ok: true, text: async () => LISTING_HTML } : { ok: true, text: async () => DETAIL_HTML };

  const scraper = createPlatformScraper({
    name: "test-platform",
    listingUrls: ["https://example.com/listing"],
    extractLinks: ($) => $("a").map((_, el) => "https://example.com" + $(el).attr("href")).get(),
    sourceLabel: "raceRegistry:test",
  });

  assert.deepEqual(await scraper.scrape(), []);
});
