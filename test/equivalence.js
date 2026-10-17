'use strict';
// Differential test: the optimized build must return the same path cost,
// path length and expansion count as the frozen 0.4.1 baseline.
//
//   node test/equivalence.js
const path = require('path');
const assert = require('assert');
const current = require(path.join(__dirname, '..', 'astar.js'));
const baseline = require(path.join(__dirname, '..', 'bench', 'baseline', 'astar-0.4.1.js'));
const { buildMap, loadRepoGrid } = require(path.join(__dirname, '..', 'bench', 'lib', 'grids'));

function run(mod, grid, start, end, opts) {
  opts = opts || {};
  const graph = new mod.Graph(grid, { diagonal: !!opts.diagonal });
  const s = graph.grid[start[0]][start[1]];
  const e = graph.grid[end[0]][end[1]];
  const searchOptions = {};
  if (opts.heuristic) searchOptions.heuristic = mod.astar.heuristics[opts.heuristic];
  const p = mod.astar.search(graph, s, e, searchOptions);
  let cost = 0;
  let prev = s;
  for (const n of p) { cost += n.getCost(prev); prev = n; }
  let expanded = 0;
  for (const n of graph.nodes) if (n.closed) expanded++;
  let valid = true;
  prev = s;
  for (const n of p) {
    const dx = Math.abs(n.x - prev.x);
    const dy = Math.abs(n.y - prev.y);
    if (dx > 1 || dy > 1 || (dx === 0 && dy === 0) || n.weight === 0) valid = false;
    prev = n;
  }
  if (p.length && prev !== e) valid = false;
  return { p, cost, len: p.length, expanded, valid };
}

let cases = 0;
function sameCase(label, grid, start, end, opts) {
  const a = run(baseline, grid, start, end, opts);
  const b = run(current, grid, start, end, opts);
  assert.ok(b.valid, label + ': optimized path is invalid');
  assert.strictEqual(b.len, a.len, label + ': path length differs');
  assert.ok(Math.abs(b.cost - a.cost) <= 1e-9 * Math.max(1, Math.abs(a.cost)),
    label + ': cost differs (' + a.cost + ' vs ' + b.cost + ')');
  assert.strictEqual(b.expanded, a.expanded, label + ': expansion count differs');
  cases++;
}

// 1. Deterministic matrix: size x density x movement x weights x distance.
for (const size of [32, 64, 128]) {
  for (const density of [0, 0.15, 0.35]) {
    for (const diagonal of [false, true]) {
      for (const weights of [false, true]) {
        for (const distance of ['near', 'far']) {
          const m = buildMap({ size, density, diagonal, weights, distance, seed: size + Math.round(density * 100) });
          const opts = { diagonal, heuristic: diagonal ? 'diagonal' : null };
          sameCase(`matrix|${size}|d${density}|${diagonal ? '8' : '4'}|w${weights ? 1 : 0}|${distance}`,
            m.grid, m.start, m.end, opts);
        }
      }
    }
  }
}

// 2. Out-of-the-box behaviour: 8-dir movement with the default manhattan heuristic.
for (const seed of [1, 2, 3]) {
  const m = buildMap({ size: 96, density: 0.25, diagonal: true, distance: 'far', seed });
  sameCase('default-heuristic|8dir|' + seed, m.grid, m.start, m.end, { diagonal: true });
}

// 3. Edge cases.
{
  const m = buildMap({ size: 96, density: 0.2, distance: 'far', seed: 51 });
  sameCase('edge|start=end', [[1]], [0, 0], [0, 0], {});
  sameCase('edge|corridor', [Array(80).fill(1)], [0, 0], [0, 79], {});
  sameCase('edge|unreachable', m.grid, [0, 0], [m.grid.length - 1, m.grid[0].length - 1], {});
  const sealed = m.grid.map((col) => col.slice());
  const ex = 70, ey = 70;
  sealed[ex][ey] = 1;
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) if (dx || dy) sealed[ex + dx][ey + dy] = 0;
  sameCase('edge|sealed-target', sealed, [3, 3], [ex, ey], {});
}

// 4. The maps shipped with the repository.
for (const name of ['grid_100x100.js', 'grid_250x250.js', 'grid_500x500.js']) {
  const grid = loadRepoGrid(name);
  const n = grid.length - 1;
  sameCase('repo|' + name, grid, [0, 0], [Math.min(140, n), Math.min(140, n)], {});
}

// 5. Repeated searches on one graph must match fresh graphs.
{
  const m = buildMap({ size: 128, density: 0.2, distance: 'far', seed: 61 });
  const pairs = [[m.start, m.end], [m.end, m.start], [[3, 120], [120, 3]], [[64, 3], [64, 120]], [m.start, m.end]];
  const reused = new current.Graph(m.grid, { diagonal: false });
  for (const [s, e] of pairs) {
    const sn = reused.grid[s[0]][s[1]];
    const en = reused.grid[e[0]][e[1]];
    const p = current.astar.search(reused, sn, en);
    let cost = 0, prev = sn;
    for (const n of p) { cost += n.getCost(prev); prev = n; }
    const fresh = run(current, m.grid, s, e, {});
    assert.strictEqual(p.length, fresh.len, 'repeat: length differs');
    assert.ok(Math.abs(cost - fresh.cost) <= 1e-9, 'repeat: cost differs');
    cases++;
  }
}

// 6. Graph.neighbors() must keep returning the same nodes in the same order.
{
  const m = buildMap({ size: 24, density: 0.2, distance: 'far', seed: 7 });
  const ga = new baseline.Graph(m.grid, { diagonal: true });
  const gb = new current.Graph(m.grid, { diagonal: true });
  for (const x of [0, 5, 23]) for (const y of [0, 9, 23]) {
    const a = ga.neighbors(ga.grid[x][y]).map((n) => n.x + ',' + n.y + ',' + n.weight);
    const b = gb.neighbors(gb.grid[x][y]).map((n) => n.x + ',' + n.y + ',' + n.weight);
    assert.deepStrictEqual(b, a, 'neighbors differ at ' + x + ',' + y);
    cases++;
  }
}

console.log(`PASS  ${cases} differential checks (optimized vs 0.4.1 baseline)`);
