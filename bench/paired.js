'use strict';
// Paired A/B runner: for each scenario, alternate baseline and optimized in
// fresh processes for N rounds, then take the median of the per-round medians.
// This cancels most CPU-frequency drift between the two builds.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { getScenarios } = require('./scenarios');

function parseArgs(argv) {
  const out = {};
  for (const a of argv.slice(2)) {
    const m = /^--([^=]+)=(.*)$/.exec(a);
    if (m) out[m[1]] = m[2];
    else if (a.startsWith('--')) out[a.slice(2)] = true;
  }
  return out;
}
const args = parseArgs(process.argv);
const baseImpl = path.resolve(args.base || path.join(__dirname, 'baseline', 'astar-0.4.1.js'));
const optImpl = path.resolve(args.opt || path.join(__dirname, '..', 'astar.js'));
const rounds = parseInt(args.rounds || '3', 10);
const reps = parseInt(args.reps || '5', 10);
const suites = (args.suites || 'core,density,distance,diagonal,weights,special,repeat').split(',');
const outBase = path.resolve(args.outBase || 'results/paired-base.json');
const outOpt = path.resolve(args.outOpt || 'results/paired-opt.json');

function median(a) {
  const s = a.slice().sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function run(impl, id) {
  const tmp = path.join(path.dirname(outBase), '.p-' + crypto.createHash('md5').update(id + impl).digest('hex').slice(0, 8) + '.json');
  const res = spawnSync(process.execPath, ['--expose-gc', path.join(__dirname, 'run-one.js'),
    '--impl=' + impl, '--id=' + id, '--out=' + tmp, '--reps=' + reps], { encoding: 'utf8' });
  if (res.status !== 0) throw new Error(res.stderr + res.stdout);
  const rec = JSON.parse(fs.readFileSync(tmp, 'utf8'));
  fs.unlinkSync(tmp);
  return rec;
}

let scenarios = getScenarios(suites);
const sizes = args.sizes ? args.sizes.split(',').map(Number) : null;
if (sizes) scenarios = scenarios.filter((s) => sizes.includes(s.size));
const baseOut = [];
const optOut = [];

for (let i = 0; i < scenarios.length; i++) {
  const sc = scenarios[i];
  if (sc.repeat) {
    // correctness-only scenario, no timing
    const b = run(baseImpl, sc.id);
    const o = run(optImpl, sc.id);
    baseOut.push(b); optOut.push(o);
    process.stderr.write(`[${i + 1}/${scenarios.length}] ${sc.id} (repeat, correctness only)\n`);
    continue;
  }
  const bRuns = [], oRuns = [];
  for (let r = 0; r < rounds; r++) {
    // alternate the order so neither build always runs on a cold CPU
    if (r % 2 === 0) {
      bRuns.push(run(baseImpl, sc.id));
      oRuns.push(run(optImpl, sc.id));
    } else {
      oRuns.push(run(optImpl, sc.id));
      bRuns.push(run(baseImpl, sc.id));
    }
  }
  const pick = (runs) => ({
    id: sc.id, suite: sc.suite, size: sc.size, density: sc.density,
    diagonal: !!sc.diagonal, seed: sc.seed, weights: !!sc.weights,
    heuristic: sc.heuristic || 'manhattan', note: sc.note || '',
    msMedian: median(runs.map((r) => r.msMedian)),
    msP95: median(runs.map((r) => r.msP95)),
    msMin: Math.min(...runs.map((r) => r.msMin)),
    expanded: median(runs.map((r) => r.expanded)),
    touched: median(runs.map((r) => r.touched)),
    cost: median(runs.map((r) => r.cost)),
    costMin: Math.min(...runs.map((r) => r.costMin)),
    costMax: Math.max(...runs.map((r) => r.costMax)),
    optimalCost: runs[0].optimalCost,
    gap: runs[0].gap,
    length: median(runs.map((r) => r.length)),
    valid: runs.every((r) => r.valid),
    heapDeltaBytes: median(runs.map((r) => r.heapDeltaBytes)),
    optimalExpanded: runs[0].optimalExpanded,
    rounds: runs.map((r) => +r.msMedian.toFixed(3)),
    roundP95: runs.map((r) => +r.msP95.toFixed(3)),
  });
  const b = pick(bRuns), o = pick(oRuns);
  baseOut.push(b); optOut.push(o);
  process.stderr.write(`[${i + 1}/${scenarios.length}] ${sc.id}  ${b.msMedian.toFixed(2)} -> ${o.msMedian.toFixed(2)} ms  ${(b.msMedian / o.msMedian).toFixed(2)}x  rounds ${b.rounds.join('/')} vs ${o.rounds.join('/')}\n`);
}

function meta(impl) {
  const src = fs.readFileSync(impl);
  return {
    impl, sha256_16: crypto.createHash('sha256').update(src).digest('hex').slice(0, 16),
    node: process.version, platform: process.platform, arch: process.arch,
    isolation: 'paired A/B, one process per run', rounds,
    generatedAt: new Date().toISOString(),
  };
}
fs.mkdirSync(path.dirname(outBase), { recursive: true });
fs.writeFileSync(outBase, JSON.stringify({ meta: meta(baseImpl), records: baseOut }, null, 1));
fs.writeFileSync(outOpt, JSON.stringify({ meta: meta(optImpl), records: optOut }, null, 1));
console.log(`wrote ${outBase} and ${outOpt} (${rounds} rounds x 2 builds x ${scenarios.length} scenarios)`);
