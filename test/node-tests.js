'use strict';
// Runs the upstream QUnit assertions without the 2015 Grunt/PhantomJS stack.
// The tests file only uses test/ok/equal, so a 40-line shim is enough and the
// assertions themselves are untouched.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const implPath = path.resolve(process.argv[2] || path.join(root, 'astar.js'));
const mod = require(implPath);

let passed = 0, failed = 0;
const failures = [];
const tests = [];

const ctx = {
  Graph: mod.Graph,
  astar: mod.astar,
  console,
  Date,
  Math,
  test(name, fn) { tests.push({ name, fn }); },
  ok(v, msg) { if (!v) throw new Error('ok failed: ' + msg); },
  equal(a, b, msg) {
    if (a != b) throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
  },
  module: {},
  window: {},
};
vm.createContext(ctx);
const testFile = process.argv[3] || path.join(root, 'test', 'tests.js');
vm.runInContext(fs.readFileSync(testFile, 'utf8'), ctx, { filename: testFile });

for (const t of tests) {
  try {
    t.fn();
    passed++;
    console.log('PASS  ' + t.name);
  } catch (e) {
    failed++;
    failures.push({ name: t.name, error: e.message });
    console.log('FAIL  ' + t.name + '  -> ' + e.message);
  }
}

console.log(`\n${passed} passed, ${failed} failed  (${path.basename(implPath)})`);
if (failed) process.exitCode = 1;
