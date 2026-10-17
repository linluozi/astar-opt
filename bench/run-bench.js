'use strict';
// Orchestrator: one child process per scenario, so heap/GC state from earlier
// scenarios cannot bias later measurements (baseline and optimized run through
// exactly the same path).
//
//   node bench/run-bench.js --impl=./upstream/astar.js --suites=core --out=results/base.json
const fs = require('fs');
const path = require('path');
const os = require('os');
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
const implPath = path.resolve(args.impl || path.join(__dirname, '..', 'astar.js'));
const suites = (args.suites || 'core').split(',').filter(Boolean);
const outPath = path.resolve(args.out || path.join(__dirname, 'results', 'raw.json'));
const repsOverride = args.reps ? parseInt(args.reps, 10) : null;
const only = args.only || null;
const nodeBin = process.execPath;

function runOne(sc) {
  const tmpDir = path.dirname(outPath);
  fs.mkdirSync(tmpDir, { recursive: true });
  const tmp = path.join(tmpDir, '.tmp-' + crypto.createHash('md5').update(sc.id).digest('hex').slice(0, 8) + '.json');
  const res = spawnSync(nodeBin, [
    '--expose-gc', path.join(__dirname, 'run-one.js'),
    '--impl=' + implPath, '--id=' + sc.id, '--out=' + tmp,
  ], { encoding: 'utf8' });
  if (res.status !== 0) {
    throw new Error(`child failed for ${sc.id}\n${res.stderr}\n${res.stdout}`);
  }
  const rec = JSON.parse(fs.readFileSync(tmp, 'utf8'));
  fs.unlinkSync(tmp);
  return rec;
}

const started = Date.now();
const scenarios = getScenarios(suites);
const records = [];

if (only) {
  const sc = scenarios.find((s) => s.id === only);
  if (!sc) throw new Error('no such scenario: ' + only);
  const rec = require('./run-one').runScenario(sc, implPath, repsOverride);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify({ meta: require('./run-one').meta(implPath, [sc.suite], repsOverride), records: [rec] }, null, 1));
  console.log(JSON.stringify(rec));
  process.exit(0);
}

for (let i = 0; i < scenarios.length; i++) {
  const sc = scenarios[i];
  const rec = runOne(sc);
  records.push(rec);
  const t = rec.suite === 'repeat'
    ? `mismatches=${rec.mismatches.length}`
    : `${rec.msMedian.toFixed(2)}ms exp=${rec.expanded} gap=${rec.gap === null ? 'n/a' : (rec.gap * 100).toFixed(3) + '%'}`;
  process.stderr.write(`[${i + 1}/${scenarios.length}] ${sc.id}  ${t}\n`);
}

const src = fs.readFileSync(implPath);
const meta = {
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
  startedAt: new Date(started).toISOString(),
  durationSec: +((Date.now() - started) / 1000).toFixed(1),
  suites,
  repsOverride,
  isolation: 'one process per scenario',
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify({ meta, records }, null, 1));

console.log(['id', 'median ms', 'p95 ms', 'expanded', 'cost', 'gap', 'valid'].join('\t'));
for (const r of records) {
  if (r.suite === 'repeat') {
    console.log(`${r.id}\tmismatches=${r.mismatches.length}\tvalid=${r.valid}`);
    continue;
  }
  console.log([
    r.id, r.msMedian.toFixed(2), r.msP95.toFixed(2), r.expanded,
    r.cost.toFixed(2), r.gap === null ? 'n/a' : (r.gap * 100).toFixed(4) + '%', r.valid,
  ].join('\t'));
}
console.log(`\nwrote ${outPath}  (${meta.durationSec}s, sha ${meta.sha256_16})`);
