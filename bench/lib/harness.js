'use strict';
// Shared measurement harness. Identical code path for baseline and optimized
// implementations: same grids, same seeds, same warmup, same repeat count.
const { performance } = require('perf_hooks');

function median(a) {
  const s = a.slice().sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function p95(a) {
  const s = a.slice().sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)];
}
function mean(a) { return a.reduce((x, y) => x + y, 0) / a.length; }

function pathCost(path, startNode) {
  let cost = 0;
  let prev = startNode;
  for (let i = 0; i < path.length; i++) {
    cost += path[i].getCost(prev);
    prev = path[i];
  }
  return cost;
}

function validatePath(path, startNode, endNode, grid, allowEmpty) {
  if (!path.length) return allowEmpty || endNode === startNode;
  let prev = startNode;
  for (const node of path) {
    if (node === prev) return false;
    if (node.weight === 0) return false;
    const dx = Math.abs(node.x - prev.x);
    const dy = Math.abs(node.y - prev.y);
    if (dx > 1 || dy > 1 || (dx === 0 && dy === 0)) return false;
    if (grid[node.x][node.y] !== node.weight) return false;
    prev = node;
  }
  return prev === endNode;
}

// opts: { astar, Graph, grid, start, end, diagonal, heuristic, closest, reps, warmup, label }
function runCase(opts) {
  const { astar, Graph, grid, start, end, diagonal } = opts;
  const reps = opts.reps || 5;
  const warmup = opts.warmup == null ? 2 : opts.warmup;
  const graph = new Graph(grid, { diagonal });
  const s = graph.grid[start[0]][start[1]];
  const e = graph.grid[end[0]][end[1]];
  const searchOptions = {};
  if (opts.heuristic) searchOptions.heuristic = opts.heuristic;
  if (opts.closest) searchOptions.closest = true;

  const times = [];
  const costs = [];
  const lengths = [];
  const closed = [];
  const visited = [];
  const heapDeltas = [];
  let ok = true;
  let lastPath = null;

  const measure = () => {
    const gc = global.gc;
    if (gc) gc();
    const before = process.memoryUsage().heapUsed;
    const t0 = performance.now();
    const path = astar.search(graph, s, e, searchOptions);
    const t1 = performance.now();
    const after = process.memoryUsage().heapUsed;
    let c = 0, v = 0;
    const nodes = graph.nodes;
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i].closed) c++;
      if (nodes[i].visited) v++;
    }
    return { ms: t1 - t0, path, c, v, heapDelta: after - before };
  };

  for (let i = 0; i < warmup; i++) measure();

  for (let i = 0; i < reps; i++) {
    const r = measure();
    lastPath = r.path;
    times.push(r.ms);
    const cost = pathCost(r.path, s);
    costs.push(cost);
    lengths.push(r.path.length);
    closed.push(r.c);
    visited.push(r.v);
    heapDeltas.push(r.heapDelta);
    if (!validatePath(r.path, s, e, grid, !!opts.allowEmpty)) ok = false;
    if (Math.abs(cost - costs[0]) > 1e-6) ok = false; // same input must give same cost
  }

  return {
    label: opts.label,
    ms: { median: median(times), p95: p95(times), mean: mean(times), min: Math.min(...times) },
    cost: median(costs),
    costMin: Math.min(...costs),
    costMax: Math.max(...costs),
    length: median(lengths),
    expanded: median(closed),
    touched: median(visited),
    heapDeltaBytes: median(heapDeltas),
    path: lastPath,
    valid: ok,
    reps,
    warmup,
  };
}

module.exports = { runCase, median, p95, mean, pathCost, validatePath };
