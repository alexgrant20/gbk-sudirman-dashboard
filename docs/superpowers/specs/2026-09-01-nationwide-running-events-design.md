# Nationwide Running Events Dashboard — Design

Date: 2026-09-01

## Summary

Pivot the GBK/Sudirman conflict-checking dashboard into a nationwide Indonesia
running-event tracker with richer per-event detail (per-distance price/cutoff,
route images, route lines where real geodata exists), fed by more scraper
sources (including Instagram), and re-architected as a static site: a
GitHub Actions cron job runs the scrapers and publishes `events.json`, which
a plain static frontend (hosted on GitHub Pages) reads directly. There is no
runtime server.

The original GBK/IDX Car Free Day conflict-checking feature is dropped
entirely, along with its scrapers, map chrome, and manual add/delete API.

## Goals

- Track running events across all of Indonesia, not just GBK/Sudirman.
- Scrape multiple sources: jadwallari.id (existing, widened), Instagram
  (direct scrape, accepted risk), race registration platforms (race.id,
  Loket, RunSociety), and news/media roundups.
- Per-event detail: precise pinpoint location, per-distance-category price
  and cutoff time, route image when a source posts one, and an actual route
  line on the map only when real geodata (GPX/Strava/KML) is available.
- Data refreshes automatically on a schedule (every few hours) with no
  server to operate — a GitHub Actions cron job publishes updated data,
  GitHub Pages serves the static site.

## Non-goals

- No automated image-to-route-line extraction (tracing a route out of a
  posted image via CV/AI). Route images are shown as-is; only real geodata
  produces a drawn line.
- No manual "add event" UI — with no backend, corrections/additions are made
  by editing the data file directly (e.g. via a local script or a one-off
  commit), landing on the next scheduled publish.
- No on-demand "refresh now" button — refresh only happens on the
  Actions schedule.
- No GBK/IDX conflict-checking (distance-to-IDX badge, CFD corridor,
  1.5km radius) — this feature and its scrapers are removed, not kept as a
  filtered view.

## Architecture

```
GitHub Actions (cron, e.g. every 4h)
  -> node server/scrapers/run.js
       - jadwallari.js    (cheerio, nationwide)
       - instagram.js     (Playwright headless browser)
       - raceRegistry.js  (cheerio; race.id / Loket / RunSociety)
       - newsRoundup.js   (cheerio; nationwide "upcoming races" roundups)
       - geocode.js       (Nominatim/OSM, rate-limited + cached)
  -> writes public/data/events.json
  -> writes public/data/routes/<id>.jpg (downloaded route images)
  -> writes server/data/geocodeCache.json
  -> commits and pushes changes back to the repo

GitHub Pages
  -> serves /public as static files
  -> index.html / app.js fetch ./data/events.json directly (no API)
```

`server.js` and Express are removed. There is no runtime server process;
`server/` becomes a scraper/CLI-only tree invoked by CI, not an app server.

## Data model

```jsonc
{
  "id": "uuid",
  "name": "string",
  "date": "YYYY-MM-DD",
  "dateRaw": "string, source's original date text",
  "venue": "string",
  "location": "string, fuller address/description",
  "lat": -6.2189,
  "lon": 106.802,
  "categories": [
    { "distance": "5K", "price": 250000, "cutoffMinutes": 90 }
  ],
  "routeImage": "data/routes/<id>.jpg | null",
  "routeGeo": "[[lat,lon], ...] | null — only set from real geodata (GPX/Strava/KML), never inferred from an image",
  "category": "string, e.g. Road Run / Fun Run / Trail Run",
  "sourceUrl": "string",
  "source": "jadwallari.id | instagram | raceRegistry:<platform> | newsRoundup",
  "confidence": "high | medium | low"
}
```

Rules:
- `categories` replaces the old free-text `distances` field. A scraper that
  can't determine per-category price/cutoff still emits `categories` entries
  with just `distance` set and `price`/`cutoffMinutes` as `null`.
- `routeImage` is populated whenever a scraper finds a course-map image
  attached to the event listing (regardless of source), downloaded into
  `public/data/routes/` and committed alongside `events.json`.
- `routeGeo` stays `null` unless a source links real geodata (GPX file,
  Strava route, KML). Never derived from `routeImage`.
- Every field beyond `id`/`name`/`date`/`source` may be `null` or absent —
  downstream code (frontend, dedupe) must not assume any of them are present.

`server/data/venues.json` and the keyword-tier matching in `geocode.js` are
removed, replaced by calls to the Nominatim (OpenStreetMap) geocoding API.
Nominatim enforces a 1 req/sec rate limit, so `geocode()` becomes async,
rate-limited to that ceiling, and backed by a `server/data/geocodeCache.json`
cache keyed by the queried text so repeat venue strings across runs don't
re-hit the API.

`dateUtils.js` is unchanged — `isTodayOrFuture` stays Jakarta-timezone-based
regardless of nationwide scope, since that's the relevant audience timezone.

## Scrapers

Shared interface, unchanged from today: `async scrape() -> Event[]`.
Orchestration in `run.js` keeps its existing `Promise.allSettled` fan-out
and manual-events-preserved / dedupe-and-merge logic, now also writing
`routeImage` downloads and driven by a small per-source config instead of a
hardcoded array:

```js
// server/scrapers/index.js
const SOURCES = [
  { name: "jadwallari.id", module: jadwallari,   enabled: true, retries: 1 },
  { name: "raceRegistry",  module: raceRegistry, enabled: true, retries: 1 },
  { name: "newsRoundup",   module: newsRoundup,  enabled: true, retries: 1 },
  { name: "instagram",     module: instagram,    enabled: true, retries: 0, timeoutMs: 60000 },
];
```

Any source can be disabled with one flag flip if it starts failing/blocking
consistently, without touching orchestration code.

- **jadwallari.js**: existing scraper, minus the `AREA_KEYWORDS` GBK-only
  relevance filter. Keeps the existing detail-page fetch for precise venue
  text and its confidence tiering.
- **raceRegistry.js**: one sub-module per platform (race.id, Loket,
  RunSociety) — each has its own listing/detail page structure but follows
  the same candidate -> detail-fetch -> geocode shape as jadwallari.
- **newsRoundup.js**: replaces `gbkNews.js`. Parses "upcoming races this
  month" article roundups, nationwide. Generally `confidence: "low"` since
  freeform article text rarely gives exact venues.
- **instagram.js**: Playwright headless browser against a curated list of
  known race-organizer accounts and hashtags (not general search — the
  most detectable/blockable pattern and the least targeted signal).
  Parses caption text for date/venue/price/cutoff; captures the post image
  as a `routeImage` candidate when the caption indicates a course map.
  `retries: 0` and inter-request delay, since retrying against a source
  that's already blocking you increases ban risk. Expected to need the most
  ongoing maintenance as Instagram's markup/blocking changes.
- **cfdSchedule.js** and **gbkNews.js** are deleted.

## Frontend (`public/`)

- `server.js` deleted; no API. `app.js` fetches `./data/events.json`
  directly instead of `/api/events`.
- GBK/IDX conflict-checking UI removed: IDX marker, 1.5km check circle, CFD
  corridor polyline, "Check a date" panel, `checkDate()`, and the haversine
  distance logic.
- "Add event manually" form and its map-pick-location handler removed (no
  backend to submit to).
- "Refresh data" button removed (no on-demand trigger; data only changes
  when Actions publishes a new `events.json`).
- Map default view changes from GBK-centered to a nationwide view
  (`setView([-2.5, 118], 5)` roughly); existing marker clustering handles
  density at that zoom.
- New event detail panel (replacing the current small popup): shows the
  `categories` table (distance / price / cutoff), `routeImage` if present,
  and the source link.
- Selecting an event with `routeGeo` draws an `L.polyline` for its route;
  deselecting removes it. Events without `routeGeo` show only the pin, as
  today.
- Search, source-filter checkboxes, and low-confidence toggle are unchanged
  in behavior, now operating over the nationwide dataset.

## Error handling

- Per-source scrape failures are isolated via the existing
  `Promise.allSettled` pattern in `run.js` — one source failing (timeout,
  blocked, markup change) doesn't stop the others from publishing.
- Instagram gets `retries: 0` specifically to avoid compounding ban risk by
  retrying a source that's already blocking the run.
- Geocoding failures (Nominatim timeout/rate-limit) leave `lat`/`lon` as
  `null` for that event rather than failing the whole run; such events are
  still published (frontend already skips pins without coordinates) so a
  geocoding hiccup doesn't silently drop an event from the list/search.
- The GitHub Actions workflow should fail loudly (non-zero exit, visible in
  the Actions tab) if `run.js` throws unhandled, but a partial scrape
  (some sources down) is a successful run, not a failure — matches today's
  `run()` return shape (`{ total, manual }`).

## Testing

- Each scraper module is testable in isolation by calling `scrape()`
  directly (as today) against recorded fixture HTML, independent of the
  GitHub Actions schedule.
- `geocode.js`'s cache means repeated test runs against the same fixtures
  don't hit Nominatim's live rate limit.
- Frontend changes are manually verified by serving `public/` locally
  (e.g. `npx serve public`) and checking rendering against a sample
  `events.json` with populated `categories`, `routeImage`, and `routeGeo`
  fields.
