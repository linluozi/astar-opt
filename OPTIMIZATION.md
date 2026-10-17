# Why this fork exists

`astar.js` 0.4.1 is clean and readable, but its priority queue does an O(n) scan
on every improved neighbour (`rescoreElement` → `Array.indexOf`). On a 512×512
map with 35% walls that is 2,902 rescans over an average open list of 1,183
entries — 1.76 M array elements touched per search. Issue
[bgrins/javascript-astar#31](https://github.com/bgrins/javascript-astar/issues/31)
reported it in 2014 and it is still open.

This branch fixes that and removes the per-node neighbour array allocation,
while keeping the public API and the exact search results of 0.4.1.

## Results

Windows 11 / AMD64, Node 22.12.0. **Paired A/B benchmark:** for each scenario,
baseline and optimized run alternately in separate processes, 11 searches per
process, 3 rounds; the reported value is the median of the three round medians.
Ground truth for every map is an independent Dijkstra implementation.

| set | n | median speedup | aggregate | notes |
|---|---:|---:|---:|---|
| all scenarios | 104 | **1.22×** | **1.36×** | sum of per-scenario medians |
| size ≥ 256 | 60 | 1.23× | 1.36× | median p95 5.29 → 4.27 ms |
| 512×512 | 19 | 1.08× | 1.43× | medians dragged down by 1–3 ms diagonal cases |
| 512×512, 4-dir, open | 3 | **1.70×** | — | 21.2 → 12.7 ms |
| 512×512, 4-dir, 20% walls | 3 | 1.42× | — | |
| 512×512, 4-dir, 35% walls | 3 | 1.06× | — | 67k expansions, heap scan is no longer the bottleneck |

The speedup tracks **how often decrease-key happens**, not map area alone:
an open 512² map spends far more time rescanning the open list than a dense one
with the same number of nodes.

Memory, median `heapUsed` delta per search for size ≥ 256: **1,315 KiB →
417 KiB (−68%)**. This is an allocation-pressure proxy, not peak RSS.

### Where the time went

V8 CPU profile of 12 searches on 512²/35% walls, baseline:

```
45.5%  search            <- includes the inlined Array.indexOf scan
 7.4%  cleanNode
 6.9%  heap.pop
11.1%  GC
```

Instrumented copy (same algorithm, counters only):

| case | expanded | rescore calls | avg open list | elements scanned by `indexOf` |
|---|---:|---:|---:|---:|
| 512², 35% walls | 67,189 | 2,902 | 1,183 | 1.76 M |
| 256², weights 1–3 | 25,634 | 3,713 | 991 | 2.22 M |
| 512², 8-dir + octile | 14,886 | 10,421 | 854 | 5.38 M |

An 8-direction search with the correct octile heuristic expands *fewer* nodes but
rescans *more* often — "fewer expansions" is not the same as "less heap work".

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

Effect on the 18 core 512×512 scenarios: total time 229.3 → 205.0 ms
(**1.12× aggregate**, 1.06× median). The median is low because half of that
group is 1–3 ms diagonal cases dominated by fixed overhead.

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

Combined S1+S2 on the same 18 scenarios: 229.3 → 152.7 ms (**1.31× aggregate**).

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
| tie-break equal `f` by larger `g` | quick probe: 512² open 35,062 → 918 expansions (7.1 → 1.3 ms), but 512²/35% walls 19 → 22 ms | wins on open maps, loses on dense ones; changes expansion order |
| parallel `Float64Array` of heap scores | no measurable gain (18.8–19.7 ms vs 17.8–19.2 ms) | extra state, no payoff |
| reset every field in `cleanDirty()` | 43 ms of 453 ms profile | dead stores; two flags are enough |
| bidirectional A* / JPS | not implemented | bidirectional needs a second set of node states and a correct stopping rule; JPS assumes uniform cost and would break weights |

## Reproduce

```bash
cd work
node test/node-tests.js
node test/equivalence.js

# baseline vs optimized, A/B alternated, 11 searches/round, 3 rounds
node --expose-gc bench/paired.js --reps=11 --rounds=3 \
  --base=bench/baseline/astar-0.4.1.js --opt=./astar.js \
  --suites=core,density,distance,diagonal,weights,special,repeat \
  --outBase=results/final-base.json --outOpt=results/final-opt.json

node bench/compare.js --base=results/final-base.json --cand=results/final-opt.json
node bench/analyze.js --base=results/final-base.json --opt=results/final-opt.json
```

The 2015 Grunt/QUnit toolchain does not run on modern Node (PhantomJS), so the
assertions are executed by `test/node-tests.js`, a 40-line shim that defines the
`test`/`ok`/`equal` globals the original file already uses.

## Caveats

* JavaScript, single thread, one machine; absolute milliseconds are not
  portable, ratios should be.
* This machine shows large run-to-run drift (23–58 ms on the same 512² search),
  which is why the benchmark uses paired A/B runs instead of one-shot timings.
  Even so, sub-5 ms scenarios are dominated by timer noise: the 64² group's p10
  is 1.00× and 18 of 104 scenarios land at or slightly above 1×.
* `heapUsed` delta is a proxy for allocation pressure, not peak memory.
* The default manhattan heuristic is inadmissible with 8-direction movement.
  That is upstream behaviour (documented in the README sample), not changed
  here: 2.5–6.7% suboptimal paths in the benchmark. Pass
  `heuristic: astar.heuristics.diagonal`.
