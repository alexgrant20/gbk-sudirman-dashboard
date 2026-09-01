# Nationwide Running Events Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pivot the GBK/Sudirman conflict-checking dashboard into a nationwide Indonesia running-event tracker with per-category price/cutoff, route images, and route lines where real geodata exists — scraped on a schedule by GitHub Actions and served as a static site on GitHub Pages.

**Architecture:** `server/scrapers/run.js` orchestrates a set of source modules (jadwallari.id, raceRegistry [race.id/Loket/RunSociety], newsRoundup, Instagram) behind a shared `Event` shape, writes `public/data/events.json` + downloaded route images, and is invoked by a GitHub Actions cron workflow that commits the result. `public/` is a plain static site (Leaflet map + vanilla JS) with no backend — `app.js` fetches `./data/events.json` directly.

**Tech Stack:** Node.js ≥18 (global `fetch`, `node:test`), cheerio (HTML parsing), Playwright (headless browser for Instagram), OpenStreetMap Nominatim (geocoding), Leaflet + Leaflet.markercluster (existing frontend map), GitHub Actions (scheduling), GitHub Pages (hosting).

**Spec:** `docs/superpowers/specs/2026-09-01-nationwide-running-events-design.md`

## Global Constraints

- Node engine floor stays `>=18.0.0` (unchanged from current `package.json`).
- No runtime server: `server.js` and Express are removed; nothing in `server/` runs outside of a scrape invocation.
- Every scraper module keeps the existing `async scrape() -> Event[]` interface so `run.js`'s `Promise.allSettled` isolation pattern keeps working unchanged.
- `geocode()` becomes **async** (Nominatim is a network call) — every caller must `await` it.
- `routeGeo` is only ever set from real geodata (GPX/Strava/KML) — never inferred from an image, by any scraper.
- Instagram scraping (`server/scrapers/instagram/`) gets `retries: 0` in the source config — never retried automatically.
- Event objects may have `null`/missing fields beyond `id`, `name`, `date`, `source` — no scraper or frontend code may assume completeness.

---

### Task 1: Remove deprecated GBK-specific server and data

**Files:**
- Delete: `server/server.js`
- Delete: `server/scrapers/cfdSchedule.js`
- Delete: `server/scrapers/gbkNews.js`
- Delete: `server/data/venues.json`
- Delete: `server/data/events.json`
- Modify: `package.json` (remove `express` dependency and the `start` script; these are re-added correctly in Task 14)

**Interfaces:**
- Produces: nothing yet — this is pure removal. Later tasks recreate replacements (`geocode.js` rewrite in Task 3, `newsRoundup.js` in Task 10, `public/data/events.json` in Task 13).

- [ ] **Step 1: Delete the files**

```bash
git rm server/server.js server/scrapers/cfdSchedule.js server/scrapers/gbkNews.js server/data/venues.json server/data/events.json
```

- [ ] **Step 2: Remove `express` from `package.json`**

Edit `package.json`: remove the `"express": "^4.19.2"` line from `dependencies`, and remove the `"start": "node server/server.js"` line from `scripts` (keep `"scrape"`).

- [ ] **Step 3: Verify nothing else references the deleted files**

Run: `grep -rn "cfdSchedule\|gbkNews\|venues.json\|server/server" server public --include=*.js --include=*.html` (excluding `node_modules`)
Expected: no matches (later tasks will reintroduce `server/data/geocodeCache.json` and `public/data/events.json` under new paths, which is fine — this check is only for the deleted filenames).

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "chore: remove GBK-specific server, scrapers, and venue data"
```

---

### Task 2: Shared scraper utilities

**Files:**
- Create: `server/scrapers/scraperUtils.js`
- Test: `server/scrapers/scraperUtils.test.js`

**Interfaces:**
- Produces:
  - `mapWithConcurrency(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>) -> Promise<R[]>`
  - `dedupeKey(event: {source, name, date}) -> string`
  - `parseCategoriesFromText(text: string) -> Array<{distance: string, price: null, cutoffMinutes: null}>`
  - `parseIndoDate(text: string) -> string|null` (ISO `YYYY-MM-DD`, parses `"16 Januari 2026"`-style Indonesian dates)
  - `downloadRouteImage(url: string, destDir: string, id: string) -> Promise<string|null>` (returns filename written, or `null`)

- [ ] **Step 1: Write the failing tests**

```js
// server/scrapers/scraperUtils.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  mapWithConcurrency,
  dedupeKey,
  parseCategoriesFromText,
  parseIndoDate,
} = require("./scraperUtils");

test("mapWithConcurrency preserves order and respects the limit", async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  const result = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (n) => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight--;
    return n * 10;
  });
  assert.deepEqual(result, [10, 20, 30, 40, 50]);
  assert.ok(maxInFlight <= 2, `expected max 2 in flight, got ${maxInFlight}`);
});

test("dedupeKey combines source, name, and date case-insensitively", () => {
  const a = dedupeKey({ source: "jadwallari.id", name: "Victoria Run", date: "2026-10-11" });
  const b = dedupeKey({ source: "JADWALLARI.ID", name: "victoria run", date: "2026-10-11" });
  assert.equal(a, b);
});

test("parseCategoriesFromText splits on commas and slashes", () => {
  assert.deepEqual(parseCategoriesFromText("5K, 10K, HM"), [
    { distance: "5K", price: null, cutoffMinutes: null },
    { distance: "10K", price: null, cutoffMinutes: null },
    { distance: "HM", price: null, cutoffMinutes: null },
  ]);
});

test("parseCategoriesFromText returns [] for empty input", () => {
  assert.deepEqual(parseCategoriesFromText(""), []);
  assert.deepEqual(parseCategoriesFromText(null), []);
});

test("parseIndoDate parses a full Indonesian date", () => {
  assert.equal(parseIndoDate("16 Januari 2026"), "2026-01-16");
  assert.equal(parseIndoDate("6 September 2026"), "2026-09-06");
});

test("parseIndoDate returns null when no date is found", () => {
  assert.equal(parseIndoDate("no date here"), null);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test server/scrapers/scraperUtils.test.js`
Expected: FAIL — `Cannot find module './scraperUtils'`

- [ ] **Step 3: Implement `scraperUtils.js`**

```js
// server/scrapers/scraperUtils.js
const fs = require("fs");
const path = require("path");

async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function dedupeKey(ev) {
  return `${ev.source}|${ev.name}|${ev.date}`.toLowerCase();
}

// "5K, 10K, HM" -> [{distance:"5K",price:null,cutoffMinutes:null}, ...]
// price/cutoffMinutes are left null here - callers fill them in when a source
// gives structured per-category data (see raceRegistry's schemaEventToOurEvent).
function parseCategoriesFromText(text) {
  if (!text) return [];
  return text
    .split(/[,/]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((distance) => ({ distance, price: null, cutoffMinutes: null }));
}

const ID_MONTHS = {
  januari: "01", februari: "02", maret: "03", april: "04", mei: "05",
  juni: "06", juli: "07", agustus: "08", september: "09",
  oktober: "10", november: "11", desember: "12",
};

// Finds the first "<day> <Indonesian month name> <year>" in free text and
// returns it as an ISO date. Used by scrapers that only have prose to work
// with (news roundups, Instagram captions) rather than a structured date field.
function parseIndoDate(text) {
  if (!text) return null;
  const monthPattern = Object.keys(ID_MONTHS).join("|");
  const re = new RegExp(`(\\d{1,2})\\s+(${monthPattern})\\s+(\\d{4})`, "i");
  const m = text.match(re);
  if (!m) return null;
  const day = m[1].padStart(2, "0");
  const month = ID_MONTHS[m[2].toLowerCase()];
  const year = m[3];
  return `${year}-${month}-${day}`;
}

// Downloads a scraped route-map image into destDir/<id>.<ext> for committing
// alongside events.json. Never throws - returns null on any failure so a
// broken image URL doesn't fail the whole scrape run.
async function downloadRouteImage(url, destDir, id) {
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const ext = (url.split(".").pop() || "jpg").split("?")[0].slice(0, 4);
    const filename = `${id}.${ext}`;
    fs.mkdirSync(destDir, { recursive: true });
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(path.join(destDir, filename), buf);
    return filename;
  } catch {
    return null;
  }
}

module.exports = {
  mapWithConcurrency,
  dedupeKey,
  parseCategoriesFromText,
  parseIndoDate,
  downloadRouteImage,
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test server/scrapers/scraperUtils.test.js`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add server/scrapers/scraperUtils.js server/scrapers/scraperUtils.test.js
git commit -m "feat: add shared scraper utilities"
```

---

### Task 3: Nationwide geocoding via Nominatim

**Files:**
- Modify: `server/geocode.js` (full rewrite)
- Test: `server/geocode.test.js`
- Create: `server/data/.gitkeep` (only if `server/data/` would otherwise be empty after Task 1's deletions — check first)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `geocode(text: string) -> Promise<{label: string, lat: number, lon: number} | null>` (default instance, backed by `server/data/geocodeCache.json`)
  - `createGeocoder(cacheFile: string) -> { geocode: (text: string) => Promise<Place|null> }` (factory, used by tests to avoid touching the real cache file and by `geocode` itself)

- [ ] **Step 1: Write the failing tests**

```js
// server/geocode.test.js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test server/geocode.test.js`
Expected: FAIL — `createGeocoder is not a function` (current `geocode.js` only exports `geocode`/`venues`)

- [ ] **Step 3: Rewrite `geocode.js`**

```js
// server/geocode.js
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

  function saveCache() {
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    fs.writeFileSync(cacheFile, JSON.stringify(cache, null, 2));
  }

  async function throttle() {
    const wait = MIN_INTERVAL_MS - (Date.now() - lastRequestAt);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastRequestAt = Date.now();
  }

  async function geocode(text) {
    if (!text) return null;
    const key = cacheKey(text);
    if (key in cache) return cache[key];

    await throttle();
    let place = null;
    try {
      const url = `${NOMINATIM_URL}?format=json&limit=1&countrycodes=id&q=${encodeURIComponent(text)}`;
      const res = await fetch(url, {
        headers: { "User-Agent": "GBKEventDashboard/2.0 (running-events scraper)" },
      });
      if (res.ok) {
        const results = await res.json();
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
    }

    cache[key] = place;
    saveCache();
    return place;
  }

  return { geocode };
}

const defaultCacheFile = path.join(__dirname, "data", "geocodeCache.json");
const defaultGeocoder = createGeocoder(defaultCacheFile);

module.exports = { geocode: defaultGeocoder.geocode, createGeocoder };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test server/geocode.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: Ensure `server/data/` still exists for the default cache file**

Run: `ls server/data` — Task 1 deleted `venues.json` and `events.json` from this directory; if `newsSources.json` is still there it's fine as-is. If the directory is now empty, run `touch server/data/.gitkeep` and `git add server/data/.gitkeep` (an empty directory can't be committed on its own, and `geocode.js` creates the cache file at runtime via `fs.mkdirSync`, but keeping the directory tracked avoids relying on that on a fresh checkout before the first scrape).

- [ ] **Step 6: Commit**

```bash
git add server/geocode.js server/geocode.test.js
git commit -m "feat: replace hardcoded venue geocoder with Nominatim lookup"
```

---

### Task 4: Widen jadwallari.js to nationwide

**Files:**
- Modify: `server/scrapers/jadwallari.js`
- Test: `server/scrapers/jadwallari.test.js`

**Interfaces:**
- Consumes: `geocode` from `server/geocode.js` (now async — every call site must `await`), `parseCategoriesFromText` from `server/scrapers/scraperUtils.js`.
- Produces: `scrape() -> Promise<Event[]>` (unchanged interface, now nationwide, `categories` replaces `distances`).

- [ ] **Step 1: Write the failing test for the pure date parser (already covered logic, now testing the file's own copy stays correct after edits)**

```js
// server/scrapers/jadwallari.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const cheerio = require("cheerio");

// jadwallari.js doesn't export parseIndoDate (it's file-local), so this test
// exercises it indirectly through a minimal fixture table run through cheerio,
// matching how the real scraper parses rows.
const FIXTURE_TABLE_HTML = `
<table id="tablepress-1">
  <tbody>
    <tr>
      <td>11 Oktober 2026</td>
      <td><a href="https://jadwallari.id/events/victoria-run/">Victoria Run 2026</a></td>
      <td>5K, 10K, HM</td>
      <td>Road Run</td>
      <td>Jakarta Pusat, DKI Jakarta</td>
    </tr>
    <tr>
      <td>18 Oktober 2026</td>
      <td><a href="https://jadwallari.id/events/bali-run/">Bali Sunrise Run</a></td>
      <td>10K</td>
      <td>Road Run</td>
      <td>Denpasar, Bali</td>
    </tr>
  </tbody>
</table>`;

test("fixture table rows parse into candidate rows regardless of city", () => {
  const $ = cheerio.load(FIXTURE_TABLE_HTML);
  const rows = [];
  $("table tbody tr").each((_, row) => {
    const cells = $(row).find("td");
    rows.push({
      dateRaw: $(cells[0]).text().trim(),
      name: $(cells[1]).text().trim(),
      location: $(cells[4]).text().trim(),
    });
  });
  assert.equal(rows.length, 2);
  assert.equal(rows[1].location, "Denpasar, Bali");
});
```

- [ ] **Step 2: Run the test to verify it passes as a sanity check on the fixture shape**

Run: `node --test server/scrapers/jadwallari.test.js`
Expected: PASS (this test doesn't touch `jadwallari.js` itself yet — it documents the row shape the real scraper must keep handling after Step 3's edit removes the Jakarta-only filter)

- [ ] **Step 3: Edit `jadwallari.js` — remove the area filter, switch to `categories`, await `geocode`**

In `server/scrapers/jadwallari.js`:

1. Delete the `AREA_KEYWORDS` constant and its two usages (the pre-filter in the row loop, and the `isRelevant` check after fetching the precise venue) — every row that has a name/date now becomes a candidate, nationwide.
2. Add at the top: `const { parseCategoriesFromText } = require("./scraperUtils");`
3. In `scrape()`'s `table.find("tbody tr, tr").each(...)` loop, delete these two lines (the pre-filter):
   ```js
   const relevant = locLower.includes("jakarta pusat") || AREA_KEYWORDS.test(nameLower) || AREA_KEYWORDS.test(locLower);
   if (!relevant) return;
   ```
   and the now-unused `locLower`/`nameLower` declarations above them.
4. In the `mapWithConcurrency` callback, delete:
   ```js
   const combinedText = `${c.name} ${preciseVenue || c.location}`;
   const isRelevant = (place && !place.tier) || AREA_KEYWORDS.test(combinedText);
   if (!isRelevant) return null;
   ```
5. Change `const place = geocode(geocodeText) || geocode(c.location);` to:
   ```js
   const place = (await geocode(geocodeText)) || (await geocode(c.location));
   ```
6. Simplify confidence tiering (the old code checked `!place.tier`, which no longer exists since `venues.json`'s tiered keyword table is gone):
   ```js
   let confidence = "low";
   if (place && preciseVenue) confidence = "high";
   else if (place) confidence = "medium";
   ```
7. Replace the returned object's `distances: c.distances,` field with:
   ```js
   categories: parseCategoriesFromText(c.distances),
   routeImage: null,
   routeGeo: null,
   ```
   (keep `category: c.type || "Running Event",` as-is)

- [ ] **Step 4: Run against the live site and confirm nationwide results**

Run: `node -e "require('./server/scrapers/jadwallari').scrape().then(evs => { console.log(evs.length, 'events'); console.log(evs.slice(0,3)); })"`
Expected: events from cities beyond Jakarta appear (not just GBK-area venues), each with a `categories` array instead of a `distances` string, and no crash (confirms the `await geocode(...)` change didn't break the flow — Nominatim's real rate limit means this run takes a while for a large candidate list, which is expected).

- [ ] **Step 5: Commit**

```bash
git add server/scrapers/jadwallari.js server/scrapers/jadwallari.test.js
git commit -m "feat: widen jadwallari.id scraper to nationwide, use categories"
```

---

### Task 5: JSON-LD event extraction + shared platform scraper factory

**Files:**
- Create: `server/scrapers/raceRegistry/jsonLdEvent.js`
- Create: `server/scrapers/raceRegistry/platformScraper.js`
- Test: `server/scrapers/raceRegistry/jsonLdEvent.test.js`
- Test: `server/scrapers/raceRegistry/platformScraper.test.js`

**Interfaces:**
- Consumes: `mapWithConcurrency`, `parseCategoriesFromText` from `server/scrapers/scraperUtils.js`; `geocode` from `server/geocode.js`; `isTodayOrFuture` from `server/dateUtils.js`.
- Produces:
  - `extractJsonLdEvents(html: string) -> object[]` (raw schema.org Event objects found in `<script type="application/ld+json">` tags, including ones nested under `@graph`)
  - `schemaEventToOurEvent(schemaEvent: object, detailUrl: string, sourceLabel: string) -> Event|null`
  - `createPlatformScraper({ name, listingUrls, extractLinks, sourceLabel }) -> { scrape: () => Promise<Event[]> }`, where `extractLinks($: CheerioAPI) -> string[]` is supplied per-platform in Task 6-8.

- [ ] **Step 1: Write the failing tests for `extractJsonLdEvents`**

```js
// server/scrapers/raceRegistry/jsonLdEvent.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const { extractJsonLdEvents } = require("./jsonLdEvent");

const SINGLE_EVENT_HTML = `<html><head>
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"Event","name":"Bali Sunrise Run","startDate":"2026-11-02"}
</script>
</head></html>`;

const GRAPH_HTML = `<html><head>
<script type="application/ld+json">
{"@context":"https://schema.org","@graph":[
  {"@type":"WebPage","name":"Home"},
  {"@type":"Event","name":"Surabaya City Run","startDate":"2026-12-01"}
]}
</script>
</head></html>`;

const NO_EVENT_HTML = `<html><head>
<script type="application/ld+json">{"@type":"Organization","name":"Acme"}</script>
</head></html>`;

test("extracts a top-level Event", () => {
  const events = extractJsonLdEvents(SINGLE_EVENT_HTML);
  assert.equal(events.length, 1);
  assert.equal(events[0].name, "Bali Sunrise Run");
});

test("extracts an Event nested under @graph", () => {
  const events = extractJsonLdEvents(GRAPH_HTML);
  assert.equal(events.length, 1);
  assert.equal(events[0].name, "Surabaya City Run");
});

test("returns [] when there is no Event", () => {
  assert.deepEqual(extractJsonLdEvents(NO_EVENT_HTML), []);
});

test("returns [] for malformed JSON without throwing", () => {
  assert.deepEqual(extractJsonLdEvents(`<script type="application/ld+json">{not json</script>`), []);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test server/scrapers/raceRegistry/jsonLdEvent.test.js`
Expected: FAIL — module doesn't exist yet

- [ ] **Step 3: Implement `jsonLdEvent.js`**

```js
// server/scrapers/raceRegistry/jsonLdEvent.js
const cheerio = require("cheerio");

function isEventType(type) {
  return type === "Event" || (Array.isArray(type) && type.includes("Event"));
}

// Extracts schema.org Event objects from a page's JSON-LD script tags.
// Ticketing/registration platforms (Loket, RunSociety, race.id) commonly embed
// structured event data this way for SEO - far more stable to parse than
// hand-picked CSS classes that change with every redesign.
function extractJsonLdEvents(html) {
  const $ = cheerio.load(html);
  const events = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    let data;
    try {
      data = JSON.parse($(el).contents().text());
    } catch {
      return;
    }
    const items = Array.isArray(data) ? data : [data];
    for (const item of items) {
      if (isEventType(item["@type"])) events.push(item);
      if (Array.isArray(item["@graph"])) {
        for (const g of item["@graph"]) {
          if (isEventType(g["@type"])) events.push(g);
        }
      }
    }
  });
  return events;
}

module.exports = { extractJsonLdEvents };
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test server/scrapers/raceRegistry/jsonLdEvent.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: Write the failing tests for `schemaEventToOurEvent` and `createPlatformScraper`**

```js
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
```

- [ ] **Step 6: Run to verify failure**

Run: `node --test server/scrapers/raceRegistry/platformScraper.test.js`
Expected: FAIL — module doesn't exist yet

- [ ] **Step 7: Implement `platformScraper.js`**

```js
// server/scrapers/raceRegistry/platformScraper.js
const cheerio = require("cheerio");
const { extractJsonLdEvents } = require("./jsonLdEvent");
const { mapWithConcurrency, parseCategoriesFromText } = require("../scraperUtils");
const { geocode } = require("../../geocode");
const { isTodayOrFuture } = require("../../dateUtils");

const DETAIL_FETCH_CONCURRENCY = 5;
const RUNNING_KEYWORDS = /run|lari|marathon|maraton/i;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function schemaEventToOurEvent(schemaEvent, detailUrl, sourceLabel) {
  const startDate = (schemaEvent.startDate || "").slice(0, 10);
  if (!ISO_DATE_RE.test(startDate)) return null;

  const offersRaw = schemaEvent.offers;
  const offers = Array.isArray(offersRaw) ? offersRaw : offersRaw ? [offersRaw] : [];
  const categories = offers.length
    ? offers.map((o) => ({
        distance: o.name || "General",
        price: o.price != null ? Number(o.price) : null,
        cutoffMinutes: null,
      }))
    : parseCategoriesFromText(schemaEvent.description);

  const venue = (schemaEvent.location && schemaEvent.location.name) || "";
  const geo = schemaEvent.location && schemaEvent.location.geo;
  const hasGeo = geo && geo.latitude != null && geo.longitude != null;

  return {
    name: schemaEvent.name || "Untitled event",
    date: startDate,
    dateRaw: schemaEvent.startDate || startDate,
    categories,
    category: "Road Run",
    location: venue,
    venue,
    lat: hasGeo ? Number(geo.latitude) : null,
    lon: hasGeo ? Number(geo.longitude) : null,
    routeImage: null,
    routeGeo: null,
    sourceUrl: detailUrl,
    source: sourceLabel,
    confidence: hasGeo ? "high" : "medium",
  };
}

async function resolveMissingGeo(event) {
  if (event.lat != null && event.lon != null) return event;
  const place = (await geocode(`${event.name} ${event.venue}`)) || (await geocode(event.venue));
  if (!place) return event;
  return { ...event, lat: place.lat, lon: place.lon, venue: event.venue || place.label };
}

function createPlatformScraper({ name, listingUrls, extractLinks, sourceLabel }) {
  async function fetchHtml(url) {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; GBKEventDashboard/2.0)" },
    });
    if (!res.ok) throw new Error(`${name} fetch failed: ${res.status} ${url}`);
    return res.text();
  }

  async function scrape() {
    const links = new Set();
    for (const listingUrl of listingUrls) {
      const html = await fetchHtml(listingUrl);
      extractLinks(cheerio.load(html)).forEach((l) => links.add(l));
    }

    const detailResults = await mapWithConcurrency([...links], DETAIL_FETCH_CONCURRENCY, async (url) => {
      try {
        const html = await fetchHtml(url);
        const schemaEvents = extractJsonLdEvents(html).filter((e) =>
          RUNNING_KEYWORDS.test(`${e.name || ""} ${e.description || ""}`)
        );
        return schemaEvents.map((se) => schemaEventToOurEvent(se, url, sourceLabel)).filter(Boolean);
      } catch (err) {
        console.warn(`[${name}] failed ${url}: ${err.message}`);
        return [];
      }
    });

    const flat = detailResults.flat().filter((ev) => isTodayOrFuture(ev.date));
    return mapWithConcurrency(flat, DETAIL_FETCH_CONCURRENCY, resolveMissingGeo);
  }

  return { scrape };
}

module.exports = { createPlatformScraper, schemaEventToOurEvent };
```

- [ ] **Step 8: Run to verify pass**

Run: `node --test server/scrapers/raceRegistry/platformScraper.test.js`
Expected: PASS (5 tests)

- [ ] **Step 9: Commit**

```bash
git add server/scrapers/raceRegistry/jsonLdEvent.js server/scrapers/raceRegistry/jsonLdEvent.test.js server/scrapers/raceRegistry/platformScraper.js server/scrapers/raceRegistry/platformScraper.test.js
git commit -m "feat: add JSON-LD extraction and shared race-registry platform scraper"
```

---

### Task 6: race.id scraper module

**Files:**
- Create: `server/scrapers/raceRegistry/raceId.js`
- Test: `server/scrapers/raceRegistry/raceId.test.js`

**Interfaces:**
- Consumes: `createPlatformScraper` from `./platformScraper.js`.
- Produces: `scrape() -> Promise<Event[]>` (via the object exported by `createPlatformScraper`), `source: "raceRegistry:race.id"`.

- [ ] **Step 1: Write the failing test for the link extractor**

```js
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
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test server/scrapers/raceRegistry/raceId.test.js`
Expected: FAIL — module doesn't exist yet

- [ ] **Step 3: Implement `raceId.js`**

```js
// server/scrapers/raceRegistry/raceId.js
const { createPlatformScraper } = require("./platformScraper");

// race.id lists running events as cards linking to "/event/<slug>" detail pages.
function extractLinks($) {
  const links = new Set();
  $('a[href*="/event/"]').each((_, el) => {
    const href = $(el).attr("href");
    if (href) links.add(new URL(href, "https://www.race.id").toString());
  });
  return [...links];
}

const scraper = createPlatformScraper({
  name: "race.id",
  listingUrls: ["https://www.race.id/event-category/running/"],
  extractLinks,
  sourceLabel: "raceRegistry:race.id",
});

module.exports = { ...scraper, extractLinks };
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test server/scrapers/raceRegistry/raceId.test.js`
Expected: PASS

- [ ] **Step 5: Run against the live site and sanity-check the selector**

Run: `node -e "require('./server/scrapers/raceRegistry/raceId').scrape().then(evs => console.log(evs.length, evs.slice(0,2)))"`
Expected: at least one event with a non-null `date`. If it returns 0, inspect `https://www.race.id/event-category/running/`'s current markup with a browser devtools "view source" and adjust the `listingUrls` path or `extractLinks` selector in `raceId.js` to match — this is expected periodic scraper maintenance, not a plan gap.

- [ ] **Step 6: Commit**

```bash
git add server/scrapers/raceRegistry/raceId.js server/scrapers/raceRegistry/raceId.test.js
git commit -m "feat: add race.id scraper"
```

---

### Task 7: Loket scraper module

**Files:**
- Create: `server/scrapers/raceRegistry/loket.js`
- Test: `server/scrapers/raceRegistry/loket.test.js`

**Interfaces:**
- Consumes: `createPlatformScraper` from `./platformScraper.js`.
- Produces: `scrape() -> Promise<Event[]>`, `source: "raceRegistry:loket"`.

- [ ] **Step 1: Write the failing test**

```js
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
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test server/scrapers/raceRegistry/loket.test.js`
Expected: FAIL — module doesn't exist yet

- [ ] **Step 3: Implement `loket.js`**

```js
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
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test server/scrapers/raceRegistry/loket.test.js`
Expected: PASS

- [ ] **Step 5: Run against the live site and sanity-check the selector**

Run: `node -e "require('./server/scrapers/raceRegistry/loket').scrape().then(evs => console.log(evs.length, evs.slice(0,2)))"`
Expected: same as Task 6 Step 5 — adjust `listingUrls`/`extractLinks` against the real current markup if it returns 0.

- [ ] **Step 6: Commit**

```bash
git add server/scrapers/raceRegistry/loket.js server/scrapers/raceRegistry/loket.test.js
git commit -m "feat: add Loket scraper"
```

---

### Task 8: RunSociety scraper module

**Files:**
- Create: `server/scrapers/raceRegistry/runSociety.js`
- Test: `server/scrapers/raceRegistry/runSociety.test.js`

**Interfaces:**
- Consumes: `createPlatformScraper` from `./platformScraper.js`.
- Produces: `scrape() -> Promise<Event[]>`, `source: "raceRegistry:runSociety"`.

- [ ] **Step 1: Write the failing test**

```js
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
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test server/scrapers/raceRegistry/runSociety.test.js`
Expected: FAIL — module doesn't exist yet

- [ ] **Step 3: Implement `runSociety.js`**

```js
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
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test server/scrapers/raceRegistry/runSociety.test.js`
Expected: PASS

- [ ] **Step 5: Run against the live site and sanity-check the selector**

Run: `node -e "require('./server/scrapers/raceRegistry/runSociety').scrape().then(evs => console.log(evs.length, evs.slice(0,2)))"`
Expected: same as Task 6 Step 5.

- [ ] **Step 6: Commit**

```bash
git add server/scrapers/raceRegistry/runSociety.js server/scrapers/raceRegistry/runSociety.test.js
git commit -m "feat: add RunSociety scraper"
```

---

### Task 9: raceRegistry aggregator

**Files:**
- Create: `server/scrapers/raceRegistry/index.js`
- Test: `server/scrapers/raceRegistry/index.test.js`

**Interfaces:**
- Consumes: `scrape()` from `./raceId.js`, `./loket.js`, `./runSociety.js`.
- Produces: `scrape() -> Promise<Event[]>` — the single entry point `server/scrapers/index.js` (Task 13) registers as the `"raceRegistry"` source.

- [ ] **Step 1: Write the failing test**

```js
// server/scrapers/raceRegistry/index.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("module");

test("scrape merges results from all three platforms and isolates failures", async (t) => {
  const originalLoad = Module._load;
  t.after(() => { Module._load = originalLoad; });

  Module._load = function (request, ...rest) {
    if (request.endsWith("./raceId")) return { scrape: async () => [{ name: "A", source: "raceRegistry:race.id" }] };
    if (request.endsWith("./loket")) return { scrape: async () => { throw new Error("blocked"); } };
    if (request.endsWith("./runSociety")) return { scrape: async () => [{ name: "B", source: "raceRegistry:runSociety" }] };
    return originalLoad.call(this, request, ...rest);
  };

  delete require.cache[require.resolve("./index")];
  const { scrape } = require("./index");
  const events = await scrape();
  assert.deepEqual(events.map((e) => e.name).sort(), ["A", "B"]);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test server/scrapers/raceRegistry/index.test.js`
Expected: FAIL — module doesn't exist yet

- [ ] **Step 3: Implement `index.js`**

```js
// server/scrapers/raceRegistry/index.js
const raceId = require("./raceId");
const loket = require("./loket");
const runSociety = require("./runSociety");

const PLATFORMS = [
  { label: "race.id", module: raceId },
  { label: "loket", module: loket },
  { label: "runSociety", module: runSociety },
];

async function scrape() {
  const results = await Promise.allSettled(PLATFORMS.map((p) => p.module.scrape()));
  const events = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") {
      events.push(...r.value);
    } else {
      console.warn(`[raceRegistry] ${PLATFORMS[i].label} failed: ${r.reason.message}`);
    }
  });
  return events;
}

module.exports = { scrape };
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test server/scrapers/raceRegistry/index.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/scrapers/raceRegistry/index.js server/scrapers/raceRegistry/index.test.js
git commit -m "feat: add raceRegistry aggregator combining race.id, Loket, RunSociety"
```

---

### Task 10: newsRoundup.js (replaces gbkNews.js)

**Files:**
- Create: `server/scrapers/newsRoundup.js`
- Test: `server/scrapers/newsRoundup.test.js`
- Modify: `server/data/newsSources.json` (no schema change — same array-of-URLs shape `gbkNews.js` used; update its contents over time to nationwide sports/news sources as you find them)

**Interfaces:**
- Consumes: `geocode` from `server/geocode.js`, `parseIndoDate` from `server/scrapers/scraperUtils.js`, `isTodayOrFuture` from `server/dateUtils.js`.
- Produces: `scrape() -> Promise<Event[]>`, `source: "news"`.

- [ ] **Step 1: Write the failing tests**

```js
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
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test server/scrapers/newsRoundup.test.js`
Expected: FAIL — module doesn't exist yet

- [ ] **Step 3: Implement `newsRoundup.js`**

```js
// server/scrapers/newsRoundup.js
const fs = require("fs");
const path = require("path");
const cheerio = require("cheerio");
const { geocode: defaultGeocode } = require("../geocode");
const { parseIndoDate } = require("./scraperUtils");
const { isTodayOrFuture } = require("../dateUtils");

const DEFAULT_SOURCES_FILE = path.join(__dirname, "..", "data", "newsSources.json");

// Best-effort scraper: news roundup articles are unstructured prose, not a feed.
// Each configured source URL becomes at most one low-confidence "see article" event
// card, geocoded from whatever venue text can be pulled out of the article.
// Individual sources are skipped (not fatal) if the site blocks scraping or the
// request otherwise fails - geocode and the sources file are injectable so this is
// testable without hitting the network or the real data file.
function createNewsRoundupScraper({ sourcesFile = DEFAULT_SOURCES_FILE, geocode = defaultGeocode } = {}) {
  async function scrape() {
    let sources = [];
    try {
      sources = JSON.parse(fs.readFileSync(sourcesFile, "utf8"));
    } catch {
      return [];
    }

    const events = [];
    for (const url of sources) {
      try {
        const res = await fetch(url, {
          headers: { "User-Agent": "Mozilla/5.0 (compatible; GBKEventDashboard/2.0)" },
        });
        if (!res.ok) {
          console.warn(`[newsRoundup] skipped ${url}: HTTP ${res.status}`);
          continue;
        }
        const html = await res.text();
        const $ = cheerio.load(html);
        const title = $("h1").first().text().trim() || $("title").text().trim();
        const bodyText = $("article, body").first().text().replace(/\s+/g, " ").trim();

        const date = parseIndoDate(title) || parseIndoDate(bodyText);
        if (!date) {
          console.warn(`[newsRoundup] no date found in ${url}, skipping`);
          continue;
        }
        if (!isTodayOrFuture(date)) continue;

        const place = (await geocode(title)) || (await geocode(bodyText.slice(0, 2000)));

        events.push({
          name: title || "Running event roundup",
          date,
          dateRaw: date,
          categories: [],
          category: "News roundup",
          location: place ? place.label : "",
          venue: place ? place.label : "",
          lat: place ? place.lat : null,
          lon: place ? place.lon : null,
          routeImage: null,
          routeGeo: null,
          sourceUrl: url,
          source: "news",
          confidence: "low",
        });
      } catch (err) {
        console.warn(`[newsRoundup] failed ${url}: ${err.message}`);
      }
    }
    return events;
  }

  return { scrape };
}

module.exports = { ...createNewsRoundupScraper(), createNewsRoundupScraper };
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test server/scrapers/newsRoundup.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add server/scrapers/newsRoundup.js server/scrapers/newsRoundup.test.js
git commit -m "feat: replace gbkNews with nationwide newsRoundup scraper"
```

---

### Task 11: Instagram caption parser (pure, testable)

**Files:**
- Create: `server/scrapers/instagram/parseCaption.js`
- Test: `server/scrapers/instagram/parseCaption.test.js`

**Interfaces:**
- Consumes: `parseIndoDate` from `server/scrapers/scraperUtils.js`.
- Produces: `parseCaption(caption: string) -> {name, date, dateRaw, categories, category} | null` (used by Task 12's Playwright driver).

- [ ] **Step 1: Write the failing tests**

```js
// server/scrapers/instagram/parseCaption.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const { parseCaption } = require("./parseCaption");

test("parses a caption with date, price, and cutoff", () => {
  const caption = [
    "Semarang Heritage Run 2026",
    "20 Desember 2026 | 5K & 10K",
    "Early bird Rp150.000",
    "Cut off time: 90 menit untuk kategori 5K",
  ].join("\n");
  const ev = parseCaption(caption);
  assert.equal(ev.name, "Semarang Heritage Run 2026");
  assert.equal(ev.date, "2026-12-20");
  assert.equal(ev.categories[0].price, 150000);
  assert.equal(ev.categories[0].cutoffMinutes, 90);
});

test("returns null when no date can be found", () => {
  assert.equal(parseCaption("Amazing run, register now!"), null);
});

test("returns null for empty input", () => {
  assert.equal(parseCaption(""), null);
  assert.equal(parseCaption(null), null);
});

test("converts an hour-based cutoff to minutes", () => {
  const ev = parseCaption("Jakarta Marathon\n1 Maret 2027\nCut off 6 jam");
  assert.equal(ev.categories[0].cutoffMinutes, 360);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test server/scrapers/instagram/parseCaption.test.js`
Expected: FAIL — module doesn't exist yet

- [ ] **Step 3: Implement `parseCaption.js`**

```js
// server/scrapers/instagram/parseCaption.js
const { parseIndoDate } = require("../scraperUtils");

const PRICE_RE = /rp\.?\s?([\d.,]+)/i;
const CUTOFF_RE = /cut[\s-]?off[^\d]{0,20}(\d+)\s*(menit|minutes?|jam|hours?)/i;

function parsePrice(text) {
  const m = text.match(PRICE_RE);
  if (!m) return null;
  const n = Number(m[1].replace(/[.,]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function parseCutoffMinutes(text) {
  const m = text.match(CUTOFF_RE);
  if (!m) return null;
  const value = Number(m[1]);
  if (!Number.isFinite(value)) return null;
  const unit = m[2].toLowerCase();
  return unit.startsWith("jam") || unit.startsWith("hour") ? value * 60 : value;
}

// Best-effort extraction from an Instagram post caption. Captions are free text
// written by organizers, not structured data - this pulls out what it reliably
// can (date, one price mention, one cutoff-time mention) and leaves the rest
// null; callers attach venue/geo separately since captions rarely name a precise
// address.
function parseCaption(caption) {
  if (!caption) return null;
  const date = parseIndoDate(caption);
  if (!date) return null;

  const firstLine = caption.split("\n")[0].trim();
  return {
    name: firstLine || "Instagram running event",
    date,
    dateRaw: caption.slice(0, 120),
    categories: [{ distance: "General", price: parsePrice(caption), cutoffMinutes: parseCutoffMinutes(caption) }],
    category: "Road Run",
  };
}

module.exports = { parseCaption, parsePrice, parseCutoffMinutes };
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test server/scrapers/instagram/parseCaption.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add server/scrapers/instagram/parseCaption.js server/scrapers/instagram/parseCaption.test.js
git commit -m "feat: add Instagram caption parser"
```

---

### Task 12: Instagram Playwright driver

**Files:**
- Create: `server/scrapers/instagram/index.js`
- Create: `server/data/instagramSources.json`

**Interfaces:**
- Consumes: `parseCaption` from `./parseCaption.js`, `geocode` from `server/geocode.js`, `isTodayOrFuture` from `server/dateUtils.js`, the `playwright` package (added in Task 14).
- Produces: `scrape() -> Promise<Event[]>`, `source: "instagram"`. Registered in Task 13 with `retries: 0`.

This module drives a real headless browser against real Instagram pages — it is **not** unit-testable the way the pure parser in Task 11 is (Playwright's own test runner would be a much heavier dependency than this project needs for one module). It's verified manually in Step 3.

- [ ] **Step 1: Create the curated source list**

```json
// server/data/instagramSources.json
{
  "accounts": ["jadwallari", "runsociety.id"],
  "hashtags": ["larijakarta", "funrunindonesia", "maratonindonesia"]
}
```

This is a starting seed list, not exhaustive — edit it as you identify more race-organizer accounts and hashtags worth tracking. It's data, read fresh on every scrape run, so no code changes are needed to expand it.

- [ ] **Step 2: Implement `index.js`**

```js
// server/scrapers/instagram/index.js
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const { parseCaption } = require("./parseCaption");
const { geocode } = require("../../geocode");
const { isTodayOrFuture } = require("../../dateUtils");

const SOURCES_FILE = path.join(__dirname, "..", "..", "data", "instagramSources.json");
const REQUEST_DELAY_MS = 3000;
const MAX_POSTS_PER_TARGET = 12;

function loadSources() {
  try {
    return JSON.parse(fs.readFileSync(SOURCES_FILE, "utf8"));
  } catch {
    return { accounts: [], hashtags: [] };
  }
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Scrapes public post captions from a curated list of race-organizer accounts and
// hashtags (server/data/instagramSources.json) via a headless browser - Instagram
// blocks plain HTTP scraping. This is accepted-risk: it violates Instagram's ToS
// and may get blocked/rate-limited or break when their markup changes. Deliberately
// scoped to specific accounts/hashtags rather than general search (the least
// detectable pattern), and never retried on failure - server/scrapers/index.js sets
// retries: 0 for this source so a block isn't compounded by hammering it further.
async function scrape() {
  const { accounts = [], hashtags = [] } = loadSources();
  const targets = [
    ...accounts.map((a) => ({ type: "account", value: a, url: `https://www.instagram.com/${a}/` })),
    ...hashtags.map((h) => ({ type: "hashtag", value: h, url: `https://www.instagram.com/explore/tags/${h}/` })),
  ];
  if (!targets.length) return [];

  const browser = await chromium.launch({ headless: true });
  const events = [];
  try {
    const page = await browser.newPage({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
    });
    for (const target of targets) {
      try {
        await page.goto(target.url, { waitUntil: "domcontentloaded", timeout: 30000 });
        await page.waitForTimeout(2000);
        const captions = await page.$$eval(
          "article img[alt]",
          (imgs, max) => imgs.slice(0, max).map((img) => img.getAttribute("alt") || ""),
          MAX_POSTS_PER_TARGET
        );
        for (const caption of captions) {
          const parsed = parseCaption(caption);
          if (!parsed || !isTodayOrFuture(parsed.date)) continue;
          const place = await geocode(`${parsed.name} Indonesia`);
          events.push({
            ...parsed,
            venue: place ? place.label : "",
            location: place ? place.label : "",
            lat: place ? place.lat : null,
            lon: place ? place.lon : null,
            routeImage: null,
            routeGeo: null,
            sourceUrl: target.url,
            source: "instagram",
            confidence: place ? "medium" : "low",
          });
        }
      } catch (err) {
        console.warn(`[instagram] failed ${target.type} ${target.value}: ${err.message}`);
      }
      await delay(REQUEST_DELAY_MS);
    }
  } finally {
    await browser.close();
  }
  return events;
}

module.exports = { scrape };
```

- [ ] **Step 3: Manually verify against live Instagram (after Task 14 installs Playwright)**

Run: `node -e "require('./server/scrapers/instagram').scrape().then(evs => console.log(evs.length, evs))"`
Expected: either some events with a `date` and `categories`, or `0` with `[instagram] failed ...` warnings logged per target (a block/rate-limit) but no thrown/unhandled exception. Both outcomes are acceptable given the accepted risk — a hard crash is not; if it throws, fix the error handling around that failure point before moving on.

- [ ] **Step 4: Commit**

```bash
git add server/scrapers/instagram/index.js server/data/instagramSources.json
git commit -m "feat: add Instagram scraper (Playwright, accepted-risk source)"
```

---

### Task 13: Source registry + run.js rewrite

**Files:**
- Create: `server/scrapers/index.js`
- Modify: `server/scrapers/run.js` (full rewrite)
- Create: `public/data/.gitkeep` (placeholder so the directory exists before the first scrape run)

**Interfaces:**
- Consumes: `scrape()` from `./jadwallari.js`, `./raceRegistry/index.js`, `./newsRoundup.js`, `./instagram/index.js`; `dedupeKey`, `downloadRouteImage` from `./scraperUtils.js`; `isTodayOrFuture` from `../dateUtils.js`.
- Produces: `run() -> Promise<{total: number, manual: number}>` (same shape as before), writes `public/data/events.json` and downloaded images into `public/data/routes/`.

- [ ] **Step 1: Implement `server/scrapers/index.js`**

```js
// server/scrapers/index.js
const jadwallari = require("./jadwallari");
const raceRegistry = require("./raceRegistry");
const newsRoundup = require("./newsRoundup");
const instagram = require("./instagram");

// retries: how many extra attempts run.js makes if scrape() throws.
// instagram gets 0 - retrying a source that's already blocking you increases
// ban/lockout risk rather than reducing it.
const SOURCES = [
  { name: "jadwallari.id", module: jadwallari, enabled: true, retries: 1 },
  { name: "raceRegistry", module: raceRegistry, enabled: true, retries: 1 },
  { name: "newsRoundup", module: newsRoundup, enabled: true, retries: 1 },
  { name: "instagram", module: instagram, enabled: true, retries: 0 },
];

module.exports = { SOURCES };
```

- [ ] **Step 2: Rewrite `run.js`**

```js
// server/scrapers/run.js
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const { SOURCES } = require("./index");
const { dedupeKey, downloadRouteImage } = require("./scraperUtils");
const { isTodayOrFuture } = require("../dateUtils");

const EVENTS_FILE = path.join(__dirname, "..", "..", "public", "data", "events.json");
const ROUTES_DIR = path.join(__dirname, "..", "..", "public", "data", "routes");

function loadExisting() {
  try {
    return JSON.parse(fs.readFileSync(EVENTS_FILE, "utf8"));
  } catch {
    return [];
  }
}

async function scrapeWithRetries(source) {
  const maxAttempts = source.retries + 1;
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await source.module.scrape();
    } catch (err) {
      lastErr = err;
      if (attempt < maxAttempts) {
        console.warn(`[scrape] ${source.name} attempt ${attempt} failed: ${err.message}, retrying`);
      }
    }
  }
  throw lastErr;
}

async function run() {
  const existing = loadExisting();
  const manual = existing.filter((e) => e.source === "manual");

  const active = SOURCES.filter((s) => s.enabled);
  const results = await Promise.allSettled(active.map(scrapeWithRetries));

  const scraped = [];
  results.forEach((r, i) => {
    const label = active[i].name;
    if (r.status === "fulfilled") {
      const upcoming = r.value.filter((ev) => isTodayOrFuture(ev.date));
      console.log(`[scrape] ${label}: ${upcoming.length} upcoming events (${r.value.length - upcoming.length} past dropped)`);
      scraped.push(...upcoming);
    } else {
      console.warn(`[scrape] ${label} failed after retries: ${r.reason.message}`);
    }
  });

  const seen = new Map();
  for (const ev of [...manual, ...scraped]) {
    const key = dedupeKey(ev);
    if (!ev.id) ev.id = crypto.randomUUID();
    if (!seen.has(key)) seen.set(key, ev);
  }

  const merged = Array.from(seen.values());
  for (const ev of merged) {
    if (ev.routeImage && /^https?:\/\//.test(ev.routeImage)) {
      const filename = await downloadRouteImage(ev.routeImage, ROUTES_DIR, ev.id);
      ev.routeImage = filename ? `data/routes/${filename}` : null;
    }
  }
  merged.sort((a, b) => a.date.localeCompare(b.date));

  fs.mkdirSync(path.dirname(EVENTS_FILE), { recursive: true });
  fs.writeFileSync(EVENTS_FILE, JSON.stringify(merged, null, 2));
  console.log(`[scrape] wrote ${merged.length} total events (${manual.length} manual preserved) to ${EVENTS_FILE}`);
  return { total: merged.length, manual: manual.length };
}

module.exports = { run };

if (require.main === module) {
  run().catch((err) => {
    console.error("[scrape] fatal error:", err);
    process.exit(1);
  });
}
```

- [ ] **Step 3: Create the `public/data/` placeholder**

```bash
mkdir -p public/data
echo "[]" > public/data/events.json
touch public/data/.gitkeep
```

- [ ] **Step 4: Run the full pipeline once and verify output**

Run: `npm run scrape`
Expected: exits 0, logs a per-source line for each of the 4 sources (fulfilled or failed-after-retries), and `public/data/events.json` contains a JSON array. This is the first point all scrapers run together — expect some to log warnings/failures depending on current site markup and Instagram's response that day; a non-zero `total` and no uncaught exception is the bar for this step.

- [ ] **Step 5: Commit**

```bash
git add server/scrapers/index.js server/scrapers/run.js public/data/.gitkeep public/data/events.json
git commit -m "feat: add source registry with retry config, write events.json to public/data"
```

---

### Task 14: package.json updates and dependency install

**Files:**
- Modify: `package.json`

**Interfaces:**
- Produces: `npm test` runs all `*.test.js` files under `server/` via `node --test`; `playwright` becomes available to `server/scrapers/instagram/index.js` (Task 12).

- [ ] **Step 1: Update `package.json`**

```json
{
  "name": "gbk-event-dashboard",
  "version": "2.0.0",
  "description": "Nationwide Indonesia running-event tracker, scraped on a schedule and published as a static site.",
  "main": "server/scrapers/run.js",
  "type": "commonjs",
  "engines": {
    "node": ">=18.0.0"
  },
  "scripts": {
    "scrape": "node server/scrapers/run.js",
    "test": "node --test server"
  },
  "dependencies": {
    "cheerio": "^1.0.0",
    "playwright": "^1.47.0"
  }
}
```

- [ ] **Step 2: Install dependencies**

Run: `npm install`
Expected: `express` is removed from `node_modules`/`package-lock.json`, `playwright` is added.

- [ ] **Step 3: Install the Playwright browser binary**

Run: `npx playwright install --with-deps chromium`
Expected: downloads a Chromium build Playwright can launch headless (required for Task 12's Instagram scraper to actually run locally).

- [ ] **Step 4: Run the full test suite**

Run: `npm test`
Expected: PASS — every `*.test.js` file created in Tasks 2–12 (scraperUtils, geocode, jadwallari, jsonLdEvent, platformScraper, raceId, loket, runSociety, raceRegistry/index, newsRoundup, parseCaption).

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: swap express for playwright, add node:test script"
```

---

### Task 15: GitHub Actions scheduled scrape + GitHub Pages hosting

**Files:**
- Create: `.github/workflows/scrape.yml`

**Interfaces:**
- Produces: a scheduled CI job that runs `npm run scrape` and commits `public/data/**` + `server/data/geocodeCache.json` back to the repo.

- [ ] **Step 1: Create the workflow**

```yaml
# .github/workflows/scrape.yml
name: Scrape running events

on:
  schedule:
    - cron: "0 */4 * * *"
  workflow_dispatch: {}

permissions:
  contents: write

jobs:
  scrape:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: "20"

      - run: npm ci

      - run: npx playwright install --with-deps chromium

      - run: npm run scrape

      - name: Commit updated data
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add public/data server/data/geocodeCache.json
          git diff --cached --quiet || git commit -m "chore: scheduled data refresh"
          git push
```

- [ ] **Step 2: Validate the workflow YAML**

Run: `node -e "require('fs').readFileSync('.github/workflows/scrape.yml','utf8')"` to confirm the file is readable, then visually check indentation against the block above (GitHub Actions YAML has no local linter in this project — a syntax error surfaces as the workflow failing to parse on GitHub, which the next step also confirms).

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/scrape.yml
git commit -m "ci: add scheduled scrape workflow"
```

- [ ] **Step 4: One-time manual repo setting (not a code change) — enable GitHub Pages**

After pushing, in the repository's GitHub Settings → Pages, set the source to "Deploy from a branch", branch `master` (or `main`), folder `/public`. Confirm the published URL loads `index.html`. This step has no local verification — it's a one-time setting on the hosted repo.

- [ ] **Step 5: Trigger the workflow manually and confirm it commits data**

In the GitHub Actions tab, run the `Scrape running events` workflow via `workflow_dispatch`. Expected: a new commit appears (authored by `github-actions[bot]`) updating `public/data/events.json`, and the GitHub Pages site reflects it after the next Pages build.

---

### Task 16: Frontend — remove GBK-specific UI, nationwide default view

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.js`

**Interfaces:**
- Consumes: `public/data/events.json` (fetched directly, replacing `/api/events`).
- Produces: a page with no conflict-check panel, no manual-add form, no refresh button; map defaults to a nationwide view.

- [ ] **Step 1: Edit `index.html`**

Remove these blocks entirely:
- The `<button id="rescrapeBtn" ...>` in `.topbar`.
- The `<section class="panel">` containing `#checkDate`/`#statusBadge`/`#statusEvents` ("Check a date").
- The `<section class="panel">` containing `#addForm` ("Add event manually").
- The legend `<li>` rows for "Car Free Day" and "Manual entry" (keep Running event / News roundup / Other, matching the categories real sources now produce — see Task 16 Step 2's `CATEGORY_COLORS`).
- The `<p class="muted">` line about the "1.2km check radius" / CFD corridor.

Update the subtitle text:
```html
<p class="subtitle">Tracking running events across Indonesia</p>
```

Add a container for the event detail panel (Task 17 populates it), placed after `<aside class="sidebar">`'s legend panel:
```html
<section class="panel" id="detailPanel" hidden>
  <h2 id="detailName"></h2>
  <div id="detailMeta"></div>
  <table id="detailCategories"></table>
  <img id="detailRouteImage" alt="Route map" hidden />
  <a id="detailSourceLink" target="_blank" rel="noopener">Source</a>
</section>
```

- [ ] **Step 2: Edit `app.js` — remove GBK-specific logic and switch data source**

1. Delete the `IDX`, `CHECK_RADIUS_KM`, `CORRIDOR_POINTS` constants and `haversineKm()`.
2. Delete the IDX marker (`L.marker([IDX.lat, IDX.lon], ...)`), the check-radius `L.circle(...)`, and the corridor `L.polyline(CORRIDOR_POINTS, ...)` block.
3. Delete `checkDate()` and its `document.getElementById("checkDate").addEventListener(...)` call, and the `checkDate(dateInput.value)` call inside `loadEvents()`.
4. Delete the "Manual scrape trigger" block (`rescrapeBtn` and its listener).
5. Delete the "Add event form" block (`pickingLocation`, `pickOnMap` listener, `map.on("click", ...)`, `addForm` submit listener).
6. Update `CATEGORY_COLORS` and `SOURCE_LABELS`:
   ```js
   const CATEGORY_COLORS = {
     "road run": "#eb6834",
     "fun run": "#eb6834",
     "trail run": "#eb6834",
     "virtual run": "#eb6834",
     "charity run": "#eb6834",
     "news roundup": "#1baf7a",
   };
   const DEFAULT_COLOR = "#4a3aa7";

   const SOURCE_LABELS = {
     "jadwallari.id": "jadwallari.id",
     "raceRegistry:race.id": "race.id",
     "raceRegistry:loket": "Loket",
     "raceRegistry:runSociety": "RunSociety",
     news: "News roundup",
     instagram: "Instagram",
   };
   ```
7. Change the map init from the GBK-centered view to nationwide:
   ```js
   const map = L.map("map").setView([-2.5, 118], 5);
   ```
8. Change `loadEvents()`'s fetch call and drop the now-deleted `checkDate` call:
   ```js
   async function loadEvents() {
     const res = await fetch("./data/events.json");
     allEvents = await res.json();
     buildSourceFilters(allEvents);
     applyFilters();
   }
   ```
9. In `renderEventList()`, delete the `${ev.source === "cfd-baseline" ? ... : ""}` badge line and the `${ev.source === "manual" ? ... : ""}` delete button + its listener block (no manual entries or delete endpoint exist anymore).
10. In the marker click handler / list card click handler, call a new `showEventDetail(ev)` (implemented in Task 17) in addition to `openEventOnMap(ev)`.

- [ ] **Step 3: Serve the site locally and smoke-test**

Run: `npx serve public` (or any static file server) and open the printed URL in a browser.
Expected: page loads, map defaults to a nationwide view, no console errors about missing `#checkDate`/`#addForm` elements, marker list populates from `public/data/events.json`.

- [ ] **Step 4: Commit**

```bash
git add public/index.html public/app.js
git commit -m "feat: remove GBK conflict-check UI, default map to nationwide view"
```

---

### Task 17: Frontend — event detail panel (categories, route image, route line)

**Files:**
- Modify: `public/app.js`

**Interfaces:**
- Consumes: the `#detailPanel`/`#detailName`/`#detailMeta`/`#detailCategories`/`#detailRouteImage`/`#detailSourceLink` elements added in Task 16.
- Produces: `showEventDetail(ev: Event) -> void`, called from marker/list-card click handlers (wired in Task 16 Step 2.10).

- [ ] **Step 1: Add route-line state and `showEventDetail`**

Add near the top of `app.js`, alongside `markersById`:
```js
let activeRouteLine = null;
```

Add this function (place it near `openEventOnMap`, since both are triggered together from the same click handlers):
```js
function formatPrice(price) {
  return price == null ? "—" : `Rp${price.toLocaleString("id-ID")}`;
}

function formatCutoff(minutes) {
  if (minutes == null) return "—";
  return minutes >= 60 ? `${(minutes / 60).toFixed(1)}h` : `${minutes}min`;
}

function showEventDetail(ev) {
  document.getElementById("detailPanel").hidden = false;
  document.getElementById("detailName").textContent = ev.name;
  document.getElementById("detailMeta").textContent =
    `${ev.date} · ${ev.venue || ev.location || "unknown location"}`;

  const table = document.getElementById("detailCategories");
  table.innerHTML = "";
  const categories = ev.categories || [];
  if (categories.length) {
    const header = document.createElement("tr");
    header.innerHTML = "<th>Distance</th><th>Price</th><th>Cutoff</th>";
    table.appendChild(header);
    categories.forEach((c) => {
      const row = document.createElement("tr");
      row.innerHTML = `<td>${escapeHtml(c.distance)}</td><td>${formatPrice(c.price)}</td><td>${formatCutoff(c.cutoffMinutes)}</td>`;
      table.appendChild(row);
    });
  }

  const img = document.getElementById("detailRouteImage");
  if (ev.routeImage) {
    img.src = ev.routeImage;
    img.hidden = false;
  } else {
    img.hidden = true;
    img.removeAttribute("src");
  }

  const link = document.getElementById("detailSourceLink");
  if (ev.sourceUrl) {
    link.href = ev.sourceUrl;
    link.hidden = false;
  } else {
    link.hidden = true;
  }

  if (activeRouteLine) {
    map.removeLayer(activeRouteLine);
    activeRouteLine = null;
  }
  if (Array.isArray(ev.routeGeo) && ev.routeGeo.length > 1) {
    activeRouteLine = L.polyline(ev.routeGeo, { color: "#eb6834", weight: 4, opacity: 0.9 }).addTo(map);
  }
}
```

- [ ] **Step 2: Wire it into the marker and list-card click handlers**

In `renderMarkers()`, inside the `m.bindPopup(...)` setup, add a click listener on the marker:
```js
m.on("click", () => showEventDetail(ev));
```

In `renderEventList()`'s card click listener (added in Task 16 Step 2.10), call `showEventDetail(ev);` alongside the existing `openEventOnMap(ev);`.

- [ ] **Step 3: Serve locally and verify with a fixture event**

Temporarily add one event with populated `categories`, `routeImage` (any local image path under `public/`), and `routeGeo` (e.g. `[[-6.2,106.8],[-6.21,106.81],[-6.22,106.79]]`) to `public/data/events.json`, then run `npx serve public` and click that event's marker.
Expected: the detail panel shows the categories table with formatted price/cutoff, the route image renders, and an orange line is drawn on the map; clicking a different event without `routeGeo` removes the line. Revert the temporary test event from `events.json` afterward (it's scraper-owned data, not meant to be hand-committed here).

- [ ] **Step 4: Commit**

```bash
git add public/app.js
git commit -m "feat: add event detail panel with categories, route image, and route line"
```

---

### Task 18: style.css updates for the detail panel

**Files:**
- Modify: `public/style.css`

**Interfaces:**
- Consumes: none (pure CSS).
- Produces: styling for `#detailPanel`, `#detailCategories`, `#detailRouteImage`.

- [ ] **Step 1: Read the existing `.panel` styling**

Run: `grep -n "\.panel" public/style.css` to find the existing panel border/padding/spacing conventions used by the "Legend" and other sidebar panels, so the new detail panel matches.

- [ ] **Step 2: Add detail panel styles**

Append to `public/style.css`, matching whatever padding/border/font-size values Step 1 found on `.panel` (use the same values, don't invent new ones):

```css
#detailCategories {
  width: 100%;
  border-collapse: collapse;
  margin-top: 8px;
  font-size: 13px;
}

#detailCategories th,
#detailCategories td {
  text-align: left;
  padding: 4px 6px;
  border-bottom: 1px solid #e5e5e5;
}

#detailRouteImage {
  width: 100%;
  border-radius: 6px;
  margin-top: 8px;
}

#detailSourceLink {
  display: inline-block;
  margin-top: 8px;
  font-size: 13px;
}
```

- [ ] **Step 3: Visual check**

With `npx serve public` still running from Task 17, reload and confirm the detail panel's table and image are legible and don't overflow the sidebar width (check `overflow-x` isn't triggered — table `width: 100%` inside the existing `.panel` container should contain it).

- [ ] **Step 4: Commit**

```bash
git add public/style.css
git commit -m "style: add event detail panel styling"
```

---

### Task 19: End-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: PASS, all suites from Tasks 2–12.

- [ ] **Step 2: Run a full scrape and confirm the data shape**

Run: `npm run scrape`
Expected: `public/data/events.json` is a JSON array where every element has at least `id`, `name`, `date`, `source`; elements from `raceRegistry:*`/`jadwallari.id` sources have a non-empty `categories` array.

- [ ] **Step 3: Serve the static site and walk the golden path**

Run: `npx serve public`, open in a browser:
- Map loads nationwide (not GBK-centered).
- Search box filters the list and markers together.
- Source-filter checkboxes toggle visibility per source.
- Clicking a marker or list card opens the detail panel with its categories table.
- No `#checkDate`, `#addForm`, or `#rescrapeBtn` elements exist anywhere in the DOM (confirms Task 16's removals are complete).

- [ ] **Step 4: Confirm no references to removed modules remain**

Run: `grep -rn "cfdSchedule\|gbkNews\|venues.json\|/api/events\|/api/scrape\|checkDate\|CHECK_RADIUS_KM" server public --include=*.js --include=*.html`
Expected: no matches.

---

## Self-Review Notes

- **Spec coverage:** nationwide scope (Tasks 4, 6-9, 16), all four source categories including Instagram accepted-risk (Tasks 4, 6-9, 10, 11-12), per-category price/cutoff data model (Tasks 5, 17), route image stored / route line only from real geodata (Tasks 5, 12, 17), Nominatim nationwide geocoding with caching (Task 3), static architecture with GitHub Actions + GitHub Pages (Tasks 13, 15), manual-add UI removed (Task 16), refresh button removed (Task 16), GBK/IDX conflict-check feature removed (Task 16) — all covered.
- **Type consistency checked:** `Event.categories[]` shape (`{distance, price, cutoffMinutes}`) is identical across `scraperUtils.parseCategoriesFromText`, `platformScraper.schemaEventToOurEvent`, `newsRoundup` (empty array), and `instagram/parseCaption` — verified matching field names throughout. `geocode()` is awaited at every call site introduced or touched (jadwallari, platformScraper, newsRoundup, instagram). `SOURCES` config shape (`{name, module, enabled, retries}`) is defined once in Task 13 and consumed only by `run.js`'s `scrapeWithRetries`.
- **No placeholders:** every step includes literal code, not a description of code.
