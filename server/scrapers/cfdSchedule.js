const { venues } = require("../geocode");
const { todayISO } = require("../dateUtils");

const WEEKS_AHEAD = 16;

// carfreedayindonesia.org has no per-date data - just the routine rule
// "every Sunday, Jl. Sudirman - Jl. MH Thamrin, 05:30-10:00 WIB". This seeds that
// recurring baseline as generated events so the date-check panel always has a
// reference point on the corridor, even with no live per-date cancellation data.
function scrape() {
  // Anchor the recurring corridor event at Bundaran Senayan - the southern end of the
  // CFD Sudirman-Thamrin route and the closest corridor point to IDX/SCBD - so
  // proximity checks against IDX are meaningful rather than using a coarse midpoint.
  const corridor = venues["bundaran-senayan"];
  const corridorLabel = venues["sudirman-thamrin"].label;
  const events = [];
  const today = new Date(`${todayISO()}T00:00:00Z`);

  for (let i = 0; i < WEEKS_AHEAD * 7; i++) {
    const d = new Date(today);
    d.setUTCDate(today.getUTCDate() + i);
    if (d.getUTCDay() !== 0) continue; // Sunday only

    const iso = d.toISOString().slice(0, 10);
    events.push({
      name: "Car Free Day Sudirman-Thamrin",
      date: iso,
      dateRaw: "setiap hari Minggu, 05.30-10.00 WIB",
      distances: "",
      category: "Car Free Day",
      location: "Jl. Sudirman - Jl. MH Thamrin (nearest point to IDX: Bundaran Senayan)",
      venue: corridorLabel,
      lat: corridor.lat,
      lon: corridor.lon,
      sourceUrl: "https://carfreedayindonesia.org/index.php/informasi/jadwal/itemlist/category/2-jadwal",
      source: "cfd-baseline",
      confidence: "high",
      recurring: true,
    });
  }
  return events;
}

module.exports = { scrape };
