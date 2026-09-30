// Rough throughput check: node bench/stringify.bench.mjs (after npm run build)
import { parse, stringify } from '../dist/index.js';

const rows = Array.from({ length: 100_000 }, (_, i) => ({
  id: i,
  name: `Customer ${i}`,
  email: `user${i}@example.com`,
  phone: `010-${String(i % 10000).padStart(4, '0')}-5678`,
  zip: String(i % 99999).padStart(5, '0'),
  city: ['Seoul', '부산', 'München', 'São Paulo'][i % 4],
  amount: i * 1.25,
  joined: new Date(Date.UTC(2020, 0, 1) + i * 86_400_000),
  active: i % 2 === 0,
  note: i % 10 === 0 ? 'Line one\nLine "two"' : 'ok',
}));

const time = (label, fn) => {
  fn(); // warm up
  const start = performance.now();
  const result = fn();
  const ms = performance.now() - start;
  console.log(`${label}: ${ms.toFixed(0)} ms (${((rows.length * 10) / ms / 1000).toFixed(2)} M cells/s)`);
  return result;
};

const csv = time('stringify 100k rows × 10 columns', () => stringify(rows, { timeZone: 'UTC' }));
console.log(`output: ${(csv.length / 1e6).toFixed(1)} M characters`);
time('parse the same file', () => parse(csv));
