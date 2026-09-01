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
