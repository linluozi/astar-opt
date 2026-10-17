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

const argv = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = /^--([^=]+)=(.*)$/.exec(a);
  return m ? [m[1], m[2]] : [a, true];
}));
const baseFiles = (argv.base || 'results/base-core.json,results/base-rest.json').split(',');
const s1Files = (argv.s1 || 'results/s1-opt.json').split(',');
const optFiles = (argv.opt || 'results/s2c-core.json,results/s2c-rest.json').split(',');
const outFile = argv.out || 'results/analysis.json';
const base = load(baseFiles);
const s1 = load(s1Files);
const opt = load(optFiles);

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

// stage attribution on the 512 core subset (paired runs, ratios only)
const s1base = load((argv.s1base || 'results/s1-base.json').split(','));
const stageRows = [];
for (const [id, b] of s1base) {
  const a = s1.get(id);
  const o = opt.get(id);
  const fb = base.get(id);
  if (!a || !o || !fb) continue;
  stageRows.push({ id, b: b.msMedian, a: a.msMedian, fb: fb.msMedian, o: o.msMedian });
}
const stage = {
  n: stageRows.length,
  base: 1,
  s1: 1,
  s2: 1,
  s1Speedup: median(stageRows.map((r) => r.b / r.a)),
  s2Speedup: median(stageRows.map((r) => r.fb / r.o)),
  s1Sum: stageRows.reduce((x, r) => x + r.b, 0) / stageRows.reduce((x, r) => x + r.a, 0),
  s2Sum: stageRows.reduce((x, r) => x + r.fb, 0) / stageRows.reduce((x, r) => x + r.o, 0),
  baseTotal: stageRows.reduce((x, r) => x + r.b, 0),
  s1Total: stageRows.reduce((x, r) => x + r.a, 0),
  s2Total: stageRows.reduce((x, r) => x + r.o, 0),
};
const stageAll = { all: stage, big: stage };

const heavyRows = rows.filter((r) => r.size >= 256);
const heavy = {
  n: heavyRows.length,
  median: median(heavyRows.map((r) => r.speedup)),
  total: heavyRows.reduce((a, r) => a + r.baseMs, 0) / heavyRows.reduce((a, r) => a + r.optMs, 0),
  baseP95: median(heavyRows.map((r) => r.baseP95)),
  optP95: median(heavyRows.map((r) => r.optP95)),
};
const heavies = rows.filter((r) => r.size >= 256).sort((a, b) => b.baseMs - a.baseMs);
const memory = {
  base: median(heavies.map((r) => r.baseHeap)),
  opt: median(heavies.map((r) => r.optHeap)),
};
const mismatch = rows.filter((r) => !r.same);
const total = {
  scenarios: rows.length,
  baseMs: rows.reduce((a, r) => a + r.baseMs, 0),
  optMs: rows.reduce((a, r) => a + r.optMs, 0),
  speedup: rows.reduce((a, r) => a + r.baseMs, 0) / rows.reduce((a, r) => a + r.optMs, 0),
};

const out = { table, sizeTable, diagTable, stage: stageAll, memory, heavy, mismatch: mismatch.map((r) => r.id), total, rows };
fs.mkdirSync('results', { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(out, null, 1));

function line(s) {
  return `| ${s.label} | ${s.n} | ${s.median.toFixed(2)}× | ${s.p10.toFixed(2)}× | ${s.p90.toFixed(2)}× | ${s.baseMs.toFixed(1)} | ${s.optMs.toFixed(1)} | ${(s.baseMs / s.optMs).toFixed(2)}× |`;
}
const md = [];
md.push('# Baseline vs optimized\n');
md.push(`Scenarios: ${total.scenarios}, mismatches: ${mismatch.length}\n`);
md.push(`Sum of per-scenario medians: ${total.baseMs.toFixed(1)} ms -> ${total.optMs.toFixed(1)} ms (${total.speedup.toFixed(2)}×)\n`);
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
md.push('');
md.push('## Stage attribution (512 core, aggregate speedup)');
md.push('| set | n | S1 only | S1 + S2 |');
md.push('|---|---:|---:|---:|');
md.push(`| 512 only | ${stage.n} | ${stage.s1Sum.toFixed(2)}× | ${stage.s2Sum.toFixed(2)}× |`);
md.push('');
md.push('## Memory (median heap delta, size >= 256)');
md.push(`baseline ${(memory.base / 1024).toFixed(0)} KiB -> optimized ${(memory.opt / 1024).toFixed(0)} KiB`);
fs.writeFileSync('results/summary.md', md.join('\n'));
console.log(md.join('\n'));
