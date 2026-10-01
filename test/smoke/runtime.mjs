// Smoke test for runtimes without node:test (Bun, Deno): `bun test/smoke/runtime.mjs`.
import assert from 'node:assert/strict';
import * as lib from '../../dist/index.js';
import { runChecks } from './checks.mjs';

await runChecks(lib, assert);
console.log(`excel-safe-csv smoke test passed (${typeof Bun === 'undefined' ? 'node' : `bun ${Bun.version}`})`);
