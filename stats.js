// Pure calculation functions: no DOM, no storage.
// Kept separate from app.js so they can be unit tested with Node.

(function (root) {
  "use strict";

  const round2 = (n) => Math.round(n * 100) / 100;

  // Profit or loss for one trade, after fees.
  function tradePnl(t) {
    const direction = t.side === "short" ? -1 : 1;
    return round2((Number(t.exit) - Number(t.entry)) * Number(t.qty) * direction - Number(t.fees || 0));
  }

  // Return as a percent of the money put into the position.
  function tradeReturnPct(t) {
    const cost = Number(t.entry) * Number(t.qty);
    return cost ? round2((tradePnl(t) / cost) * 100) : 0;
  }

  function sortByDate(trades) {
    return [...trades].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }

  function summary(trades) {
    const pnls = trades.map(tradePnl);
    const wins = pnls.filter((p) => p > 0);
    const losses = pnls.filter((p) => p < 0);
    const sum = (arr) => arr.reduce((a, b) => a + b, 0);
    const grossWin = sum(wins);
    const grossLoss = Math.abs(sum(losses));
    const decided = wins.length + losses.length; // breakeven trades don't count toward win rate

    return {
      totalTrades: trades.length,
      wins: wins.length,
      losses: losses.length,
      winRate: decided ? round2((wins.length / decided) * 100) : 0,
      netPnl: round2(sum(pnls)),
      avgPnl: trades.length ? round2(sum(pnls) / trades.length) : 0,
      avgWin: wins.length ? round2(grossWin / wins.length) : 0,
      avgLoss: losses.length ? round2(-grossLoss / losses.length) : 0,
      // Profit factor = gross profit / gross loss. Above 1 means the strategy makes money.
      profitFactor: grossLoss ? round2(grossWin / grossLoss) : (grossWin ? Infinity : 0),
      best: pnls.length ? Math.max(...pnls) : 0,
      worst: pnls.length ? Math.min(...pnls) : 0,
      maxDrawdown: maxDrawdown(trades),
    };
  }

  // Running account balance after each trade, in date order.
  function equityCurve(trades, startingBalance = 0) {
    let balance = Number(startingBalance) || 0;
    return sortByDate(trades).map((t) => {
      balance = round2(balance + tradePnl(t));
      return { date: t.date, balance };
    });
  }

  // Largest drop from a peak balance, as a positive dollar amount.
  function maxDrawdown(trades) {
    let peak = 0, balance = 0, worst = 0;
    for (const t of sortByDate(trades)) {
      balance += tradePnl(t);
      peak = Math.max(peak, balance);
      worst = Math.max(worst, peak - balance);
    }
    return round2(worst);
  }

  // Sum P&L by any key, e.g. symbol or setup. Returns [[key, pnl], ...] sorted high to low.
  function groupPnl(trades, keyFn) {
    const totals = new Map();
    for (const t of trades) {
      const key = keyFn(t) || "(none)";
      totals.set(key, round2((totals.get(key) || 0) + tradePnl(t)));
    }
    return [...totals.entries()].sort((a, b) => b[1] - a[1]);
  }

  const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  function pnlByWeekday(trades) {
    const totals = WEEKDAYS.map(() => 0);
    for (const t of trades) {
      const day = new Date(t.date + "T12:00:00").getDay(); // noon avoids timezone edge cases
      totals[day] = round2(totals[day] + tradePnl(t));
    }
    return WEEKDAYS.map((d, i) => [d, totals[i]]);
  }

  // { "2026-11-16": { pnl: 120.5, count: 3 }, ... }
  function dailyPnl(trades) {
    const days = {};
    for (const t of trades) {
      const d = (days[t.date] ||= { pnl: 0, count: 0 });
      d.pnl = round2(d.pnl + tradePnl(t));
      d.count += 1;
    }
    return days;
  }

  // ---- CSV -----------------------------------------------------------------
  const CSV_FIELDS = ["date", "symbol", "side", "qty", "entry", "exit", "fees", "setup", "notes"];

  function csvEscape(value) {
    let s = String(value ?? "");
    // Guard against CSV formula injection when the file is opened in Excel.
    if (/^[=+\-@\t\r]/.test(s) && isNaN(Number(s))) s = "'" + s;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  function toCsv(trades) {
    const header = [...CSV_FIELDS, "pnl"].join(",");
    const rows = sortByDate(trades).map((t) =>
      [...CSV_FIELDS.map((f) => csvEscape(t[f])), tradePnl(t)].join(","));
    return [header, ...rows].join("\n");
  }

  // Minimal CSV parser that handles quoted fields with commas, quotes and newlines.
  function parseCsvRows(text) {
    const rows = [];
    let row = [], field = "", inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
        else if (c === '"') inQuotes = false;
        else field += c;
      } else if (c === '"') inQuotes = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(field); rows.push(row); row = []; field = "";
      } else field += c;
    }
    if (field !== "" || row.length) { row.push(field); rows.push(row); }
    return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
  }

  // Returns { trades, errors } so bad rows are reported instead of silently dropped.
  function fromCsv(text) {
    const rows = parseCsvRows(text.replace(/^﻿/, ""));
    if (!rows.length) return { trades: [], errors: ["File is empty"] };
    const header = rows[0].map((h) => h.trim().toLowerCase());
    const missing = ["date", "symbol", "qty", "entry", "exit"].filter((f) => !header.includes(f));
    if (missing.length) return { trades: [], errors: [`Missing column(s): ${missing.join(", ")}`] };

    const trades = [], errors = [];
    rows.slice(1).forEach((cells, i) => {
      const rec = {};
      header.forEach((h, j) => (rec[h] = (cells[j] ?? "").trim().replace(/^'(?=[=+\-@])/, "")));
      const t = normalizeTrade(rec);
      const problem = validateTrade(t);
      if (problem) errors.push(`Row ${i + 2}: ${problem}`);
      else trades.push(t);
    });
    return { trades, errors };
  }

  function normalizeTrade(rec) {
    return {
      id: rec.id || newId(),
      date: String(rec.date || "").slice(0, 10),
      symbol: String(rec.symbol || "").trim().toUpperCase(),
      side: String(rec.side || "long").toLowerCase() === "short" ? "short" : "long",
      qty: Number(rec.qty),
      entry: Number(rec.entry),
      exit: Number(rec.exit),
      fees: Number(rec.fees || 0),
      setup: String(rec.setup || "").trim(),
      notes: String(rec.notes || "").trim(),
    };
  }

  function validateTrade(t) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(t.date) || isNaN(new Date(t.date).getTime())) return "date must be YYYY-MM-DD";
    if (!t.symbol) return "symbol is required";
    if (!(t.qty > 0)) return "quantity must be greater than 0";
    if (!(t.entry > 0) || !(t.exit > 0)) return "entry and exit prices must be greater than 0";
    if (!(t.fees >= 0)) return "fees can't be negative";
    return null;
  }

  function newId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  const api = {
    tradePnl, tradeReturnPct, summary, equityCurve, maxDrawdown, groupPnl, pnlByWeekday,
    dailyPnl, toCsv, fromCsv, parseCsvRows, normalizeTrade, validateTrade, sortByDate, newId,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api; // Node (tests)
  else root.Stats = api;                                                     // browser
})(typeof window !== "undefined" ? window : globalThis);
