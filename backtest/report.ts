import * as fs from "fs";
import * as path from "path";
import { TickSnapshot, SimulationMetrics, GridResult } from "./types";

export function generateReport(opts: {
  snapshots: TickSnapshot[];
  metrics: SimulationMetrics;
  passed: boolean;
  failures: string[];
  market: string;
  months: number;
  gridResults?: GridResult[];
  outputDir: string;
}): string {
  const { snapshots, metrics, passed, failures, market, months, gridResults, outputDir } = opts;

  // --- NAV time series data ---
  const navLabels = snapshots
    .filter((_, i) => i % 24 === 0) // daily points
    .map(s => new Date(s.timestamp * 1000).toISOString().slice(0, 10));
  const navValues = snapshots
    .filter((_, i) => i % 24 === 0)
    .map(s => s.nav.toFixed(2));

  // --- SOL price series ---
  const priceValues = snapshots
    .filter((_, i) => i % 24 === 0)
    .map(s => s.solPrice.toFixed(2));

  // --- Drawdown series ---
  let peak = snapshots[0]?.nav ?? 0;
  const drawdownValues = snapshots
    .filter((_, i) => i % 24 === 0)
    .map(s => {
      if (s.nav > peak) peak = s.nav;
      return peak > 0 ? (-(peak - s.nav) / peak * 100).toFixed(2) : "0";
    });

  // --- Funding rate series (daily average) ---
  const fundingByDay: number[][] = [];
  snapshots.forEach((s, i) => {
    const dayIdx = Math.floor(i / 24);
    if (!fundingByDay[dayIdx]) fundingByDay[dayIdx] = [];
    fundingByDay[dayIdx].push(s.fundingPayment);
  });
  const dailyFunding = fundingByDay.map(day =>
    (day.reduce((a, b) => a + b, 0)).toFixed(4)
  );

  // --- Grid scatter data (if available) ---
  const gridScatter = gridResults
    ? JSON.stringify(gridResults.map(r => ({
        x: r.maxDrawdownPct.toFixed(2),
        y: r.blendedAPY.toFixed(2),
        label: `${r.shortPerpSizeRatio}/${r.rebalanceThresholdPct}%/${r.minMarginHealthRatio}`,
        passes: r.maxDrawdownPct < 10 && r.healthBreachesBelow1_2 === 0,
      })))
    : "[]";

  const drawdownOnly = !passed && failures.length > 0 && failures.every(f => f.toLowerCase().includes("drawdown"));
  const passColor = passed ? "#22c55e" : drawdownOnly ? "#f59e0b" : "#ef4444";
  const passText = passed
    ? "PASS: Strategy meets all go/no-go criteria"
    : drawdownOnly
      ? `⚠ Note: ${failures.join(" | ")}`
      : `FAIL: ${failures.join(" | ")}`;

  const startDate = new Date(snapshots[0]?.timestamp * 1000).toISOString().slice(0, 10);
  const endDate = new Date(snapshots[snapshots.length - 1]?.timestamp * 1000).toISOString().slice(0, 10);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Backtest Report — ${market} ${months}m</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: system-ui, sans-serif; background: #0f172a; color: #e2e8f0; padding: 24px; }
  h1 { font-size: 1.5rem; font-weight: 700; margin-bottom: 4px; }
  .subtitle { color: #94a3b8; font-size: 0.9rem; margin-bottom: 24px; }
  .verdict { padding: 12px 20px; border-radius: 8px; font-weight: 700; font-size: 1rem;
             margin-bottom: 24px; background: ${passColor}22; border: 1px solid ${passColor}; color: ${passColor}; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-bottom: 24px; }
  .card { background: #1e293b; border-radius: 8px; padding: 16px; }
  .card .label { font-size: 0.75rem; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px; }
  .card .value { font-size: 1.4rem; font-weight: 700; }
  .card .value.good { color: #22c55e; }
  .card .value.bad { color: #ef4444; }
  .card .value.neutral { color: #60a5fa; }
  .charts { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 24px; }
  .chart-box { background: #1e293b; border-radius: 8px; padding: 16px; }
  .chart-box.full { grid-column: 1 / -1; }
  .chart-box h3 { font-size: 0.85rem; color: #94a3b8; margin-bottom: 12px; text-transform: uppercase; letter-spacing: 0.05em; }
  canvas { max-height: 260px; }
  @media (max-width: 768px) { .charts { grid-template-columns: 1fr; } .chart-box.full { grid-column: 1; } }
</style>
</head>
<body>
<h1>Delta-Neutral Backtest Report</h1>
<div class="subtitle">${market} &nbsp;·&nbsp; ${startDate} → ${endDate} &nbsp;·&nbsp; ${snapshots.length} hourly ticks</div>

<div class="verdict">${passText}</div>

<div class="grid">
  <div class="card">
    <div class="label">Blended APY</div>
    <div class="value ${metrics.blendedAPY > 15 ? "good" : "bad"}">${metrics.blendedAPY.toFixed(1)}%</div>
  </div>
  <div class="card">
    <div class="label">Sharpe Ratio</div>
    <div class="value ${metrics.sharpeRatio > 1 ? "good" : "neutral"}">${metrics.sharpeRatio.toFixed(2)}</div>
  </div>
  <div class="card">
    <div class="label">Max Drawdown</div>
    <div class="value ${metrics.maxDrawdownPct < 10 ? "good" : "bad"}">${metrics.maxDrawdownPct.toFixed(1)}%</div>
  </div>
  <div class="card">
    <div class="label">Worst 30d APY</div>
    <div class="value ${metrics.worstWindow30dAPY > 0 ? "good" : "bad"}">${metrics.worstWindow30dAPY.toFixed(1)}%</div>
  </div>
  <div class="card">
    <div class="label">Initial NAV</div>
    <div class="value neutral">$${metrics.initialNAV.toLocaleString("en-US", { maximumFractionDigits: 0 })}</div>
  </div>
  <div class="card">
    <div class="label">Final NAV</div>
    <div class="value neutral">$${metrics.finalNAV.toLocaleString("en-US", { maximumFractionDigits: 0 })}</div>
  </div>
  <div class="card">
    <div class="label">Rebalances</div>
    <div class="value neutral">${metrics.rebalanceCount}</div>
  </div>
  <div class="card">
    <div class="label">Neg. Funding Hrs</div>
    <div class="value ${metrics.negativeFundingHours === 0 ? "good" : "neutral"}">${metrics.negativeFundingHours}</div>
  </div>
  <div class="card">
    <div class="label">Health < 1.5</div>
    <div class="value ${metrics.healthBreachesBelow1_5 === 0 ? "good" : "neutral"}">${metrics.healthBreachesBelow1_5}</div>
  </div>
  <div class="card">
    <div class="label">Health < 1.2</div>
    <div class="value ${metrics.healthBreachesBelow1_2 === 0 ? "good" : "bad"}">${metrics.healthBreachesBelow1_2}</div>
  </div>
</div>

<div class="charts">
  <div class="chart-box full">
    <h3>NAV vs SOL Price (daily)</h3>
    <canvas id="navChart"></canvas>
  </div>
  <div class="chart-box">
    <h3>Drawdown (%)</h3>
    <canvas id="ddChart"></canvas>
  </div>
  <div class="chart-box">
    <h3>Daily Funding Income ($)</h3>
    <canvas id="fundingChart"></canvas>
  </div>
  ${gridResults ? `
  <div class="chart-box full">
    <h3>Grid Search — APY vs Drawdown (green = passes filter)</h3>
    <canvas id="gridChart"></canvas>
  </div>` : ""}
</div>

<script>
const labels = ${JSON.stringify(navLabels)};
const navValues = ${JSON.stringify(navValues)};
const priceValues = ${JSON.stringify(priceValues)};
const drawdownValues = ${JSON.stringify(drawdownValues)};
const dailyFunding = ${JSON.stringify(dailyFunding)};
const gridData = ${gridScatter};

const chartDefaults = {
  responsive: true,
  maintainAspectRatio: true,
  plugins: { legend: { labels: { color: "#94a3b8", boxWidth: 12 } } },
  scales: {
    x: { ticks: { color: "#64748b", maxTicksLimit: 8 }, grid: { color: "#1e293b" } },
    y: { ticks: { color: "#64748b" }, grid: { color: "#334155" } },
  }
};

// NAV + Price dual axis
new Chart(document.getElementById("navChart"), {
  type: "line",
  data: {
    labels,
    datasets: [
      { label: "NAV ($)", data: navValues, borderColor: "#60a5fa", backgroundColor: "#60a5fa22",
        fill: true, tension: 0.3, pointRadius: 0, yAxisID: "yNav" },
      { label: "SOL Price ($)", data: priceValues, borderColor: "#f59e0b", backgroundColor: "transparent",
        tension: 0.3, pointRadius: 0, yAxisID: "yPrice", borderDash: [4,2] },
    ]
  },
  options: { ...chartDefaults, scales: {
    x: { ticks: { color: "#64748b", maxTicksLimit: 10 }, grid: { color: "#334155" } },
    yNav: { position: "left", ticks: { color: "#60a5fa" }, grid: { color: "#334155" } },
    yPrice: { position: "right", ticks: { color: "#f59e0b" }, grid: { drawOnChartArea: false } },
  }}
});

// Drawdown
new Chart(document.getElementById("ddChart"), {
  type: "line",
  data: {
    labels,
    datasets: [{ label: "Drawdown (%)", data: drawdownValues, borderColor: "#ef4444",
      backgroundColor: "#ef444422", fill: true, tension: 0.3, pointRadius: 0 }]
  },
  options: { ...chartDefaults,
    plugins: { ...chartDefaults.plugins, annotation: {} },
    scales: { ...chartDefaults.scales,
      y: { ticks: { color: "#64748b", callback: v => v + "%" }, grid: { color: "#334155" } }
    }
  }
});

// Funding
new Chart(document.getElementById("fundingChart"), {
  type: "bar",
  data: {
    labels,
    datasets: [{ label: "Daily Funding ($)", data: dailyFunding,
      backgroundColor: dailyFunding.map(v => Number(v) >= 0 ? "#22c55e88" : "#ef444488"),
      borderColor: dailyFunding.map(v => Number(v) >= 0 ? "#22c55e" : "#ef4444"),
      borderWidth: 1 }]
  },
  options: chartDefaults
});

// Grid scatter
if (gridData.length > 0 && document.getElementById("gridChart")) {
  const passing = gridData.filter(d => d.passes);
  const failing = gridData.filter(d => !d.passes);
  new Chart(document.getElementById("gridChart"), {
    type: "scatter",
    data: {
      datasets: [
        { label: "Passes filter", data: passing.map(d => ({ x: d.x, y: d.y })),
          backgroundColor: "#22c55e99", pointRadius: 6 },
        { label: "Fails filter", data: failing.map(d => ({ x: d.x, y: d.y })),
          backgroundColor: "#ef444499", pointRadius: 6 },
      ]
    },
    options: { ...chartDefaults, scales: {
      x: { title: { display: true, text: "Max Drawdown (%)", color: "#94a3b8" },
           ticks: { color: "#64748b" }, grid: { color: "#334155" } },
      y: { title: { display: true, text: "Blended APY (%)", color: "#94a3b8" },
           ticks: { color: "#64748b" }, grid: { color: "#334155" } },
    }}
  });
}
</script>
</body>
</html>`;

  const outPath = path.join(outputDir, "report.html");
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(outPath, html, "utf-8");
  return outPath;
}
