// UI layer: storage, rendering, charts and event handling.
// All the trading math lives in stats.js.
"use strict";

const S = window.Stats;
const STORAGE_KEY = "tradeJournal.v1";

// ---------------------------------------------------------------- state
const state = {
  trades: [],
  settings: { theme: "dark", startingBalance: 10000 },
  sort: { key: "date", dir: -1 },
  calendarMonth: new Date(),
  editingId: null,
};
const charts = {};

// ---------------------------------------------------------------- storage
function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (saved) {
      state.trades = (saved.trades || []).map(S.normalizeTrade).filter((t) => !S.validateTrade(t));
      Object.assign(state.settings, saved.settings || {});
    }
  } catch {
    toast("Couldn't read saved trades from this browser.");
  }
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ trades: state.trades, settings: state.settings }));
  } catch {
    toast("Couldn't save. Your browser storage may be full or disabled.");
  }
}

// ---------------------------------------------------------------- helpers
const $ = (sel) => document.querySelector(sel);
const money = (n) =>
  (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pnlClass = (n) => (n > 0 ? "pos" : n < 0 ? "neg" : "");

// Build elements with textContent, never innerHTML, so notes like
// "<img onerror=...>" are shown as text instead of run as code (XSS).
function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") node.className = v;
    else if (k === "dataset") Object.assign(node.dataset, v);
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const c of children) node.append(c instanceof Node ? c : document.createTextNode(String(c ?? "")));
  return node;
}

let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 3000);
}

function cssVar(name) {
  return getComputedStyle(document.body).getPropertyValue(name).trim();
}

// ---------------------------------------------------------------- charts
function drawChart(id, config) {
  if (!window.Chart) return; // offline: the rest of the app still works
  charts[id]?.destroy();
  const text = cssVar("--muted");
  const grid = cssVar("--border");
  config.options = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    plugins: { legend: { display: config.type === "doughnut", labels: { color: text } } },
    ...(config.type !== "doughnut" && {
      scales: {
        x: { ticks: { color: text }, grid: { color: grid } },
        y: { ticks: { color: text, callback: (v) => money(v) }, grid: { color: grid } },
      },
    }),
    ...config.options,
  };
  charts[id] = new Chart(document.getElementById(id), config);
}

function barChart(id, pairs) {
  const pos = cssVar("--pos"), neg = cssVar("--neg");
  drawChart(id, {
    type: "bar",
    data: {
      labels: pairs.map((p) => p[0]),
      datasets: [{ data: pairs.map((p) => p[1]), backgroundColor: pairs.map((p) => (p[1] >= 0 ? pos : neg)), borderRadius: 4 }],
    },
  });
}

// ---------------------------------------------------------------- render: dashboard
function renderDashboard() {
  const s = S.summary(state.trades);
  const balance = state.settings.startingBalance + s.netPnl;
  const set = (id, text, cls) => { const n = $(id); n.textContent = text; n.className = "value " + (cls || ""); };

  set("#netPnl", money(s.netPnl), pnlClass(s.netPnl));
  set("#totalTrades", s.totalTrades);
  set("#winRate", s.winRate + "%");
  set("#profitFactor", s.profitFactor === Infinity ? "∞" : s.totalTrades ? s.profitFactor.toFixed(2) : "–");
  set("#avgWin", money(s.avgWin), "pos");
  set("#avgLoss", money(s.avgLoss), "neg");
  set("#maxDrawdown", money(-s.maxDrawdown), s.maxDrawdown ? "neg" : "");
  set("#balance", money(balance));

  const curve = S.equityCurve(state.trades, state.settings.startingBalance);
  drawChart("equityChart", {
    type: "line",
    data: {
      labels: ["Start", ...curve.map((p) => p.date)],
      datasets: [{
        data: [state.settings.startingBalance, ...curve.map((p) => p.balance)],
        borderColor: cssVar("--accent"), backgroundColor: cssVar("--accent-soft"),
        fill: true, tension: 0.25, pointRadius: curve.length > 60 ? 0 : 3,
      }],
    },
  });
  drawChart("winLossChart", {
    type: "doughnut",
    data: {
      labels: ["Wins", "Losses"],
      datasets: [{ data: [s.wins, s.losses], backgroundColor: [cssVar("--pos"), cssVar("--neg")], borderWidth: 0 }],
    },
  });

  const recent = S.sortByDate(state.trades).slice(-5).reverse();
  const box = $("#recentTrades");
  box.replaceChildren(
    recent.length
      ? el("ul", { class: "recent" }, ...recent.map((t) => {
          const p = S.tradePnl(t);
          return el("li", {}, el("span", {}, `${t.date} · ${t.symbol} · ${t.side}`), el("span", { class: pnlClass(p) }, money(p)));
        }))
      : el("p", { class: "muted" }, "No trades yet."),
  );
}

// ---------------------------------------------------------------- render: journal
function filteredTrades() {
  const q = $("#searchInput").value.trim().toLowerCase();
  const side = $("#sideFilter").value;
  const result = $("#resultFilter").value;
  return state.trades.filter((t) => {
    const p = S.tradePnl(t);
    if (side && t.side !== side) return false;
    if (result === "win" && p <= 0) return false;
    if (result === "loss" && p >= 0) return false;
    return !q || `${t.symbol} ${t.setup} ${t.notes}`.toLowerCase().includes(q);
  });
}

function renderJournal() {
  const { key, dir } = state.sort;
  const value = (t) => (key === "pnl" ? S.tradePnl(t) : t[key]);
  const rows = filteredTrades().sort((a, b) => (value(a) > value(b) ? dir : value(a) < value(b) ? -dir : 0));

  $("#tradesBody").replaceChildren(...rows.map((t) => {
    const p = S.tradePnl(t);
    return el("tr", {},
      el("td", {}, t.date),
      el("td", { class: "symbol" }, t.symbol),
      el("td", {}, el("span", { class: `tag ${t.side}` }, t.side)),
      el("td", { class: "num" }, t.qty),
      el("td", { class: "num" }, t.entry),
      el("td", { class: "num" }, t.exit),
      el("td", { class: `num ${pnlClass(p)}` }, `${money(p)} (${S.tradeReturnPct(t)}%)`),
      el("td", {}, t.setup),
      el("td", { class: "notes", title: t.notes }, t.notes),
      el("td", { class: "row-actions" },
        el("button", { class: "icon-btn", "aria-label": `Edit ${t.symbol} trade`, onclick: () => openModal(t) }, "✏️"),
        el("button", { class: "icon-btn", "aria-label": `Delete ${t.symbol} trade`, onclick: () => deleteTrade(t.id) }, "🗑️")),
    );
  }));

  document.querySelectorAll("th[data-sort]").forEach((th) => {
    th.classList.toggle("sorted", th.dataset.sort === key);
    th.dataset.dir = th.dataset.sort === key ? (dir > 0 ? "▲" : "▼") : "";
  });
  $("#emptyJournal").classList.toggle("hidden", state.trades.length > 0);
}

// ---------------------------------------------------------------- render: analytics
function renderAnalytics() {
  barChart("symbolChart", S.groupPnl(state.trades, (t) => t.symbol).slice(0, 12));
  barChart("setupChart", S.groupPnl(state.trades, (t) => t.setup));
  barChart("weekdayChart", S.pnlByWeekday(state.trades).slice(1, 6)); // Mon–Fri
  barChart("sideChart", S.groupPnl(state.trades, (t) => t.side));
}

// ---------------------------------------------------------------- render: calendar
function renderCalendar() {
  const m = state.calendarMonth;
  const year = m.getFullYear(), month = m.getMonth();
  $("#calendarTitle").textContent = m.toLocaleString(undefined, { month: "long", year: "numeric" });

  const daily = S.dailyPnl(state.trades);
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => el("div", { class: "cal-head" }, d));
  for (let i = 0; i < firstDay; i++) cells.push(el("div", { class: "cal-cell blank" }));

  let monthPnl = 0, tradingDays = 0;
  for (let day = 1; day <= daysInMonth; day++) {
    const key = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const d = daily[key];
    if (d) { monthPnl += d.pnl; tradingDays++; }
    cells.push(el("div", { class: `cal-cell ${d ? pnlClass(d.pnl) + "-bg" : ""}` },
      el("span", { class: "cal-day" }, day),
      d ? el("span", { class: "cal-pnl" }, money(d.pnl)) : "",
      d ? el("span", { class: "cal-count" }, `${d.count} trade${d.count > 1 ? "s" : ""}`) : ""));
  }
  $("#calendarGrid").replaceChildren(...cells);
  $("#monthSummary").textContent = tradingDays
    ? `${tradingDays} trading day(s) this month · Net ${money(Math.round(monthPnl * 100) / 100)}`
    : "No trades this month.";
}

function renderSettings() {
  $("#startingBalance").value = state.settings.startingBalance;
  $("#setupList").replaceChildren(...[...new Set(state.trades.map((t) => t.setup).filter(Boolean))]
    .map((s) => el("option", { value: s })));
}

function renderAll() {
  document.body.dataset.theme = state.settings.theme;
  renderDashboard();
  renderJournal();
  renderCalendar();
  renderSettings();
  if ($("#analytics-page").classList.contains("active")) renderAnalytics();
}

// ---------------------------------------------------------------- navigation
function showPage(name) {
  document.querySelectorAll(".page").forEach((p) => p.classList.toggle("active", p.id === `${name}-page`));
  document.querySelectorAll(".nav-link").forEach((b) => b.classList.toggle("active", b.dataset.page === name));
  $("#sidebarNav").classList.remove("open");
  $("#sidebarToggle").setAttribute("aria-expanded", "false");
  if (name === "analytics") renderAnalytics(); // charts need a visible canvas to size correctly
  if (name === "dashboard") renderDashboard();
  history.replaceState(null, "", `#${name}`);
}

// ---------------------------------------------------------------- add / edit / delete
function openModal(trade) {
  const form = $("#tradeForm");
  form.reset();
  $("#formError").textContent = "";
  state.editingId = trade?.id || null;
  $("#modalTitle").textContent = trade ? "Edit trade" : "Add trade";
  const values = trade || { date: new Date().toLocaleDateString("en-CA"), side: "long", fees: 0 };
  for (const [k, v] of Object.entries(values)) if (form.elements[k]) form.elements[k].value = v;
  updatePreview();
  $("#tradeModal").showModal();
  form.elements.symbol.focus();
}

function formTrade() {
  const data = Object.fromEntries(new FormData($("#tradeForm")));
  return S.normalizeTrade({ ...data, id: state.editingId || undefined });
}

function updatePreview() {
  const t = formTrade();
  $("#pnlPreview").textContent = S.validateTrade(t) ? "" : `P&L: ${money(S.tradePnl(t))} (${S.tradeReturnPct(t)}%)`;
}

function submitTrade(e) {
  e.preventDefault();
  const t = formTrade();
  const problem = S.validateTrade(t);
  if (problem) { $("#formError").textContent = problem[0].toUpperCase() + problem.slice(1) + "."; return; }

  const i = state.trades.findIndex((x) => x.id === t.id);
  if (i >= 0) state.trades[i] = t; else state.trades.push(t);
  save();
  $("#tradeModal").close();
  renderAll();
  toast(i >= 0 ? "Trade updated." : `Saved ${t.symbol}: ${money(S.tradePnl(t))}`);
}

function deleteTrade(id) {
  const t = state.trades.find((x) => x.id === id);
  if (!t || !confirm(`Delete ${t.symbol} trade from ${t.date}?`)) return;
  state.trades = state.trades.filter((x) => x.id !== id);
  save();
  renderAll();
  toast("Trade deleted.");
}

// ---------------------------------------------------------------- import / export / demo
function exportCsv() {
  if (!state.trades.length) return toast("Nothing to export yet.");
  const blob = new Blob([S.toCsv(state.trades)], { type: "text/csv" });
  const a = el("a", { href: URL.createObjectURL(blob), download: `trades-${new Date().toLocaleDateString("en-CA")}.csv` });
  a.click();
  URL.revokeObjectURL(a.href);
}

async function importCsv(e) {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  if (file.size > 5_000_000) return toast("File is too large (5 MB max).");
  const { trades, errors } = S.fromCsv(await file.text());
  if (trades.length) {
    state.trades.push(...trades);
    save();
    renderAll();
  }
  const msg = `Imported ${trades.length} trade(s).` + (errors.length ? ` Skipped ${errors.length}: ${errors.slice(0, 3).join("; ")}` : "");
  toast(msg);
  if (errors.length) console.warn("Import problems:", errors);
}

function loadDemo() {
  if (state.trades.length && !confirm("Add demo trades to your existing journal?")) return;
  const symbols = ["AAPL", "TSLA", "NVDA", "SPY", "AMD", "MSFT"];
  const setups = ["breakout", "pullback", "reversal", "gap and go"];
  const today = new Date();
  for (let i = 0; i < 40; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - Math.floor(i * 1.4));
    if (d.getDay() === 0) d.setDate(d.getDate() - 2);
    if (d.getDay() === 6) d.setDate(d.getDate() - 1);
    const entry = +(50 + Math.random() * 400).toFixed(2);
    const move = (Math.random() - 0.42) * 0.04;
    const side = Math.random() < 0.7 ? "long" : "short";
    state.trades.push(S.normalizeTrade({
      date: d.toLocaleDateString("en-CA"),
      symbol: symbols[i % symbols.length],
      side,
      qty: [10, 20, 25, 50][i % 4],
      entry,
      exit: +(entry * (1 + (side === "long" ? move : -move))).toFixed(2),
      fees: 1,
      setup: setups[(i * 7) % setups.length],
      notes: "Demo trade",
    }));
  }
  save();
  renderAll();
  toast("Loaded 40 demo trades.");
}

// ---------------------------------------------------------------- wire up
function init() {
  load();

  document.querySelectorAll(".nav-link").forEach((b) => b.addEventListener("click", () => showPage(b.dataset.page)));
  $("#sidebarToggle").addEventListener("click", () => {
    const open = $("#sidebarNav").classList.toggle("open");
    $("#sidebarToggle").setAttribute("aria-expanded", String(open));
  });
  $("#themeToggle").addEventListener("click", () => {
    state.settings.theme = state.settings.theme === "dark" ? "light" : "dark";
    save();
    renderAll();
  });

  $("#addTradeBtn").addEventListener("click", () => openModal());
  $("#cancelTrade").addEventListener("click", () => $("#tradeModal").close());
  $("#tradeForm").addEventListener("submit", submitTrade);
  $("#tradeForm").addEventListener("input", updatePreview);

  ["#searchInput", "#sideFilter", "#resultFilter"].forEach((s) => $(s).addEventListener("input", renderJournal));
  document.querySelectorAll("th[data-sort]").forEach((th) => th.addEventListener("click", () => {
    const key = th.dataset.sort;
    state.sort = { key, dir: state.sort.key === key ? -state.sort.dir : -1 };
    renderJournal();
  }));

  $("#prevMonth").addEventListener("click", () => { state.calendarMonth.setMonth(state.calendarMonth.getMonth() - 1, 1); renderCalendar(); });
  $("#nextMonth").addEventListener("click", () => { state.calendarMonth.setMonth(state.calendarMonth.getMonth() + 1, 1); renderCalendar(); });

  $("#exportCSV").addEventListener("click", exportCsv);
  $("#importCSV").addEventListener("change", importCsv);
  $("#loadDemo").addEventListener("click", loadDemo);
  $("#clearAll").addEventListener("click", () => {
    if (!state.trades.length || !confirm("Delete ALL trades? Export a CSV first if you want a backup.")) return;
    state.trades = [];
    save();
    renderAll();
    toast("All trades deleted.");
  });
  $("#startingBalance").addEventListener("change", (e) => {
    const v = Number(e.target.value);
    if (v >= 0) { state.settings.startingBalance = v; save(); renderDashboard(); }
  });

  renderAll();
  const page = location.hash.slice(1);
  if (document.getElementById(`${page}-page`)) showPage(page);
}

document.addEventListener("DOMContentLoaded", init);
