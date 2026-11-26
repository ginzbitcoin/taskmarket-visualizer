// fetch-data.mjs
// Server-side data fetch for the Taskmarket live market visualizer.
// Fetches only the public Taskmarket API (no key), for Tempo (4217) and
// Base (8453), and writes data/<chain>.json consumed by index.html.
// Run: node scripts/fetch-data.mjs   (also run hourly by GitHub Actions)
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const API = "https://api.taskmarket.dev";
const CHAINS = [
  { id: 4217, slug: "tempo", token: "OUSD" },
  { id: 8453, slug: "base", token: "USDC" },
];

async function get(path) {
  const res = await fetch(API + path, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`GET ${path} -> HTTP ${res.status}`);
  return res.json();
}

function microsToUnits(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n / 1e6 : null;
}

async function fetchChain(chain) {
  const { id } = chain;
  const [market, breakdowns, series7, series30, series90, seriesAll, heatMode, heatHour, feed] =
    await Promise.all([
      get(`/api/market/stats?chainId=${id}`),
      get(`/api/stats/breakdowns?chainId=${id}`),
      get(`/api/stats/platform-time-series?chainId=${id}&range=7d&bucket=day`),
      get(`/api/stats/platform-time-series?chainId=${id}&range=30d&bucket=day`),
      get(`/api/stats/platform-time-series?chainId=${id}&range=90d&bucket=week`),
      get(`/api/stats/platform-time-series?chainId=${id}&range=all&bucket=week`),
      get(`/api/stats/activity-heatmap?chainId=${id}&range=7d&dimension=mode`),
      get(`/api/stats/activity-heatmap?chainId=${id}&range=7d&dimension=hourOfWeek`),
      get(`/api/stats/activity-feed?chainId=${id}&limit=50`),
    ]);

  // Distinct task posters per week, computed from the task list (newest first).
  const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
  const posters = new Map();
  let totalWeek = 0;
  let cursor = null;
  let pages = 0;
  for (;;) {
    const qs = `/api/tasks?chainId=${id}&sort=newest&limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    const page = await get(qs);
    const tasks = page.tasks || [];
    if (!tasks.length) break;
    let stop = false;
    for (const t of tasks) {
      const created = Date.parse(t.createdAt);
      if (created < weekAgo) { stop = true; break; }
      totalWeek += 1;
      const r = t.requester || "unknown";
      posters.set(r, (posters.get(r) || 0) + 1);
    }
    pages += 1;
    cursor = page.cursor || page.nextCursor || null;
    if (stop || !cursor || pages >= 15) break;
  }
  const topPosters = [...posters.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([requester, count]) => ({ requester, count }));

  const norm = (rows) =>
    (Array.isArray(rows) ? rows : []).map((r) => ({
      bucket: r.bucket,
      tasksCreated: r.tasksCreated ?? null,
      rewardVolume: microsToUnits(r.rewardVolume),
      completedTasks: r.completedTasks ?? null,
      newAgents: r.newAgents ?? null,
      activeAgents: r.activeAgents ?? null,
      paidVolume: microsToUnits(r.paidVolume),
      settlements: r.settlements ?? null,
      ratings: r.ratings ?? null,
    }));

  return {
    generatedAt: new Date().toISOString(),
    chainId: id,
    chain: chain.slug,
    token: chain.token,
    market,
    breakdowns,
    series: { "7d": norm(series7), "30d": norm(series30), "90d": norm(series90), "all": norm(seriesAll) },
    heatmapMode: heatMode,
    heatmapHour: heatHour,
    feed: feed.items || feed || [],
    postersWeek: {
      distinct: posters.size,
      total: totalWeek,
      top: topPosters,
    },
  };
}

mkdirSync(join(ROOT, "data"), { recursive: true });
for (const chain of CHAINS) {
  const data = await fetchChain(chain);
  writeFileSync(join(ROOT, "data", `${chain.slug}.json`), JSON.stringify(data, null, 2));
  console.log(
    `${chain.slug}: openTasks=${data.market.openTasks} activeAgents7d=${data.market.activeAgents7d} ` +
    `postersWeek=${data.postersWeek.distinct}/${data.postersWeek.total} feed=${data.feed.length} ` +
    `series7=${data.series["7d"].length} series30=${data.series["30d"].length} series90=${data.series["90d"].length} seriesAll=${data.series["all"].length}`
  );
}
console.log("done");
