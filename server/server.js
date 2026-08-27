const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const { run: runScrape } = require("./scrapers/run");

const EVENTS_FILE = path.join(__dirname, "data", "events.json");
const VENUES_FILE = path.join(__dirname, "data", "venues.json");
const PUBLIC_DIR = path.join(__dirname, "..", "public");
const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.json());
app.use(express.static(PUBLIC_DIR));

function readEvents() {
  try {
    return JSON.parse(fs.readFileSync(EVENTS_FILE, "utf8"));
  } catch {
    return [];
  }
}

function writeEvents(events) {
  fs.writeFileSync(EVENTS_FILE, JSON.stringify(events, null, 2));
}

app.get("/api/events", (req, res) => {
  res.json(readEvents());
});

app.get("/api/venues", (req, res) => {
  res.json(JSON.parse(fs.readFileSync(VENUES_FILE, "utf8")));
});

app.post("/api/events", (req, res) => {
  const { name, date, venue, lat, lon, category, notes, sourceUrl } = req.body;
  if (!name || !date || lat == null || lon == null) {
    return res.status(400).json({ error: "name, date, lat, and lon are required" });
  }
  const events = readEvents();
  const newEvent = {
    id: crypto.randomUUID(),
    name,
    date,
    dateRaw: date,
    venue: venue || "",
    location: venue || "",
    lat: Number(lat),
    lon: Number(lon),
    category: category || "Manual entry",
    notes: notes || "",
    sourceUrl: sourceUrl || "",
    source: "manual",
    confidence: "high",
  };
  events.push(newEvent);
  writeEvents(events);
  res.status(201).json(newEvent);
});

app.put("/api/events/:id", (req, res) => {
  const events = readEvents();
  const idx = events.findIndex((e) => e.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "not found" });

  const updated = { ...events[idx], ...req.body, id: events[idx].id, source: events[idx].source };
  events[idx] = updated;
  writeEvents(events);
  res.json(updated);
});

app.delete("/api/events/:id", (req, res) => {
  const events = readEvents();
  const next = events.filter((e) => e.id !== req.params.id);
  if (next.length === events.length) return res.status(404).json({ error: "not found" });
  writeEvents(next);
  res.status(204).end();
});

let scraping = false;
app.post("/api/scrape", async (req, res) => {
  if (scraping) return res.status(409).json({ error: "a scrape is already in progress" });
  scraping = true;
  try {
    const result = await runScrape();
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    scraping = false;
  }
});

app.listen(PORT, () => {
  console.log(`GBK Event Dashboard running at http://localhost:${PORT}`);
});
