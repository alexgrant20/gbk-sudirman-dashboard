// server/scrapers/instagram/parseCaption.js
const { parseIndoDate } = require("../scraperUtils");

const PRICE_RE = /rp\.?\s?([\d.,]+)/i;
const CUTOFF_RE = /cut[\s-]?off[^\d]{0,20}(\d+)\s*(menit|minutes?|jam|hours?)/i;

function parsePrice(text) {
  const m = text.match(PRICE_RE);
  if (!m) return null;
  const n = Number(m[1].replace(/[.,]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function parseCutoffMinutes(text) {
  const m = text.match(CUTOFF_RE);
  if (!m) return null;
  const value = Number(m[1]);
  if (!Number.isFinite(value)) return null;
  const unit = m[2].toLowerCase();
  return unit.startsWith("jam") || unit.startsWith("hour") ? value * 60 : value;
}

// Best-effort extraction from an Instagram post caption. Captions are free text
// written by organizers, not structured data - this pulls out what it reliably
// can (date, one price mention, one cutoff-time mention) and leaves the rest
// null; callers attach venue/geo separately since captions rarely name a precise
// address.
function parseCaption(caption) {
  if (!caption) return null;
  const date = parseIndoDate(caption);
  if (!date) return null;

  const firstLine = caption.split("\n")[0].trim();
  return {
    name: firstLine || "Instagram running event",
    date,
    dateRaw: caption.slice(0, 120),
    categories: [{ distance: "General", price: parsePrice(caption), cutoffMinutes: parseCutoffMinutes(caption) }],
    category: "Road Run",
  };
}

module.exports = { parseCaption, parsePrice, parseCutoffMinutes };
