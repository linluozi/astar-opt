'use strict';
// Independent ground truth: Dijkstra on the same move semantics as upstream.
// Cost of entering a node = node.weight (diagonal: weight * 1.41421, matching
// GridNode.getCost). 8-neighbour movement, no corner-cutting check, exactly
// like Graph.neighbors. Used only to verify optimality, never by the library.

class MinHeap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(id, d) {
    const a = this.a;
    a.push([d, id]);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p][0] <= a[i][0]) break;
      const t = a[p]; a[p] = a[i]; a[i] = t;
      i = p;
    }
  }
  pop() {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        const t = a[m]; a[m] = a[i]; a[i] = t;
        i = m;
      }
    }
    return top;
  }
}

const SQRT2 = 1.41421;

// Returns { cost, path } or { cost: Infinity, path: [] }.
function dijkstra(grid, start, end, diagonal, opts) {
  opts = opts || {};
  const w = grid.length;
  const h = grid[0].length;
  const N = w * h;
  const dist = new Float64Array(N).fill(Infinity);
  const prev = new Int32Array(N).fill(-1);
  const done = new Uint8Array(N);
  const sid = start[0] * h + start[1];
  const eid = end[0] * h + end[1];
  if (grid[start[0]][start[1]] === 0 || grid[end[0]][end[1]] === 0) {
    return { cost: Infinity, path: [], expanded: 0 };
  }
  const dirs = diagonal
    ? [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, SQRT2], [1, -1, SQRT2], [-1, 1, SQRT2], [-1, -1, SQRT2]]
    : [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1]];
  const heap = new MinHeap();
  dist[sid] = 0;
  heap.push(sid, 0);
  let expanded = 0;
  while (heap.size) {
    const [d, id] = heap.pop();
    if (done[id]) continue;
    done[id] = 1;
    expanded++;
    if (d !== dist[id]) continue;
    if (id === eid) break;
    const x = (id / h) | 0;
    const y = id % h;
    for (let k = 0; k < dirs.length; k++) {
      const nx = x + dirs[k][0];
      const ny = y + dirs[k][1];
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const wgt = grid[nx][ny];
      if (wgt === 0) continue;
      const nid = nx * h + ny;
      if (done[nid]) continue;
      const nd = d + wgt * dirs[k][2];
      if (nd < dist[nid] - 1e-12) {
        dist[nid] = nd;
        prev[nid] = id;
        heap.push(nid, nd);
      }
    }
  }
  if (!isFinite(dist[eid])) return { cost: Infinity, path: [], expanded };
  const path = [];
  let cur = eid;
  while (cur !== -1 && cur !== sid) {
    path.push([(cur / h) | 0, cur % h]);
    cur = prev[cur];
  }
  path.reverse();
  return { cost: dist[eid], path, expanded };
}

module.exports = { dijkstra };
