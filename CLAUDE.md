# GBK Event Dashboard

Nationwide Indonesia running-event tracker (pivoted from an earlier
GBK/Sudirman-only conflict-checking dashboard — see design doc below for
the full rationale and target architecture).

## Architecture

No runtime server. A GitHub Actions cron job runs the scrapers and commits
the published data; a second workflow uploads `public/` to a host over
FTPS. The frontend is a static site that reads `data/events.json` directly.

```
GitHub Actions (cron, scrape.yml)
  -> node server/scrapers/run.js
       - jadwallari.js, instagram/index.js, raceRegistry/index.js, newsRoundup.js
       - geocode.js (Nominatim/OSM, rate-limited + cached)
  -> writes public/data/events.json, public/data/routes/<id>.jpg
  -> commits back to the repo

GitHub Actions (deploy-ftp.yml)
  -> uploads public/ to the FTP host over FTPS (SamKirkland/FTP-Deploy-Action)
  -> triggered on push to public/**, on its own schedule, or manually

FTP host
  -> serves public/'s contents, app.js fetches ./data/events.json (no API)
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

Implemented and merged (2026-09-01, PR #1). See the spec for what's in
scope vs. explicitly out of scope (no manual-add UI, no on-demand refresh,
no image-to-route-line extraction, GBK/IDX conflict-checking feature
removed). Deploy target switched from GitHub Pages to FTP after merge.

Known follow-up not yet done: `server/data/newsSources.json` still holds
pre-pivot GBK-only URLs (newsRoundup returns 0 until repopulated);
`jadwallari.test.js` doesn't actually exercise `jadwallari.js`; no test
exists for `run.js`'s orchestration logic.
