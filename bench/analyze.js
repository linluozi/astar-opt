'use strict';
// Aggregate the raw run files into the tables used by the report.
const fs = require('fs');
const path = require('path');

function load(files) {
  const m = new Map();
  for (const f of files) {
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    for (const r of j.records) m.set(r.id, r);
  }
  return m;
}
function median(a) {
  const s = a.slice().sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function quantile(a, q) {
  const s = a.slice().sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1))];
}
function pct(x) { return (x * 100).toFixed(1) + '%'; }

const base = load(['results/base-core.json', 'results/base-rest.json']);
const s1 = load(['results/s1-core.json']);
const opt = load(['results/s2c-core.json', 'results/s2c-rest.json']);

const rows = [];
for (const [id, b] of base) {
  const o = opt.get(id);
  if (!o || b.suite === 'repeat') continue;
  rows.push({
    id, suite: b.suite, size: b.size, density: b.density, diagonal: b.diagonal,
    baseMs: b.msMedian, optMs: o.msMedian, baseP95: b.msP95, optP95: o.msP95,
    speedup: b.msMedian / o.msMedian,
    baseExp: b.expanded, optExp: o.expanded,
    baseCost: b.cost, optCost: o.cost,
    baseHeap: b.heapDeltaBytes, optHeap: o.heapDeltaBytes,
    same: Math.abs(b.cost - o.cost) <= 1e-9 && b.expanded === o.expanded && o.valid,
  });
}

function group(keyFn) {
  const m = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
  return m;
}
const bySuite = group((r) => r.suite);
const bySize = group((r) => r.size);
const byDiag = group((r) => (r.diagonal ? '8-dir' : '4-dir'));

function stats(label, list) {
  const sp = list.map((r) => r.speedup);
  return {
    label, n: list.length,
    median: median(sp), p10: quantile(sp, 0.1), p90: quantile(sp, 0.9),
    min: Math.min(...sp), max: Math.max(...sp),
    baseMs: list.reduce((a, r) => a + r.baseMs, 0),
    optMs: list.reduce((a, r) => a + r.optMs, 0),
    baseP95: median(list.map((r) => r.baseP95)),
    optP95: median(list.map((r) => r.optP95)),
  };
}

const table = [...bySuite.entries()].map(([k, v]) => stats(k, v));
const sizeTable = [...bySize.entries()].map(([k, v]) => stats(String(k), v)).sort((a, b) => +a.label - +b.label);
const diagTable = [...byDiag.entries()].map(([k, v]) => stats(k, v));

// stage attribution on core
const stageRows = [];
for (const [id, b] of base) {
  if (b.suite !== 'core') continue;
  const a = s1.get(id);
  const o = opt.get(id);
  if (!a || !o) continue;
  stageRows.push({ id, base: b.msMedian, s1: a.msMedian, s2: o.msMedian });
}
const stageBig = stageRows.filter((r) => r.id.includes('|512|'));
function stageStats(list) {
  return {
    n: list.length,
    base: median(list.map((r) => r.base)),
    s1: median(list.map((r) => r.s1)),
    s2: median(list.map((r) => r.s2)),
    s1Speedup: median(list.map((r) => r.base / r.s1)),
    s2Speedup: median(list.map((r) => r.base / r.s2)),
    s1Sum: list.reduce((a, r) => a + r.base, 0) / list.reduce((a, r) => a + r.s1, 0),
    s2Sum: list.reduce((a, r) => a + r.base, 0) / list.reduce((a, r) => a + r.s2, 0),
  };
}
const stage = { all: stageStats(stageRows), big: stageStats(stageBig) };

const heavies = rows.filter((r) => r.size >= 256).sort((a, b) => b.baseMs - a.baseMs);
const memory = {
  base: median(heavies.map((r) => r.baseHeap)),
  opt: median(heavies.map((r) => r.optHeap)),
};

const mismatch = rows.filter((r) => !r.same);
const heavyRows = rows.filter((r) => r.size >= 256);
const heavy = {
  n: heavyRows.length,
  median: median(heavyRows.map((r) => r.speedup)),
  total: heavyRows.reduce((a, r) => a + r.baseMs, 0) / heavyRows.reduce((a, r) => a + r.optMs, 0),
  baseP95: median(heavyRows.map((r) => r.baseP95)),
  optP95: median(heavyRows.map((r) => r.optP95)),
};
const total = {
  scenarios: rows.length,
  baseMs: rows.reduce((a, r) => a + r.baseMs, 0),
  optMs: rows.reduce((a, r) => a + r.optMs, 0),
  speedup: rows.reduce((a, r) => a + r.baseMs, 0) / rows.reduce((a, r) => a + r.optMs, 0),
};

const out = { table, sizeTable, diagTable, stage, memory, heavy, mismatch: mismatch.map((r) => r.id), total, rows };
fs.mkdirSync('results', { recursive: true });
fs.writeFileSync('results/analysis.json', JSON.stringify(out, null, 1));

function line(s) {
  return `| ${s.label} | ${s.n} | ${s.median.toFixed(2)}× | ${s.p10.toFixed(2)}× | ${s.p90.toFixed(2)}× | ${s.baseMs.toFixed(1)} | ${s.optMs.toFixed(1)} | ${(s.baseMs / s.optMs).toFixed(2)}× |`;
}
const md = [];
md.push('# Baseline vs optimized\n');
md.push(`Scenarios: ${total.scenarios}, mismatches: ${mismatch.length}\n`);
md.push(`Sum of medians: ${total.baseMs.toFixed(1)} ms -> ${total.optMs.toFixed(1)} ms (${total.speedup.toFixed(2)}×)\n`);
md.push('## By suite\n');
md.push('| suite | n | median | p10 | p90 | base ms (sum) | new ms (sum) | total |');
md.push('|---|---:|---:|---:|---:|---:|---:|---:|');
table.forEach((s) => md.push(line(s)));
md.push('\n## By size\n');
md.push('| size | n | median | p10 | p90 | base ms (sum) | new ms (sum) | total |');
md.push('|---|---:|---:|---:|---:|---:|---:|---:|');
sizeTable.forEach((s) => md.push(line(s)));
md.push('\n## By movement\n');
md.push('| mode | n | median | p10 | p90 | base ms (sum) | new ms (sum) | total |');
md.push('|---|---:|---:|---:|---:|---:|---:|---:|');
diagTable.forEach((s) => md.push(line(s)));
md.push('\n## Stage attribution\n');
md.push('| set | n | baseline | S1 | S2 | S1 speedup | S2 speedup |');
md.push('|---|---:|---:|---:|---:|---:|---:|');
for (const [k, s] of [['all core', stage.all], ['512 only', stage.big]]) {
  md.push(`| ${k} | ${s.n} | ${s.base.toFixed(2)} ms | ${s.s1.toFixed(2)} ms | ${s.s2.toFixed(2)} ms | ${s.s1Speedup.toFixed(2)}× (sum ${s.s1Sum.toFixed(2)}×) | ${s.s2Speedup.toFixed(2)}× (sum ${s.s2Sum.toFixed(2)}×) |`);
}
md.push('\n## Memory (median heap delta, size >= 256)\n');
md.push(`baseline ${(memory.base / 1024).toFixed(0)} KiB -> optimized ${(memory.opt / 1024).toFixed(0)} KiB`);
fs.writeFileSync('results/summary.md', md.join('\n'));
console.log(md.join('\n'));
