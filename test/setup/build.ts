import { execFileSync } from 'node:child_process';

/** Builds dist/ once before the tests that exercise the published files (CLI, CJS/ESM entry points). */
export default function setup(): void {
  execFileSync(process.execPath, ['node_modules/tsup/dist/cli-default.js', '--silent'], { stdio: 'inherit' });
}
