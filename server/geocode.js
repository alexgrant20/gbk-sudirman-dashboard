const fs = require("fs");
const path = require("path");

const venues = JSON.parse(
  fs.readFileSync(path.join(__dirname, "data", "venues.json"), "utf8")
);

// Matches free-text location strings against the known venue keyword table.
// Venues are ranked in three tiers, checked in order - a match in an earlier tier
// always wins regardless of keyword string length, so e.g. "FX Sudirman" (specific)
// beats "Jakarta Pusat" (city) even though "jakarta pusat" is the longer string, and
// "GBK" (area) beats "Jakarta Pusat" (city) for the same reason. Within a tier, the
// longest keyword match wins (the more specific phrase).
const TIER_ORDER = [undefined, "area", "city"]; // undefined = specific venue (no tier set)

function bestMatch(text, tier) {
  let best = null;
  let bestLen = 0;
  for (const [id, venue] of Object.entries(venues)) {
    if (venue.tier !== tier) continue;
    for (const kw of venue.keywords) {
      if (text.includes(kw) && kw.length > bestLen) {
        best = { id, ...venue };
        bestLen = kw.length;
      }
    }
  }
  return best;
}

function geocode(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const tier of TIER_ORDER) {
    const match = bestMatch(lower, tier);
    if (match) return match;
  }
  return null;
}

module.exports = { geocode, venues };
