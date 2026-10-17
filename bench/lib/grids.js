'use strict';
// Deterministic grid generation + loaders for the grids shipped with the repo.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// grid[x][y] === 0 is a wall (matches upstream's row-major convention).
// opts.nested: draw one uniform per cell and compare it with `density`, so
// density sweeps are nested (d=0.1 walls are a subset of d=0.2 walls).
function makeGrid(size, density, seed, opts) {
  opts = opts || {};
  const rnd = mulberry32(seed >>> 0);
  const grid = new Array(size);
  for (let x = 0; x < size; x++) {
    const col = new Array(size);
    for (let y = 0; y < size; y++) {
      const u = rnd();
      let v = 1;
      if (u < density) v = 0;
      else if (opts.weights) {
        const r = rnd();
        if (r < 0.18) v = 2;
        else if (r < 0.28) v = 3;
      }
      col[y] = v;
    }
    grid[x] = col;
  }
  return grid;
}

function carve(grid, cx, cy, radius) {
  const size = grid.length;
  for (let x = Math.max(0, cx - radius); x <= Math.min(size - 1, cx + radius); x++) {
    for (let y = Math.max(0, cy - radius); y <= Math.min(size - 1, cy + radius); y++) {
      if (grid[x][y] === 0) grid[x][y] = 1;
    }
  }
}

function pickEndpoints(size, distance) {
  const f = { near: [0.12, 0.3], mid: [0.12, 0.62], far: [0.05, 0.95] }[distance] || [0.05, 0.95];
  const s = Math.round(f[0] * (size - 1));
  const e = Math.round(f[1] * (size - 1));
  return { start: [s, s], end: [e, e] };
}

// Optional BFS reachability (4-neighbour) used to resample unreachable random maps.
function reachable(grid, start, end, diagonal) {
  if (grid[start[0]][start[1]] === 0 || grid[end[0]][end[1]] === 0) return false;
  const n = grid.length;
  const seen = new Uint8Array(n * n);
  const q = [start[0] * n + start[1]];
  seen[q[0]] = 1;
  const dirs = diagonal
    ? [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]
    : [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (let head = 0; head < q.length; head++) {
    const id = q[head];
    const x = (id / n) | 0;
    const y = id % n;
    if (x === end[0] && y === end[1]) return true;
    for (let k = 0; k < dirs.length; k++) {
      const nx = x + dirs[k][0];
      const ny = y + dirs[k][1];
      if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
      if (grid[nx][ny] === 0) continue;
      const nid = nx * n + ny;
      if (!seen[nid]) { seen[nid] = 1; q.push(nid); }
    }
  }
  return false;
}

// Build a scenario map, resampling deterministically until start->end is connected
// (unless the scenario explicitly wants an unreachable target).
function buildMap(spec) {
  const size = spec.size;
  const diagonal = !!spec.diagonal;
  const { start, end } = spec.start && spec.end
    ? { start: spec.start, end: spec.end }
    : pickEndpoints(size, spec.distance || 'far');
  let seed = spec.seed >>> 0;
  let grid = null;
  const attempts = spec.unreachable ? 1 : 40;
  for (let attempt = 0; attempt < attempts; attempt++) {
    grid = makeGrid(size, spec.density || 0, seed + attempt, { weights: !!spec.weights, nested: !!spec.nested });
    carve(grid, start[0], start[1], 1);
    carve(grid, end[0], end[1], 1);
    if (spec.unreachable) break;
    if (spec.resample === false) break;
    if (reachable(grid, start, end, diagonal)) break;
    grid = null;
  }
  if (!grid) throw new Error('could not build connected map for ' + JSON.stringify(spec));
  if (spec.unreachable) {
    // Full vertical wall at x = floor(size/2), leaving no gap.
    const wx = Math.floor(size / 2);
    for (let y = 0; y < size; y++) grid[wx][y] = 0;
  }
  return { grid, start, end, seedUsed: seed, diagonal };
}

// The repo ships four hand-built maps (100/150/250/500). They are plain
// `var grid = [...]` files, so evaluate them in an isolated context.
function loadRepoGrid(name) {
  const p = path.join(__dirname, '..', '..', 'benchmark', name);
  const src = fs.readFileSync(p, 'utf8');
  const ctx = { grid: null };
  vm.createContext(ctx);
  vm.runInContext(src, ctx, { filename: p });
  return ctx.grid;
}

// Find a seed whose nested field stays connected at the densest setting.
function nestedSeed(size, maxDensity, seed0, diagonal) {
  const { start, end } = pickEndpoints(size, 'far');
  for (let k = 0; k < 80; k++) {
    const g = makeGrid(size, maxDensity, seed0 + k, { nested: true });
    carve(g, start[0], start[1], 1);
    carve(g, end[0], end[1], 1);
    if (reachable(g, start, end, diagonal)) return seed0 + k;
  }
  throw new Error('no connected nested seed for size ' + size);
}

module.exports = { mulberry32, makeGrid, buildMap, loadRepoGrid, reachable, pickEndpoints, nestedSeed };
