// server/scrapers/raceRegistry/loket.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const cheerio = require("cheerio");
const { extractLinks } = require("./loket");

test("extractLinks pulls absolute /event/ URLs from loket.com and dedupes", () => {
  const $ = cheerio.load(`
    <a href="/event/surabaya-night-run-2026">Surabaya Night Run</a>
    <a href="/event/surabaya-night-run-2026">duplicate</a>
    <a href="/organizer/acme">Organizer page</a>
  `);
  assert.deepEqual(extractLinks($), ["https://www.loket.com/event/surabaya-night-run-2026"]);
});
