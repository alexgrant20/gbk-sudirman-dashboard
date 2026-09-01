const fs = require("fs");
const path = require("path");

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const MIN_INTERVAL_MS = 1100; // stay under Nominatim's 1 req/sec usage policy

function loadCache(cacheFile) {
  try {
    return JSON.parse(fs.readFileSync(cacheFile, "utf8"));
  } catch {
    return {};
  }
}

function cacheKey(text) {
  return text.trim().toLowerCase();
}

// Looks up free-text location strings via Nominatim (OpenStreetMap), caching
// results (including misses, as null) in cacheFile so repeated venue text
// across scraper runs doesn't re-hit the API or the rate limit. Never throws -
// callers must treat a null result as "no coordinates for this event" rather
// than fail the whole scrape.
function createGeocoder(cacheFile) {
  let cache = loadCache(cacheFile);
  let lastRequestAt = 0;
  // Serializes throttle() calls across concurrent callers so no two requests
  // fire within MIN_INTERVAL_MS of each other, regardless of how many workers
  // call geocode() at once. Without this chain, concurrent callers all read
  // the same stale lastRequestAt, compute the same wait, and fire together.
  let throttleQueue = Promise.resolve();

  function saveCache() {
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    fs.writeFileSync(cacheFile, JSON.stringify(cache, null, 2));
  }

  function throttle() {
    const result = throttleQueue.then(async () => {
      const wait = MIN_INTERVAL_MS - (Date.now() - lastRequestAt);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      lastRequestAt = Date.now();
    });
    // Keep the queue alive even if this link's caller later throws - the
    // chain itself never rejects since throttle's body can't throw.
    throttleQueue = result;
    return result;
  }

  async function geocode(text) {
    if (!text) return null;
    const key = cacheKey(text);
    if (key in cache) return cache[key];

    await throttle();
    let place = null;
    // Only cache a definitive "no results" outcome. A non-ok response (e.g.
    // 429/403 rate-limit or block) or a thrown exception is a transient
    // failure, not evidence the place doesn't exist - don't poison the cache
    // with it, so a future run can retry.
    let shouldCache = false;
    try {
      const url = `${NOMINATIM_URL}?format=json&limit=1&countrycodes=id&q=${encodeURIComponent(text)}`;
      const res = await fetch(url, {
        headers: { "User-Agent": "GBKEventDashboard/2.0 (running-events scraper)" },
      });
      if (res.ok) {
        const results = await res.json();
        shouldCache = true;
        if (results.length) {
          place = {
            label: results[0].display_name,
            lat: Number(results[0].lat),
            lon: Number(results[0].lon),
          };
        }
      }
    } catch {
      place = null;
      shouldCache = false;
    }

    if (shouldCache) {
      cache[key] = place;
      saveCache();
    }
    return place;
  }

  return { geocode };
}

const defaultCacheFile = path.join(__dirname, "data", "geocodeCache.json");
const defaultGeocoder = createGeocoder(defaultCacheFile);

module.exports = { geocode: defaultGeocoder.geocode, createGeocoder };
