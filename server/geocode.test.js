const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createGeocoder } = require("./geocode");

function tmpCacheFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "geocode-test-")), "cache.json");
}

function loadCacheFile(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return {};
  }
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

test("geocode returns null on fetch failure instead of throwing, and does NOT cache it", async (t) => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  let callCount = 0;
  global.fetch = async () => { callCount++; throw new Error("network down"); };

  const file = tmpCacheFile();
  const { geocode } = createGeocoder(file);
  assert.equal(await geocode("Some Place"), null);
  assert.equal(await geocode("Some Place"), null);
  assert.equal(callCount, 2, "a thrown error must not be cached - every call should retry the fetch");
  assert.deepEqual(loadCacheFile(file), {}, "cache file should stay empty after only failures");
});

test("geocode returns null on non-ok HTTP response and does NOT cache it", async (t) => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  let callCount = 0;
  global.fetch = async () => { callCount++; return { ok: false, status: 429, json: async () => { throw new Error("should not parse body"); } }; };

  const file = tmpCacheFile();
  const { geocode } = createGeocoder(file);
  assert.equal(await geocode("Some Place"), null);
  assert.equal(await geocode("Some Place"), null);
  assert.equal(callCount, 2, "a rate-limit/block response must not be cached - every call should retry the fetch");
  assert.deepEqual(loadCacheFile(file), {}, "cache file should stay empty after only rate-limit failures");
});

test("concurrent geocode calls are serialized to at least MIN_INTERVAL_MS apart", async (t) => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  const callTimes = [];
  global.fetch = async () => {
    callTimes.push(Date.now());
    return { ok: true, json: async () => [] };
  };

  const { geocode } = createGeocoder(tmpCacheFile());
  // 3 concurrent callers, distinct texts so none hit the cache and skip the fetch.
  await Promise.all([geocode("Place A"), geocode("Place B"), geocode("Place C")]);

  assert.equal(callTimes.length, 3);
  const gaps = callTimes.slice(1).map((t, i) => t - callTimes[i]);
  for (const gap of gaps) {
    assert.ok(gap >= 1000, `expected concurrent calls to be spaced out (>=1000ms), got gap of ${gap}ms`);
  }
});

test("geocode returns null for empty input without calling fetch", async (t) => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  global.fetch = async () => { throw new Error("should not be called"); };

  const { geocode } = createGeocoder(tmpCacheFile());
  assert.equal(await geocode(""), null);
});
