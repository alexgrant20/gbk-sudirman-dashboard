// "Today" in Jakarta local time, as YYYY-MM-DD, so the today+future cutoff matches
// the audience the dashboard is for regardless of what timezone the server runs in.
function todayISO() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());
}

function isTodayOrFuture(dateStr) {
  return dateStr >= todayISO();
}

module.exports = { todayISO, isTodayOrFuture };
