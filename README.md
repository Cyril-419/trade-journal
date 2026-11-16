# Trade Journal

A browser-based trading journal for logging trades and finding patterns in your results. No account, no server: everything is saved in your browser.

**Try it:** open `index.html`, or turn on GitHub Pages for this repo and visit `https://cyril-419.github.io/trade-journal/`. Go to **Settings → Load demo data** to see it filled in.

## Features

- **Dashboard**: net P&L, win rate, profit factor, average win and loss, max drawdown, account balance, equity curve, and recent trades
- **Journal**: add, edit and delete trades; sort any column; search by symbol, setup or notes; filter by long/short and winners/losers
- **Analytics**: P&L broken down by symbol, setup, weekday, and long vs short
- **Calendar**: monthly view colored green or red by daily P&L
- **Settings**: starting balance, light/dark theme, CSV import and export, demo data

## Built with

Plain HTML, CSS and JavaScript (no framework), [Chart.js](https://www.chartjs.org/) for charts, and `localStorage` for saving.

```
index.html   page structure
styles.css   layout, dark/light themes, mobile layout
stats.js     all the trading math (P&L, win rate, drawdown, CSV), no DOM
app.js       rendering, events, storage
tests/       unit tests for stats.js
```

## Security details

- **No XSS.** User text (notes, symbols, setups) is always inserted with `textContent`, never `innerHTML`, so something like `<img onerror=...>` in a note shows up as text instead of running.
- **CSV formula injection guard.** On export, cells starting with `=`, `+`, `-` or `@` get a leading `'` so Excel won't run them as formulas. Import strips the guard back off.
- **Input validation.** Trades are validated in the form and again on CSV import; bad rows are reported by line number instead of silently dropped.

## Tests

```bash
node --test
```

Covers P&L for longs and shorts with fees, the summary stats, equity curve and drawdown, grouping, CSV round trips (commas, quotes and newlines in notes), formula injection, and import error reporting.

## Data and privacy

Trades never leave your browser. Clearing your browser data deletes them, so use **Export CSV** to keep a backup.
