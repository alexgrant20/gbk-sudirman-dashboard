const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createGeocoder } = require("./geocode");

function tmpCacheFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "geocode-test-")), "cache.json");
}

test("geocode returns a place from a mocked Nominatim response", async (t) => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  global.fetch = async () => ({
    ok: true,
    json: async () => [{ display_name: "Senayan Park, Jakarta", lat: "-6.2192", lon: "106.8005" }],
  });

  const { geocode } = createGeocoder(tmpCacheFile());
  const place = await geocode("Senayan Park");
  assert.deepEqual(place, { label: "Senayan Park, Jakarta", lat: -6.2192, lon: 106.8005 });
});

test("geocode returns null and caches it when Nominatim has no match", async (t) => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  let callCount = 0;
  global.fetch = async () => { callCount++; return { ok: true, json: async () => [] }; };

  const { geocode } = createGeocoder(tmpCacheFile());
  assert.equal(await geocode("Nonexistent Place XYZ"), null);
  assert.equal(await geocode("Nonexistent Place XYZ"), null);
  assert.equal(callCount, 1, "second call should hit the cache, not fetch again");
});

test("geocode returns null on fetch failure instead of throwing", async (t) => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  global.fetch = async () => { throw new Error("network down"); };

  const { geocode } = createGeocoder(tmpCacheFile());
  assert.equal(await geocode("Some Place"), null);
});

test("geocode returns null for empty input without calling fetch", async (t) => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  global.fetch = async () => { throw new Error("should not be called"); };

  const { geocode } = createGeocoder(tmpCacheFile());
  assert.equal(await geocode(""), null);
});
