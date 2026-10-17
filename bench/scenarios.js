'use strict';
// Scenario matrix. Every entry is deterministic given (size, density, seed).
const { buildMap, loadRepoGrid, nestedSeed } = require('./lib/grids');

const SEEDS = [1, 2, 3];

function core() {
  const out = [];
  for (const size of [64, 128, 256, 512]) {
    for (const density of [0, 0.2, 0.35]) {
      for (const diagonal of [false, true]) {
        const spec = { size, density, diagonal, distance: 'far' };
        for (const seed of SEEDS) {
          out.push({
            id: `core|${size}|d${density}|${diagonal ? 'diag8' : 'orth4'}|s${seed}`,
            suite: 'core',
            size, density, diagonal, seed, distance: 'far',
            // core uses the library default (manhattan) on purpose, including
            // for diagonal movement, to capture the out-of-the-box behaviour.
            heuristic: 'manhattan',
            note: diagonal ? '8-dir movement + default manhattan heuristic' : '',
            reps: size >= 512 ? 3 : 5,
            map: buildMap({ ...spec, seed }),
          });
        }
      }
    }
  }
  return out;
}

function densitySweep() {
  const out = [];
  for (const seed0 of [11, 12]) {
    const seed = nestedSeed(256, 0.4, seed0, false);
    for (const density of [0, 0.1, 0.2, 0.3, 0.4]) {
      out.push({
        id: `density|256|d${density}|g${seed0}`,
        suite: 'density',
        size: 256, density, diagonal: false, seed, distance: 'far', reps: 5,
        map: buildMap({ size: 256, density, seed, distance: 'far', diagonal: false, nested: true, resample: false }),
      });
    }
  }
  return out;
}

function distanceSweep() {
  const out = [];
  for (const distance of ['near', 'mid', 'far']) {
    for (const seed of [21, 22]) {
      out.push({
        id: `distance|256|${distance}|s${seed}`,
        suite: 'distance',
        size: 256, density: 0.2, diagonal: false, seed, distance, reps: 5,
        map: buildMap({ size: 256, density: 0.2, distance, seed, diagonal: false }),
      });
    }
  }
  return out;
}

function diagonalSuite() {
  const out = [];
  for (const seed of [31, 32]) {
    out.push({
      id: `diagonal|256|octile|s${seed}`,
      suite: 'diagonal',
      size: 256, density: 0.2, diagonal: true, seed, distance: 'far', reps: 5,
      heuristic: 'diagonal',
      map: buildMap({ size: 256, density: 0.2, diagonal: true, distance: 'far', seed }),
    });
  }
  return out;
}

function weightsSuite() {
  const out = [];
  for (const weights of [false, true]) {
    for (const seed of [41, 42]) {
      out.push({
        id: `weights|256|${weights ? 'w1-3' : 'w1'}|s${seed}`,
        suite: 'weights',
        size: 256, density: 0.2, diagonal: false, seed, weights, distance: 'far', reps: 5,
        map: buildMap({ size: 256, density: 0.2, weights, distance: 'far', seed, diagonal: false }),
      });
    }
  }
  return out;
}

function special() {
  const out = [];
  const add = (id, grid, start, end, extra) => out.push({
    id, suite: 'special', size: grid.length, diagonal: false, seed: 0, density: null,
    reps: 5, map: { grid, start, end }, ...extra,
  });
  add('special|1x1|start=end', [[1]], [0, 0], [0, 0]);
  add('special|1x64|corridor', [Array(64).fill(1)], [0, 0], [0, 63]);
  add('special|64x64|walled-target', buildMap({ size: 64, density: 0.2, seed: 51, distance: 'far' }).grid, [3, 3], [60, 60], {});
  // target sealed in a 3x3 ring of walls
  {
    const grid = buildMap({ size: 64, density: 0.2, seed: 52, distance: 'far' }).grid;
    const [ex, ey] = [60, 60];
    grid[ex][ey] = 1;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      if (dx || dy) grid[ex + dx][ey + dy] = 0;
    }
    add('special|64x64|sealed-target', grid, [3, 3], [ex, ey]);
  }
  {
    // upstream never checks start.isWall(); reference Dijkstra refuses it.
    const grid = buildMap({ size: 64, density: 0.2, seed: 53, distance: 'far' }).grid;
    grid[5][5] = 0;
    add('special|64x64|start-on-wall', grid, [5, 5], [60, 60], { skipOptimality: true });
  }
  {
    const m = buildMap({ size: 128, density: 0.2, seed: 54, distance: 'far', unreachable: true });
    add('special|128x128|full-wall', m.grid, m.start, m.end);
  }
  // fully open 512x512: worst case for A* with an admissible heuristic
  {
    const n = 512;
    const grid = Array.from({ length: n }, () => Array(n).fill(1));
    add('special|512x512|open', grid, [0, 0], [511, 511]);
  }
  // repo's own hand-built maps, start/end as in benchmark/benchmark.js
  for (const name of ['grid_100x100.js', 'grid_250x250.js', 'grid_500x500.js']) {
    const grid = loadRepoGrid(name);
    const n = grid.length;
    add(`special|repo-${n}|(0,0)->(140,140)`,
      grid, [0, 0], [Math.min(140, n - 1), Math.min(140, n - 1)], { reps: 3 });
  }
  return out;
}

function repeatSearch() {
  // Same graph, several endpoint pairs, no fresh Graph in between.
  const m = buildMap({ size: 128, density: 0.2, seed: 61, distance: 'far' });
  return [{
    id: 'repeat|128|6-pairs', suite: 'repeat', size: 128, density: 0.2, diagonal: false,
    seed: 61, reps: 1, map: m, repeat: true,
  }];
}

const SUITES = { core, density: densitySweep, distance: distanceSweep, diagonal: diagonalSuite, weights: weightsSuite, special, repeat: repeatSearch };

function getScenarios(names) {
  const list = names && names.length ? names : Object.keys(SUITES);
  const out = [];
  for (const n of list) {
    if (!SUITES[n]) throw new Error('unknown suite: ' + n);
    out.push(...SUITES[n]());
  }
  return out;
}

module.exports = { getScenarios, SUITES };
