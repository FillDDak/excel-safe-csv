import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as lib from '../../dist/index.js';
import { runChecks } from './checks.mjs';

test('ESM entry point works', async () => {
  assert.equal(await runChecks(lib, assert), true);
});
