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
