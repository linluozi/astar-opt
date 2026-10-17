'use strict';
// Compare two (or more) result sets by scenario id and verify that the
// optimized build returns exactly the same cost / expansion count.
const fs = require('fs');
const path = require('path');

function load(files) {
  const map = new Map();
  for (const f of files) {
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    for (const r of j.records) map.set(r.id, r);
  }
  return map;
}
function median(a) {
  const s = a.slice().sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function fmt(x, d = 2) { return Number.isFinite(x) ? x.toFixed(d) : '—'; }

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = /^--([^=]+)=(.*)$/.exec(a);
  return m ? [m[1], m[2]] : [a, true];
}));
const base = load((args.base || 'results/base-core.json,results/base-rest.json').split(','));
const cand = load((args.cand || 'results/s2-core.json,results/s2-rest.json').split(','));

const rows = [];
for (const [id, b] of base) {
  const c = cand.get(id);
  if (!c) { console.error('missing in candidate: ' + id); continue; }
  if (b.suite === 'repeat') {
    rows.push({ id, suite: 'repeat', same: c.valid && b.valid, speedup: NaN });
    continue;
  }
  const sameCost = Math.abs(b.cost - c.cost) <= 1e-9 * Math.max(1, Math.abs(b.cost));
  const sameExpanded = b.expanded === c.expanded;
  rows.push({
    id, suite: b.suite, size: b.size, density: b.density, diagonal: b.diagonal,
    baseMs: b.msMedian, candMs: c.msMedian, speedup: b.msMedian / c.msMedian,
    baseExpanded: b.expanded, candExpanded: c.expanded,
    cost: b.cost, sameCost, sameExpanded, valid: c.valid,
    baseP95: b.msP95, candP95: c.msP95,
  });
}

const bad = rows.filter((r) => r.suite !== 'repeat' && (!r.sameCost || !r.sameExpanded || !r.valid));
console.log(`scenarios: ${rows.length}  mismatches: ${bad.length}`);
for (const r of bad) console.log('  MISMATCH ' + r.id + ' cost ' + r.cost + ' exp ' + r.baseExpanded + '->' + r.candExpanded);

const timed = rows.filter((r) => Number.isFinite(r.speedup));
const bySuite = new Map();
for (const r of timed) {
  if (!bySuite.has(r.suite)) bySuite.set(r.suite, []);
  bySuite.get(r.suite).push(r.speedup);
}
console.log('\nspeedup by suite (median / min / max):');
for (const [s, v] of bySuite) console.log(`  ${s.padEnd(9)} n=${String(v.length).padStart(3)}  ${median(v).toFixed(2)}x  ${Math.min(...v).toFixed(2)}x  ${Math.max(...v).toFixed(2)}x`);
console.log(`  overall   n=${timed.length}  ${median(timed.map((r) => r.speedup)).toFixed(2)}x`);

const show = args.show ? args.show.split(',') : null;
console.log('\n' + ['id', 'base ms', 'new ms', 'speedup', 'expanded', 'cost', 'same'].join('\t'));
for (const r of rows) {
  if (r.suite === 'repeat') { console.log(`${r.id}\tsame=${r.same}`); continue; }
  if (show && !show.some((s) => r.id.includes(s))) continue;
  console.log([r.id.padEnd(38), fmt(r.baseMs), fmt(r.candMs), r.speedup.toFixed(2) + 'x', r.baseExpanded + '/' + r.candExpanded, fmt(r.cost, 2), r.sameCost && r.sameExpanded].join('\t'));
}
