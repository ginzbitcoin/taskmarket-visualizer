// Taskmarket Live Market Visualizer
// Reads data/tempo.json and data/base.json, written server-side by
// scripts/fetch-data.mjs from the public Taskmarket API. No browser
// request ever goes to the API. No wallet, no analytics, no tracking.
"use strict";

const CHAINS = {
  tempo: { label: "Tempo", token: "OUSD", file: "data/tempo.json" },
  base: { label: "Base", token: "USDC", file: "data/base.json" },
};
const RANGES = ["7d", "30d", "90d", "all"];
const RANGE_LABEL = { "7d": "7 days", "30d": "30 days", "90d": "90 days", "all": "all time" };

let state = { chain: "tempo", range: "30d", data: {} };

const $ = (id) => document.getElementById(id);
const fmtInt = new Intl.NumberFormat("en-US");
const fmtMoney = (n) =>
  n == null ? "n/a" : "$" + fmtInt.format(Math.round(n * 100) / 100);
const fmtCompact = (n) =>
  n == null ? "n/a" : n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, "") + "k" : String(n);
const shortAddr = (a) =>
  typeof a === "string" && a.length > 12 ? a.slice(0, 6) + "..." + a.slice(-4) : a || "unknown";

function fmtAsOf(iso) {
  const d = new Date(iso);
  const wib = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jakarta", day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: true,
  }).format(d);
  const utc = new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC", day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: true,
  }).format(d);
  return `${wib} WIB (${utc} UTC)`;
}

function relTime(iso) {
  const mins = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function esc(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Line chart as inline SVG. values: array of numbers (null allowed), labels: bucket strings.
function lineChart(values, labels, height = 120) {
  const W = 560, H = height, PAD_L = 44, PAD_R = 8, PAD_T = 8, PAD_B = 20;
  const pts = values.map((v, i) => ({ x: i, y: v }));
  const nums = values.filter((v) => v != null);
  if (!nums.length) return '<p class="empty">No data for this range.</p>';
  const max = Math.max(...nums), min = Math.min(0, ...nums);
  const span = max - min || 1;
  const x = (i) => PAD_L + (i / Math.max(1, values.length - 1)) * (W - PAD_L - PAD_R);
  const y = (v) => PAD_T + (1 - (v - min) / span) * (H - PAD_T - PAD_B);
  const line = pts.filter((p) => p.y != null).map((p, i) => `${i === 0 ? "M" : "L"}${x(p.x).toFixed(1)},${y(p.y).toFixed(1)}`).join(" ");
  const first = pts.find((p) => p.y != null), last = [...pts].reverse().find((p) => p.y != null);
  const area = `${line} L${x(last.x).toFixed(1)},${y(min).toFixed(1)} L${x(first.x).toFixed(1)},${y(min).toFixed(1)} Z`;
  const ticks = [0, 0.5, 1].map((f) => min + f * span);
  const grid = ticks.map((t) =>
    `<line class="grid-line" x1="${PAD_L}" x2="${W - PAD_R}" y1="${y(t)}" y2="${y(t)}"/>` +
    `<text class="axis" x="${PAD_L - 6}" y="${y(t) + 3}" text-anchor="end">${fmtCompact(Math.round(t))}</text>`
  ).join("");
  const xLabels = labels.length > 1
    ? `<text class="axis" x="${PAD_L}" y="${H - 4}">${esc(labels[0])}</text>` +
      `<text class="axis" x="${W - PAD_R}" y="${H - 4}" text-anchor="end">${esc(labels[labels.length - 1])}</text>`
    : "";
  const dots = pts.filter((p) => p.y != null).map((p) =>
    `<circle class="dot" cx="${x(p.x)}" cy="${y(p.y)}" r="2.5"><title>${esc(labels[p.x])}: ${fmtInt.format(p.y)}</title></circle>`
  ).join("");
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Line chart, latest value ${fmtInt.format(last.y)}">${grid}<path class="area" d="${area}"/><path class="line" d="${line}"/>${dots}${xLabels}</svg>`;
}

function barRows(items, total, alt) {
  const max = Math.max(1, ...items.map((i) => i.count));
  return items.map((i) => {
    const pct = total ? Math.round((i.count / total) * 100) : 0;
    return `<div class="bar-row"><span class="name" title="${esc(i.name)}">${esc(i.name)}</span>` +
      `<span class="track"><i class="${alt ? "alt" : ""}" style="width:${Math.max(2, (i.count / max) * 100)}%"></i></span>` +
      `<span class="count">${fmtInt.format(i.count)} (${pct}%)</span></div>`;
  }).join("");
}

function heatColor(count, max) {
  if (!count) return "#12100e";
  const t = count / max;
  // ground -> maroon -> magenta
  const c1 = [58, 20, 32], c2 = [231, 64, 121];
  const mix = (a, b) => Math.round(a + (b - a) * t);
  return `rgb(${mix(c1[0], c2[0])},${mix(c1[1], c2[1])},${mix(c1[2], c2[2])})`;
}

function render() {
  const d = state.data[state.chain];
  const other = state.data[state.chain === "tempo" ? "base" : "tempo"];
  if (!d) return;
  const chain = CHAINS[state.chain];
  const m = d.market || {};
  const series = d.series[state.range] || [];
  const labels = series.map((r) => r.bucket);

  document.querySelectorAll("[data-token]").forEach((el) => { el.textContent = `(${chain.token})`; });
  $("asof").textContent = fmtAsOf(d.generatedAt);

  // Headline stats
  const sum = (key) => series.reduce((a, r) => a + (r[key] || 0), 0);
  const stats = [
    { v: fmtInt.format(m.openTasks ?? 0), l: "Open tasks" },
    { v: fmtInt.format(m.activeAgents7d ?? 0), l: "Active agents, last 7 days" },
    { v: fmtInt.format(m.registeredWorkers ?? 0), l: "Registered workers" },
    { v: fmtInt.format(m.paidWorkers ?? 0), l: `Paid workers (${chain.label})` },
    { v: fmtInt.format(m.activeWallets ?? 0), l: `Active wallets (${chain.label})` },
    { v: fmtMoney(sum("paidVolume")), l: `Rewards paid, ${RANGE_LABEL[state.range]} (${chain.token})` },
    { v: fmtInt.format(sum("tasksCreated")), l: `Tasks posted, ${RANGE_LABEL[state.range]}` },
    { v: fmtMoney(sum("rewardVolume")), l: `Rewards put up, ${RANGE_LABEL[state.range]} (${chain.token})` },
  ];
  $("headline").innerHTML = stats.map((s) =>
    `<div class="stat"><div class="value">${s.v}</div><div class="label">${s.l}</div></div>`).join("");

  // Chain comparison strip
  if (other) {
    const t = state.data.tempo, b = state.data.base;
    const row = (label, a, c) =>
      `<tr><td>${label}</td><td class="num">${a}</td><td class="num">${c}</td></tr>`;
    $("chain-compare").innerHTML =
      `<table><thead><tr><th></th><th class="num">Tempo (OUSD)</th><th class="num">Base (USDC)</th></tr></thead><tbody>` +
      row("Open tasks", fmtInt.format(t.market.openTasks ?? 0), fmtInt.format(b.market.openTasks ?? 0)) +
      row("Paid workers", fmtInt.format(t.market.paidWorkers ?? 0), fmtInt.format(b.market.paidWorkers ?? 0)) +
      row("Active wallets", fmtInt.format(t.market.activeWallets ?? 0), fmtInt.format(b.market.activeWallets ?? 0)) +
      row("Distinct posters, last 7 days", fmtInt.format(t.postersWeek.distinct), fmtInt.format(b.postersWeek.distinct)) +
      row("Tasks posted, last 7 days", fmtInt.format(t.postersWeek.total), fmtInt.format(b.postersWeek.total)) +
      `</tbody></table><p class="note">Market stats are per chain as returned by the API. Open tasks and active agents are the same on both chains at this fetch.</p>`;
  }

  // Trend charts
  $("chart-agents").innerHTML = lineChart(series.map((r) => r.activeAgents), labels);
  $("chart-tasks").innerHTML = lineChart(series.map((r) => r.tasksCreated), labels);
  $("chart-rewards").innerHTML = lineChart(series.map((r) => r.rewardVolume), labels);
  $("chart-paid").innerHTML = lineChart(series.map((r) => r.paidVolume), labels);
  $("range-note").textContent =
    `${series.length} buckets in the ${RANGE_LABEL[state.range]} range. ` +
    `Rewards put up ${fmtMoney(sum("rewardVolume"))}, rewards paid ${fmtMoney(sum("paidVolume"))}, ` +
    `${fmtInt.format(sum("tasksCreated"))} tasks posted, ${fmtInt.format(sum("settlements"))} settlements.`;

  // Money flow
  const putUp = sum("rewardVolume"), paid = sum("paidVolume");
  const pctPaid = putUp > 0 ? Math.round((paid / putUp) * 100) : 0;
  $("flow-view").innerHTML =
    `<div class="flow-card"><div class="value">${fmtMoney(putUp)}</div><div class="label">Rewards put up, ${RANGE_LABEL[state.range]} (${chain.token})</div>` +
    `<div class="flow-bar"><i style="width:100%"></i></div></div>` +
    `<div class="flow-card"><div class="value">${fmtMoney(paid)}</div><div class="label">Rewards paid, ${RANGE_LABEL[state.range]} (${chain.token})</div>` +
    `<div class="flow-bar paid"><i style="width:${Math.min(100, pctPaid)}%"></i></div>` +
    `<p class="flow-note">${pctPaid}% of the value put up in this window was paid out in the same window.</p></div>`;

  // Breakdowns
  const bd = d.breakdowns || {};
  const modeItems = (bd.mode || []).map((x) => ({ name: x.mode, count: x.count })).sort((a, b) => b.count - a.count);
  const statusItems = (bd.status || []).map((x) => ({ name: x.status.replace(/_/g, " "), count: x.count })).sort((a, b) => b.count - a.count);
  const actorItems = (bd.actorType || []).map((x) => ({ name: x.actorType, count: x.count })).sort((a, b) => b.count - a.count);
  const modeTotal = modeItems.reduce((a, i) => a + i.count, 0);
  const statusTotal = statusItems.reduce((a, i) => a + i.count, 0);
  const actorTotal = actorItems.reduce((a, i) => a + i.count, 0);
  $("by-mode").innerHTML = barRows(modeItems, modeTotal) + `<p class="bar-total">${fmtInt.format(modeTotal)} tasks in total.</p>`;
  $("by-status").innerHTML = barRows(statusItems, statusTotal, true) + `<p class="bar-total">${fmtInt.format(statusTotal)} tasks in total.</p>`;
  $("by-actor").innerHTML = barRows(actorItems, actorTotal) + `<p class="bar-total">${fmtInt.format(actorTotal)} registered workers in total.</p>`;

  // Posters per week
  const pw = d.postersWeek || { distinct: 0, total: 0, top: [] };
  const topShare = pw.total > 0 && pw.top.length ? Math.round((pw.top[0].count / pw.total) * 100) : 0;
  $("poster-stats").innerHTML =
    `<div class="stat"><div class="value">${fmtInt.format(pw.distinct)}</div><div class="label">Distinct posters, last 7 days</div></div>` +
    `<div class="stat"><div class="value">${fmtInt.format(pw.total)}</div><div class="label">Tasks posted, last 7 days</div></div>` +
    `<div class="stat"><div class="value">${topShare}%</div><div class="label">Share of the most active poster</div></div>` +
    `<div class="stat"><div class="value">${pw.distinct ? (pw.total / pw.distinct).toFixed(1) : "n/a"}</div><div class="label">Tasks per poster, average</div></div>`;
  $("poster-top").innerHTML = pw.top.length
    ? barRows(pw.top.map((p) => ({ name: shortAddr(p.requester), count: p.count })), pw.total, true)
    : '<p class="empty">No posters in the last 7 days.</p>';

  // Heatmaps
  const hm = d.heatmapMode || {};
  if (hm.cells && hm.cells.length) {
    const rows = hm.rowKeys || [], cols = hm.colKeys || [];
    const cell = (r, c) => (hm.cells || []).find((x) => x.row === r && x.col === c);
    const max = hm.maxCount || Math.max(1, ...hm.cells.map((x) => x.count));
    const shortDay = (iso) => new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
    let html = `<div class="heat" style="grid-template-columns: 74px repeat(${cols.length}, 1fr)">` +
      `<span class="cell lbl"></span>` + cols.map((c) => `<span class="cell lbl" style="justify-content:center">${shortDay(c)}</span>`).join("") +
      rows.map((r) => `<span class="cell lbl">${esc(r)}</span>` + cols.map((c) => {
        const cl = cell(r, c);
        const n = cl ? cl.count : 0;
        return `<span class="cell ${n ? "" : "zero"}" style="background:${heatColor(n, max)}" title="${esc(r)}, ${esc(c)}: ${n}">${n || ""}</span>`;
      }).join("")).join("") + `</div>` +
      `<div class="heat-legend"><span>Less</span><span class="sw" style="background:#12100e;border:1px solid #453e37"></span><span class="sw" style="background:#3a1420"></span><span class="sw" style="background:#e74079"></span><span>More</span><span>(busiest cell: ${fmtInt.format(max)})</span></div>`;
    $("heatmap-mode").innerHTML = html;
  } else {
    $("heatmap-mode").innerHTML = '<p class="empty">No heatmap data for this range.</p>';
  }

  const hh = d.heatmapHour || {};
  if (hh.cells && hh.cells.length) {
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const max = hh.maxCount || Math.max(1, ...hh.cells.map((x) => x.count));
    const cell = (r, c) => (hh.cells || []).find((x) => x.row === String(r) && x.col === String(c));
    let html = `<div class="heat" style="grid-template-columns: 34px repeat(24, 1fr)">` +
      `<span class="cell lbl"></span>` + [...Array(24).keys()].map((h) => `<span class="cell lbl" style="justify-content:center">${h}</span>`).join("") +
      days.map((day, di) => `<span class="cell lbl">${day}</span>` + [...Array(24).keys()].map((h) => {
        const cl = cell(di, h);
        const n = cl ? cl.count : 0;
        return `<span class="cell ${n ? "" : "zero"}" style="background:${heatColor(n, max)}" title="${day} ${String(h).padStart(2, "0")}:00 UTC: ${n}">${n || ""}</span>`;
      }).join("")).join("") + `</div>` +
      `<div class="heat-legend"><span>Less</span><span class="sw" style="background:#12100e;border:1px solid #453e37"></span><span class="sw" style="background:#3a1420"></span><span class="sw" style="background:#e74079"></span><span>More</span><span>(busiest hour: ${fmtInt.format(max)})</span></div>`;
    $("heatmap-hour").innerHTML = html;
  } else {
    $("heatmap-hour").innerHTML = '<p class="empty">No heatmap data for this range.</p>';
  }

  // Live feed
  const feed = (d.feed || []).slice(0, 50);
  $("feed-list").innerHTML = feed.length ? feed.map((f) => {
    const typeLabel = (f.type || "activity").replace(/_/g, " ");
    const amount = f.amount != null ? ` &middot; ${fmtMoney(Number(f.amount) / 1e6)} ${chain.token}` : "";
    return `<li><span class="when">${relTime(f.timestamp)}</span><span><span class="what">${esc(typeLabel)}: ${esc((f.taskTitle || "Untitled task").slice(0, 120))}</span><br>` +
      `<span class="meta">actor <span class="addr">${shortAddr(f.actor)}</span> (${esc(f.actorType || "unknown")}) &middot; task <span class="addr">${shortAddr(f.taskId)}</span>${amount}</span></span></li>`;
  }).join("") : '<li>No recent activity.</li>';

  // Insights, computed only from the fetched data
  const bountyShare = modeTotal ? Math.round(((modeItems.find((i) => i.name === "bounty") || { count: 0 }).count / modeTotal) * 100) : 0;
  const dead = (bd.status || []).filter((x) => x.status === "cancelled" || x.status === "expired").reduce((a, x) => a + x.count, 0);
  const deadShare = statusTotal ? Math.round((dead / statusTotal) * 100) : 0;
  const completed = (bd.status || []).find((x) => x.status === "completed");
  const human = (bd.actorType || []).find((x) => x.actorType === "human");
  const agents = (bd.actorType || []).find((x) => x.actorType === "agent");
  const putUp30 = d.series["30d"].reduce((a, r) => a + (r.rewardVolume || 0), 0);
  const paid30 = d.series["30d"].reduce((a, r) => a + (r.paidVolume || 0), 0);
  const insights = [
    { n: "01", h: "Posting is concentrated", p: `The most active poster put up <strong>${topShare}%</strong> of all tasks in the last 7 days on ${chain.label} (${fmtInt.format(pw.top.length ? pw.top[0].count : 0)} of ${fmtInt.format(pw.total)}). ${fmtInt.format(pw.distinct)} distinct posters shared the rest.` },
    { n: "02", h: "Bounty is the default mode", p: `<strong>${bountyShare}%</strong> of all tasks are bounties. Claim is a distant second. Pitch, benchmark and auction together are under 2% of tasks.` },
    { n: "03", h: "A visible share of tasks dies", p: `<strong>${fmtInt.format(dead)} tasks (${deadShare}%)</strong> ended cancelled or expired, against ${fmtInt.format(completed ? completed.count : 0)} completed. Tasks that die are part of the market, not an exception.` },
    { n: "04", h: "Almost everyone here is an agent", p: `<strong>${fmtInt.format(agents ? agents.count : 0)} agents</strong> against ${fmtInt.format(human ? human.count : 0)} humans among registered workers. This is a market of agents, with humans mostly on the posting side.` },
    { n: "05", h: "Money put up outruns money paid", p: `In the last 30 days, <strong>${fmtMoney(putUp30)}</strong> was put up and <strong>${fmtMoney(paid30)}</strong> was paid. The gap is the pipeline: rewards posted but not yet decided or accepted.` },
  ];
  $("insight-grid").innerHTML = insights.map((i) =>
    `<div class="insight"><h3><span class="n">${i.n}</span> ${i.h}</h3><p>${i.p}</p></div>`).join("");
}

function setChain(chain) {
  state.chain = chain;
  document.querySelectorAll(".chain-switch button").forEach((b) => {
    const active = b.dataset.chain === chain;
    b.classList.toggle("active", active);
    b.setAttribute("aria-pressed", String(active));
  });
  render();
}

function setRange(range) {
  state.range = range;
  document.querySelectorAll(".range-switch button").forEach((b) => {
    const active = b.dataset.range === range;
    b.classList.toggle("active", active);
    b.setAttribute("aria-pressed", String(active));
  });
  render();
}

async function load() {
  const [tempo, base] = await Promise.all(
    Object.values(CHAINS).map((c) => fetch(c.file).then((r) => {
      if (!r.ok) throw new Error(`Failed to load ${c.file}: HTTP ${r.status}`);
      return r.json();
    }))
  );
  state.data = { tempo, base };
  render();
}

document.querySelectorAll(".chain-switch button").forEach((b) =>
  b.addEventListener("click", () => setChain(b.dataset.chain)));
document.querySelectorAll(".range-switch button").forEach((b) =>
  b.addEventListener("click", () => setRange(b.dataset.range)));
document.querySelectorAll("[data-share]").forEach((a) =>
  a.addEventListener("click", (ev) => {
    ev.preventDefault();
    const url = location.origin + location.pathname + a.getAttribute("href");
    const done = () => { a.textContent = "Link copied"; a.classList.add("copied"); setTimeout(() => { a.textContent = "Share this view"; a.classList.remove("copied"); }, 2000); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(done, () => { location.hash = a.getAttribute("href"); done(); });
    } else {
      location.hash = a.getAttribute("href");
      done();
    }
  }));

load().catch((err) => {
  document.querySelector("main").insertAdjacentHTML("afterbegin",
    `<p class="empty" style="color:#d9a097">Could not load market data: ${esc(err.message)}. The data files are refreshed hourly; try again shortly.</p>`);
});
