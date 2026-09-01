// server/scrapers/raceRegistry/runSociety.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const cheerio = require("cheerio");
const { extractLinks } = require("./runSociety");

test("extractLinks pulls absolute /events/ URLs from runsociety.com and dedupes", () => {
  const $ = cheerio.load(`
    <a href="/events/medan-half-marathon">Medan Half Marathon</a>
    <a href="/events/medan-half-marathon">duplicate</a>
    <a href="/blog/training-tips">Blog</a>
  `);
  assert.deepEqual(extractLinks($), ["https://runsociety.com/events/medan-half-marathon"]);
});
