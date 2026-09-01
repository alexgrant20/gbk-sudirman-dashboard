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
