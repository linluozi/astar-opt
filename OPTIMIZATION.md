# Why this fork exists

`astar.js` 0.4.1 is a clean, readable implementation, but its priority queue does
an O(n) scan on every improved neighbour (`rescoreElement` → `Array.indexOf`).
On a 512×512 map with 35% walls that is thousands of scans over an open list of
~1,200 entries per search. Issue
[bgrins/javascript-astar#31](https://github.com/bgrins/javascript-astar/issues/31)
reported it in 2014 and it is still open.

This branch fixes that and removes the per-node neighbour array allocation,
while keeping the public API and the exact search results of 0.4.1.

## Results

Windows 11 / AMD64, Node 22.12.0, one process per scenario, 2 warm-up runs,
3–5 measured runs, median reported. Ground truth for every map is an
independent Dijkstra implementation.

| set | n | median speedup | aggregate | notes |
|---|---:|---:|---:|---|
| all scenarios | 104 | **1.64×** | 1.86× | sum of per-scenario medians |
| size ≥ 256 | 60 | **1.58×** | 1.88× | median p95 5.73 ms → 2.73 ms |
| 512×512 | 19 | **1.89×** | 2.16× | best case 4.40× |
| weighted (1–3) | 4 | 1.40× | 1.38× | heuristic ignores weights |

Memory, as median `heapUsed` delta per search for size ≥ 256: **1,318 KiB →
480 KiB (−64%)**. This is a heap-delta proxy, not peak RSS.

### Where the time went

V8 CPU profile of 12 searches on 512×512 / 35% walls, baseline:

```
45.5%  search            <- includes the inlined Array.indexOf scan
 7.4%  cleanNode
 6.9%  pop
11.1%  GC
```

Instrumented copy (same algorithm, counters only):

| case | expanded | rescore calls | avg open list | elements scanned by `indexOf` |
|---|---:|---:|---:|---:|
| 512², 35% walls | 67,189 | 2,902 | 1,183 | 1.76 M |
| 256², weights 1–3 | 25,634 | 3,713 | 991 | 2.22 M |
| 512², 8-dir + octile | 14,886 | 10,421 | 854 | 5.38 M |

## Changes

### S1 — O(1) heap position instead of `indexOf`

Every element caches its slot in `_heapIndex`; `push`, `pop`, `sinkDown` and
`bubbleUp` keep it in sync. `rescoreElement` and `remove` use it directly and
fall back to a scan only if the cached slot is stale.

```js
rescoreElement: function(node) {
  var i = node._heapIndex;
  if (i == null || i < 0 || this.content[i] !== node) {
    i = this.content.indexOf(node);
    if (i === -1) return;
  }
  this.sinkDown(i);
}
```

Effect at 512×512: **1.40×** median (S1 only, 18 cases).

### S2 — no allocation in the expansion loop

* Expand the 8 neighbours in place for the built-in `Graph`, in the same order
  as `Graph.neighbors()` (W, E, S, N, SW, SE, NW, NE). Custom graphs such as
  the `CityGraph` in the test suite still go through `graph.neighbors()`.
* Compare `.f` directly in the heap instead of calling a score closure.
* `pathTo()` uses `push` + `reverse` instead of `unshift` (O(L²) → O(L)).
* `cleanDirty()` only clears `visited`/`closed` and reuses the backing array;
  `h` is computed once on first visit.
* The start node's `parent` is cut explicitly because `cleanDirty()` no longer
  clears every field.

Combined S1+S2 at 512×512: **1.90×** median, **2.19×** aggregate.

### Correctness

* Upstream QUnit assertions: **10/10 pass** (`node test/node-tests.js`).
* Differential test against a frozen 0.4.1 copy: **96 checks**, identical path
  length, cost (1e-9) and expansion count (`node test/equivalence.js`).
* Benchmark matrix: **104 scenarios, 0 mismatches** in cost / expansions /
  validity, including unreachable targets, 1×64 corridors, weighted nodes,
  8-direction movement, the repo's own 100/250/500 maps, and repeated searches
  on one graph.
* `Graph.neighbors()` still returns the same nodes in the same order.

## Rejected, with measurements

| idea | result | why not shipped |
|---|---|---|
| tie-break equal `f` by larger `g` | 512² open: 35,062 → 918 expansions (7.1 → 1.3 ms) but 512²/35% walls: 19 → 22 ms | wins on open maps, loses on dense ones; changes expansion order |
| parallel `Float64Array` of heap scores | no measurable gain (18.8–19.7 ms vs 17.8–19.2 ms) | extra state, no payoff |
| reset every field in `cleanDirty()` | 43 ms of 453 ms profile | dead stores; two flags are enough |
| bidirectional A* / JPS | not implemented | bidirectional needs a second set of node states and a correct stopping rule; JPS assumes uniform cost and would break weights |

## Reproduce

```bash
node test/node-tests.js
node test/equivalence.js

# baseline (frozen copy) then optimized, one process per scenario
node --expose-gc bench/run-bench.js --impl=bench/baseline/astar-0.4.1.js \
  --suites=core --out=results/baseline-core.json
node --expose-gc bench/run-bench.js --impl=./astar.js \
  --suites=core --out=results/optimized-core.json
node bench/compare.js --base=results/baseline-core.json --cand=results/optimized-core.json
```

The 2015 Grunt/QUnit toolchain does not run on modern Node (PhantomJS), so the
assertions are executed by `test/node-tests.js`, a 40-line shim that defines the
`test`/`ok`/`equal` globals the original file already uses.

## Caveats

* JavaScript, single thread, one machine; absolute milliseconds are not
  portable, ratios should be.
* Sub-millisecond scenarios are timer-noise dominated (p10 of the 64×64 class
  is 1.17×; individual cases can be <1×).
* `heapUsed` delta is a proxy for allocation pressure, not peak memory.
* The default manhattan heuristic is inadmissible with 8-direction movement.
  That is upstream behaviour (documented in the README sample), not changed
  here: 2.5–6.7% suboptimal paths in the benchmark. Pass
  `heuristic: astar.heuristics.diagonal`.
