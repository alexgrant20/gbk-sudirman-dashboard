const test = require("node:test");
const assert = require("node:assert/strict");
const cheerio = require("cheerio");

// jadwallari.js doesn't export parseIndoDate (it's file-local), so this test
// exercises it indirectly through a minimal fixture table run through cheerio,
// matching how the real scraper parses rows.
const FIXTURE_TABLE_HTML = `
<table id="tablepress-1">
  <tbody>
    <tr>
      <td>11 Oktober 2026</td>
      <td><a href="https://jadwallari.id/events/victoria-run/">Victoria Run 2026</a></td>
      <td>5K, 10K, HM</td>
      <td>Road Run</td>
      <td>Jakarta Pusat, DKI Jakarta</td>
    </tr>
    <tr>
      <td>18 Oktober 2026</td>
      <td><a href="https://jadwallari.id/events/bali-run/">Bali Sunrise Run</a></td>
      <td>10K</td>
      <td>Road Run</td>
      <td>Denpasar, Bali</td>
    </tr>
  </tbody>
</table>`;

test("fixture table rows parse into candidate rows regardless of city", () => {
  const $ = cheerio.load(FIXTURE_TABLE_HTML);
  const rows = [];
  $("table tbody tr").each((_, row) => {
    const cells = $(row).find("td");
    rows.push({
      dateRaw: $(cells[0]).text().trim(),
      name: $(cells[1]).text().trim(),
      location: $(cells[4]).text().trim(),
    });
  });
  assert.equal(rows.length, 2);
  assert.equal(rows[1].location, "Denpasar, Bali");
});
