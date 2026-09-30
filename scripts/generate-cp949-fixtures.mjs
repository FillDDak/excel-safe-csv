// Records how a WHATWG-conformant runtime (Bun, browsers, Deno) decodes random
// CP949 byte sequences, as ground truth for the Node.js fallback decoder.
// Run with: bun scripts/generate-cp949-fixtures.mjs
import { writeFileSync } from 'node:fs';

let seed = 949;
const random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (list) => list[Math.floor(random() * list.length)];
const interesting = [0x00, 0x0a, 0x2c, 0x40, 0x41, 0x5a, 0x5b, 0x60, 0x61, 0x7a, 0x7b, 0x80, 0x81, 0xa0, 0xa1, 0xc6, 0xc7, 0xc8, 0xc9, 0xfd, 0xfe, 0xff];

const cases = [];
for (let i = 0; i < 400; i++) {
  const length = Math.floor(random() * 24);
  const bytes = Array.from({ length }, () => (random() < 0.5 ? pick(interesting) : Math.floor(random() * 256)));
  const replaced = new TextDecoder('euc-kr').decode(Uint8Array.from(bytes));
  let valid = true;
  try {
    new TextDecoder('euc-kr', { fatal: true }).decode(Uint8Array.from(bytes));
  } catch {
    valid = false;
  }
  cases.push({ bytes, text: replaced, valid });
}
writeFileSync(new URL('../test/fixtures/cp949-whatwg.json', import.meta.url), `${JSON.stringify(cases)}\n`);
console.log(`${cases.length} cases, ${cases.filter((c) => c.valid).length} valid`);
