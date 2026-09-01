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
