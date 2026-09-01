// server/scrapers/raceRegistry/raceId.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const cheerio = require("cheerio");
const { extractLinks } = require("./raceId");

test("extractLinks pulls absolute /event/ URLs and dedupes", () => {
  const $ = cheerio.load(`
    <div class="card"><a href="/event/jakarta-10k">Jakarta 10K</a></div>
    <div class="card"><a href="/event/jakarta-10k">duplicate</a></div>
    <div class="card"><a href="/event/bali-marathon">Bali Marathon</a></div>
    <a href="/about">About</a>
  `);
  assert.deepEqual(extractLinks($).sort(), [
    "https://www.race.id/event/bali-marathon",
    "https://www.race.id/event/jakarta-10k",
  ]);
});
