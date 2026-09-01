# GBK Event Dashboard

Nationwide Indonesia running-event tracker (in progress pivot from an
earlier GBK/Sudirman-only conflict-checking dashboard — see design doc
below for the full rationale and target architecture).

## Target architecture (post-pivot)

No runtime server. A GitHub Actions cron job runs the scrapers and commits
the published data; the frontend is a static site (GitHub Pages) that reads
that data directly.

```
GitHub Actions (cron)
  -> node server/scrapers/run.js
       - jadwallari.js, instagram.js, raceRegistry.js, newsRoundup.js
       - geocode.js (Nominatim/OSM, rate-limited + cached)
  -> writes public/data/events.json, public/data/routes/<id>.jpg
  -> commits back to the repo

GitHub Pages
  -> serves /public, app.js fetches ./data/events.json (no API)
```

Full design: `docs/superpowers/specs/2026-09-01-nationwide-running-events-design.md`

## Conventions

- Scrapers live in `server/scrapers/`, one module per source, each exporting
  `async scrape() -> Event[]`. `run.js` orchestrates them via
  `Promise.allSettled` so one source failing doesn't stop the others —
  keep new scrapers isolated the same way.
- `dateUtils.js`'s `isTodayOrFuture` is Jakarta-timezone-based on purpose
  (the audience's timezone), independent of event location.
- Event fields beyond `id`/`name`/`date`/`source` may be `null` — don't
  assume completeness; different sources populate different subsets.
- `routeGeo` (an actual drawable route line) is only ever set from real
  geodata (GPX/Strava/KML) — never inferred from a route image. `routeImage`
  is stored and shown as-is instead.
- Instagram scraping is accepted-risk (ToS violation, ban/breakage risk) —
  it's scoped to a curated account/hashtag list, not general search, and
  runs with `retries: 0` to avoid compounding block risk.

## Status

Design approved 2026-09-01; implementation not yet started. See the spec
for what's in scope vs. explicitly out of scope (no manual-add UI, no
on-demand refresh, no image-to-route-line extraction, GBK/IDX
conflict-checking feature removed).
