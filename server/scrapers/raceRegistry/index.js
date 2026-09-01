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
