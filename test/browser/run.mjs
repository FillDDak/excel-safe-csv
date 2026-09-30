// Runs the smoke checks in headless Chromium against dist/index.js.
// Usage: npm run build && npm run test:browser
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = fileURLToPath(new URL('../..', import.meta.url));
const types = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html' };

const page = `<!doctype html><meta charset="utf-8"><script type="module">
  import * as lib from '/dist/index.js';
  import { runChecks } from '/test/smoke/checks.mjs';
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const assert = {
    equal: (a, b) => { if (a !== b) throw new Error('Expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); },
    deepEqual: (a, b) => { if (!same(a, b)) throw new Error('Expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); },
    throws: (fn, check) => { try { fn(); } catch (error) { if (check(error)) return; throw error; } throw new Error('Expected an error'); },
  };
  runChecks(lib, assert).then(() => { window.result = 'ok'; }, (error) => { window.result = String(error && error.stack || error); });
</script>`;

const server = createServer(async (request, response) => {
  const path = normalize(decodeURIComponent(new URL(request.url, 'http://x').pathname));
  if (path === '/') return response.end(page);
  try {
    const body = await readFile(join(root, path));
    response.writeHead(200, { 'Content-Type': types[extname(path)] ?? 'application/octet-stream' }).end(body);
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/`;

// Set CHROMIUM_PATH to use a Chromium other than the one bundled with playwright-core.
const executablePath = process.env.CHROMIUM_PATH;
const browser = await chromium.launch(executablePath ? { executablePath } : {});
try {
  const tab = await browser.newPage();
  tab.on('pageerror', (error) => console.error(error));
  await tab.goto(url);
  const result = await tab.waitForFunction(() => window.result, null, { timeout: 30_000 }).then((handle) => handle.jsonValue());
  if (result !== 'ok') throw new Error(result);
  console.log(`excel-csv browser test passed (${browser.version()})`);
} finally {
  await browser.close();
  server.close();
}
