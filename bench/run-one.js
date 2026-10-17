'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { getScenarios } = require('./scenarios');
const { runCase } = require('./lib/harness');
const { dijkstra } = require('./lib/dijkstra');

function parseArgs(argv) {
  const out = {};
  for (const a of argv.slice(2)) {
    const m = /^--([^=]+)=(.*)$/.exec(a);
    if (m) out[m[1]] = m[2];
    else if (a.startsWith('--')) out[a.slice(2)] = true;
  }
  return out;
}

function sumCost(p, startNode) {
  let c = 0, prev = startNode;
  for (const n of p) { c += n.getCost(prev); prev = n; }
  return c;
}

function runRepeat(sc, mod) {
  const { grid, start, end, diagonal } = sc.map;
  const pairs = [
    [start, end],
    [end, start],
    [[3, 120], [120, 3]],
    [[64, 3], [64, 120]],
    [start, end],
    [[120, 3], [3, 120]],
  ];
  const g = new mod.Graph(grid, { diagonal });
  const reused = pairs.map(([s, e]) => {
    const sn = g.grid[s[0]][s[1]];
    const en = g.grid[e[0]][e[1]];
    const t0 = process.hrtime.bigint();
    const p = mod.astar.search(g, sn, en);
    const t1 = process.hrtime.bigint();
    return { s, e, len: p.length, cost: sumCost(p, sn), ms: Number(t1 - t0) / 1e6 };
  });
  const fresh = pairs.map(([s, e]) => {
    const g2 = new mod.Graph(grid, { diagonal });
    const sn = g2.grid[s[0]][s[1]];
    const en = g2.grid[e[0]][e[1]];
    const p = mod.astar.search(g2, sn, en);
    return { s, e, len: p.length, cost: sumCost(p, sn) };
  });
  const mismatches = reused.map((r, i) =>
    (r.len !== fresh[i].len || Math.abs(r.cost - fresh[i].cost) > 1e-6) ? i : -1).filter((i) => i >= 0);
  return { id: sc.id, suite: 'repeat', size: sc.size, reused, fresh, mismatches, valid: mismatches.length === 0 };
}

function runScenario(sc, implPath, repsOverride) {
  const mod = require(implPath);
  if (!mod.astar || !mod.Graph) throw new Error('module does not export astar/Graph: ' + implPath);
  const heuristicFor = (name) => (name === 'diagonal' ? mod.astar.heuristics.diagonal : mod.astar.heuristics.manhattan);
  if (sc.repeat) return runRepeat(sc, mod);

  const { grid, start, end } = sc.map;
  const ref = dijkstra(grid, start, end, !!sc.diagonal);
  const reachable = isFinite(ref.cost);
  const rec = runCase({
    astar: mod.astar, Graph: mod.Graph, grid, start, end,
    diagonal: !!sc.diagonal,
    heuristic: heuristicFor(sc.heuristic),
    closest: sc.closest,
    allowEmpty: !reachable,
    reps: repsOverride || sc.reps || 5,
    warmup: 2,
    label: sc.id,
  });
  const gap = sc.skipOptimality ? null
    : (!isFinite(ref.cost) ? (isFinite(rec.cost) ? Infinity : 0)
      : (ref.cost === 0 ? (rec.cost === 0 ? 0 : Infinity) : (rec.cost - ref.cost) / ref.cost));
  return {
    id: sc.id, suite: sc.suite, size: sc.size, density: sc.density,
    diagonal: !!sc.diagonal, seed: sc.seed, weights: !!sc.weights,
    heuristic: sc.heuristic || 'manhattan', note: sc.note || '',
    msMedian: rec.ms.median, msP95: rec.ms.p95, msMin: rec.ms.min,
    expanded: rec.expanded, touched: rec.touched,
    cost: rec.cost, costMin: rec.costMin, costMax: rec.costMax,
    optimalCost: ref.cost, gap, length: rec.length,
    valid: rec.valid, heapDeltaBytes: rec.heapDeltaBytes,
    optimalExpanded: ref.expanded,
  };
}

function meta(implPath, suites, repsOverride) {
  const src = fs.readFileSync(implPath);
  return {
    impl: implPath,
    sha256_16: crypto.createHash('sha256').update(src).digest('hex').slice(0, 16),
    implBytes: src.length,
    node: process.version,
    v8: process.versions.v8,
    platform: process.platform,
    arch: process.arch,
    cpus: os.cpus()[0] ? os.cpus()[0].model : 'unknown',
    cpuCount: os.cpus().length,
    totalMemGB: +(os.totalmem() / 1e9).toFixed(1),
    startedAt: new Date().toISOString(),
    suites, repsOverride,
  };
}

if (require.main === module) {
  const args = parseArgs(process.argv);
  const implPath = path.resolve(args.impl);
  const scenarios = getScenarios((args.suites || 'core,density,distance,diagonal,weights,special,repeat').split(','));
  const sc = scenarios.find((s) => s.id === args.id);
  if (!sc) throw new Error('no such scenario: ' + args.id);
  const rec = runScenario(sc, implPath, args.reps ? parseInt(args.reps, 10) : null);
  fs.writeFileSync(args.out, JSON.stringify(rec, null, 1));
}

module.exports = { runScenario, meta };
