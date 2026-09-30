const assert = require('node:assert/strict');
const { test } = require('node:test');
const lib = require('../../dist/index.cjs');

test('CommonJS entry point works', async () => {
  const { runChecks } = await import('./checks.mjs');
  assert.equal(await runChecks(lib, assert), true);
  assert.equal(require('excel-csv').stringify, lib.stringify);
});
