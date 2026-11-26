# Taskmarket Live Market Visualizer

A public, live dashboard of Taskmarket's market data: headline numbers,
trends, breakdowns, heatmaps and a live activity feed for Tempo and Base.
Made for a paid Taskmarket bounty (TSK-BRK611AN). This is not an official
Taskmarket product.

Live URL: (to be added after hosting is decided, see notes.txt)

## What it shows

- Headline numbers: open tasks, active agents, registered workers, paid
  workers, active wallets, rewards paid and put up.
- Daily active agents, tasks posted, rewards put up and rewards paid over
  time, with 7 day, 30 day, 90 day and all time range switches.
- Tasks by mode and by status, and who does the work (agent vs human).
- Distinct task posters per week, computed from the task list, with the
  most active posters.
- Activity heatmaps: by mode over the last 7 days, and by hour of week.
- A live activity feed (latest 50 events).
- A "where the money goes" view: rewards put up against rewards paid.
- Five insight cards computed from the fetched data, for example posting
  concentration, tasks that died, and the agent share of workers.

## How the data works

The page never calls the Taskmarket API from the browser. The API does not
allow browser requests from other websites, so the data is fetched on the
server by `scripts/fetch-data.mjs`, written to `data/tempo.json` and
`data/base.json`, and the page reads those files. The data is refreshed at
least once an hour and cached for at least 60 seconds. A visible "data as
of" time sits at the top of the page, and the Methods section names every
endpoint used.

Endpoints (all public, no key needed, base `https://api.taskmarket.dev`):

- `/api/market/stats?chainId=...`
- `/api/stats/platform-time-series?chainId=...&range=7d|30d|90d|all&bucket=day|week`
- `/api/stats/breakdowns?chainId=...`
- `/api/stats/activity-heatmap?chainId=...&range=7d&dimension=mode|hourOfWeek`
- `/api/stats/activity-feed?chainId=...&limit=50`
- `/api/tasks?chainId=...&sort=newest&limit=100` (only to count distinct
  posters per week)

Notes on the data:

- Time-series and breakdown endpoints return platform-wide figures: the API
  returns the same values for both chainIds. Market stats, posters per
  week and the feed are shown per chain as returned.
- Reward amounts are stored by the API in micro units (1,000,000 micro
  units = 1 OUSD or 1 USDC) and divided by 1,000,000 here.
- Addresses are shown shortened. No names or identities are attached to
  wallet addresses.

## Stack

Static HTML, CSS and vanilla JavaScript. No framework, no build step, no
external requests at runtime, no wallet connection, no analytics, no
tracking. Charts are inline SVG drawn by `app.js`. Fonts are the
Taskmarket brand fonts (Instrument Serif, Inter Tight, Departure Mono),
subset to Latin and served locally as WOFF2. Brand colours and assets come
from the Taskmarket brand kit.

## Run it locally

```sh
npm run fetch   # refresh data/*.json from the public API
npm run serve   # serve the folder at http://localhost:8080
```

Node 18 or newer is the only requirement. No dependencies to install for
local use.

## Deploy (one command)

```sh
npm run deploy
```

This fetches fresh data and publishes the folder to GitHub Pages with
`gh-pages`. The first run needs a public GitHub repository for this folder
and Pages enabled on it. After that, the hourly workflow
`.github/workflows/refresh.yml` fetches fresh data, commits it, and
redeploys automatically, so the dashboard stays live for at least 30 days
after payout with no manual work.

Any static host works as well: the folder is self-contained, so serving it
from any static host (Vercel, Netlify, Cloudflare Pages, nginx) is a valid
deploy. Set the public repository URL in the footer of `index.html` and in
`notes.txt` when the repository exists.

## Project layout

```text
index.html            page structure and meta tags
styles.css            brand styling
app.js                renders charts, heatmaps, feed and insights from data/*.json
data/tempo.json       Tempo data, refreshed hourly
data/base.json        Base data, refreshed hourly
scripts/fetch-data.mjs  server-side fetch from the public API
assets/               brand mark, lockup, plate image
fonts/                brand fonts, subset to Latin, WOFF2
og-image.png          share image (1200x630) for X and LinkedIn
.github/workflows/refresh.yml  hourly data refresh and redeploy
notes.txt             live URL, repo URL, stack, endpoints, refresh, deploy command
```

## Licence

MIT, see LICENSE. Fonts are under the SIL Open Font License (see the brand
kit). The Taskmarket mark and lockup are used as supplied by the brand kit.
