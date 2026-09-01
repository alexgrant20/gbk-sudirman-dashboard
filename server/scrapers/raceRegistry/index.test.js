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
