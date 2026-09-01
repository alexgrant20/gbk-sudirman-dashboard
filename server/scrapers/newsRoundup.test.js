// server/scrapers/newsRoundup.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

function withMockedSourcesFile(urls, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "news-test-"));
  const file = path.join(dir, "newsSources.json");
  fs.writeFileSync(file, JSON.stringify(urls));
  return fn(file);
}

test("scrape extracts a low-confidence event from an article with a date", async (t) => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  global.fetch = async () => ({
    ok: true,
    text: async () => `<html><body><h1>Medan City Run digelar 20 Desember 2099</h1><article>details</article></body></html>`,
  });

  await withMockedSourcesFile(["https://example.com/article"], async (sourcesFile) => {
    const { createNewsRoundupScraper } = require("./newsRoundup");
    const geocode = async () => ({ label: "Medan, Sumatera Utara", lat: 3.59, lon: 98.67 });
    const { scrape } = createNewsRoundupScraper({ sourcesFile, geocode });
    const events = await scrape();
    assert.equal(events.length, 1);
    assert.equal(events[0].date, "2099-12-20");
    assert.equal(events[0].confidence, "low");
    assert.equal(events[0].source, "news");
  });
});

test("scrape skips an article with no parseable date", async (t) => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  global.fetch = async () => ({ ok: true, text: async () => `<html><body><h1>No date here</h1></body></html>` });

  await withMockedSourcesFile(["https://example.com/article"], async (sourcesFile) => {
    const { createNewsRoundupScraper } = require("./newsRoundup");
    const { scrape } = createNewsRoundupScraper({ sourcesFile, geocode: async () => null });
    assert.deepEqual(await scrape(), []);
  });
});

test("scrape skips a source that fails to fetch, without throwing", async (t) => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  global.fetch = async () => { throw new Error("blocked"); };

  await withMockedSourcesFile(["https://example.com/blocked"], async (sourcesFile) => {
    const { createNewsRoundupScraper } = require("./newsRoundup");
    const { scrape } = createNewsRoundupScraper({ sourcesFile, geocode: async () => null });
    assert.deepEqual(await scrape(), []);
  });
});
