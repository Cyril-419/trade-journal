// Run with: node --test   (from the project folder)
const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../stats.js");

const t = (o) => S.normalizeTrade({ date: "2026-11-16", symbol: "AAPL", side: "long", qty: 10, entry: 100, exit: 110, fees: 0, ...o });

test("long and short P&L, including fees", () => {
  assert.equal(S.tradePnl(t({})), 100);
  assert.equal(S.tradePnl(t({ side: "short" })), -100);
  assert.equal(S.tradePnl(t({ side: "short", exit: 90, fees: 2 })), 98);
  assert.equal(S.tradeReturnPct(t({})), 10);
});

test("summary statistics", () => {
  const trades = [t({ exit: 110 }), t({ exit: 120 }), t({ exit: 95 }), t({ exit: 100 })]; // +100, +200, -50, 0
  const s = S.summary(trades);
  assert.equal(s.totalTrades, 4);
  assert.equal(s.wins, 2);
  assert.equal(s.losses, 1);
  assert.equal(s.winRate, 66.67);          // breakeven trade excluded
  assert.equal(s.netPnl, 250);
  assert.equal(s.avgWin, 150);
  assert.equal(s.avgLoss, -50);
  assert.equal(s.profitFactor, 6);
  assert.equal(s.best, 200);
  assert.equal(s.worst, -50);
});

test("empty journal doesn't divide by zero", () => {
  const s = S.summary([]);
  assert.equal(s.winRate, 0);
  assert.equal(s.avgPnl, 0);
  assert.equal(s.profitFactor, 0);
});

test("equity curve is date ordered and max drawdown is measured from the peak", () => {
  const trades = [
    t({ date: "2026-11-03", exit: 90 }),   // -100
    t({ date: "2026-11-01", exit: 130 }),  // +300
    t({ date: "2026-11-02", exit: 80 }),   // -200
  ];
  assert.deepEqual(S.equityCurve(trades, 1000).map((p) => p.balance), [1300, 1100, 1000]);
  assert.equal(S.maxDrawdown(trades), 300);
});

test("grouping by symbol and weekday", () => {
  const trades = [t({ symbol: "aapl" }), t({ symbol: "TSLA", exit: 90 }), t({ symbol: "AAPL", exit: 105 })];
  assert.deepEqual(S.groupPnl(trades, (x) => x.symbol), [["AAPL", 150], ["TSLA", -100]]);
  const byDay = Object.fromEntries(S.pnlByWeekday(trades));
  assert.equal(byDay.Mon, 50); // 2026-11-16 is a Monday
});

test("CSV round trip keeps commas, quotes and newlines in notes", () => {
  const original = [t({ notes: 'Chased it, "FOMO"\nnext time wait', setup: "breakout" })];
  const { trades, errors } = S.fromCsv(S.toCsv(original));
  assert.deepEqual(errors, []);
  assert.equal(trades[0].notes, original[0].notes);
  assert.equal(trades[0].setup, "breakout");
  assert.equal(S.tradePnl(trades[0]), 100);
});

test("CSV export neutralizes spreadsheet formulas", () => {
  const csv = S.toCsv([t({ notes: "=HYPERLINK(\"http://evil\")" })]);
  assert.match(csv, /'=HYPERLINK/);
  const { trades } = S.fromCsv(csv);
  assert.equal(trades[0].notes, '=HYPERLINK("http://evil")');
});

test("CSV import reports bad rows instead of dropping them silently", () => {
  const csv = "date,symbol,qty,entry,exit\n2026-11-16,AAPL,10,100,110\nnot-a-date,MSFT,1,1,1\n2026-11-16,,1,1,1\n2026-11-16,NVDA,0,1,1";
  const { trades, errors } = S.fromCsv(csv);
  assert.equal(trades.length, 1);
  assert.equal(errors.length, 3);
  assert.match(errors[0], /Row 3/);
});

test("CSV import rejects files missing required columns", () => {
  const { errors } = S.fromCsv("date,symbol\n2026-11-16,AAPL");
  assert.match(errors[0], /Missing column/);
});
