/**
 * Property-based tests: thousands of random tables, written and read back
 * with every combination of output options.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  CsvError,
  createWriter,
  encode,
  formatCell,
  isFormulaLike,
  parse,
  parseObjects,
  stringify,
  type StringifyOptions,
} from '../src/index';
import { unwrapTextFormula } from '../src/formula';
import { executable } from './helpers';

/** Strings that exercise CSV and Excel edge cases much more often than random text would. */
const tricky = fc.oneof(
  { weight: 3, arbitrary: fc.string({ unit: 'binary', maxLength: 30 }) },
  { weight: 2, arbitrary: fc.string({ unit: fc.constantFrom(...',;\t|"\r\n =+-@\'0123456789.eE/:#%$ \u{a0}\u{feff}'), maxLength: 12 }) },
  {
    weight: 2,
    arbitrary: fc.constantFrom(
      '',
      '007',
      '1/2',
      'MARCH1',
      'TRUE',
      '#N/A',
      '=1+1',
      '-',
      '+82 10',
      '@x',
      'ID',
      'sep=;',
      '\u{feff}',
      '"',
      '""',
      '="x"',
      '=CHAR(10)',
      '1E5',
      '2024-01-01',
      '한글',
      '😀',
      'a\r\nb',
      '\t',
      ' ',
    ),
  },
  { weight: 1, arbitrary: fc.string({ unit: 'grapheme', maxLength: 300 }) },
);

const table = fc.array(fc.array(tricky, { minLength: 1, maxLength: 6 }), { maxLength: 8 });

const outputOptions = fc.record(
  {
    delimiter: fc.constantFrom(',', ';', '\t', '|'),
    newline: fc.constantFrom('\r\n' as const, '\n' as const),
    bom: fc.boolean(),
    sepHint: fc.boolean(),
    quote: fc.constantFrom('auto' as const, 'always' as const),
  },
  { requiredKeys: [] },
);

describe('round trip: stringify → parse', () => {
  it('returns exactly the original strings, whatever the options', () => {
    fc.assert(
      fc.property(table, outputOptions, (rows, options) => {
        const csv = stringify(rows, options);
        const delimiter = options.delimiter ?? ',';
        expect(parse(csv, { delimiter })).toEqual(rows);
        if (options.sepHint === true) expect(parse(csv)).toEqual(rows);
      }),
      { numRuns: 4000 },
    );
  });

  it('round-trips through bytes in UTF-8 and UTF-16LE', () => {
    const text = fc.array(fc.array(fc.string({ unit: 'grapheme', maxLength: 20 }), { minLength: 1, maxLength: 4 }), { maxLength: 6 });
    fc.assert(
      fc.property(text, fc.constantFrom('utf-8' as const, 'utf-16le' as const), fc.constantFrom(',', '\t'), (rows, encoding, delimiter) => {
        const bytes = encode(stringify(rows, { delimiter }), encoding);
        expect(parse(bytes, { delimiter })).toEqual(rows);
      }),
      { numRuns: 1000 },
    );
  });

  it('detects the delimiter of well-formed tables', () => {
    const cell = fc.string({ unit: fc.constantFrom(...'abcXYZ019 .-_가'), minLength: 1, maxLength: 8 });
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 6 }).chain((width) => fc.array(fc.array(cell, { minLength: width, maxLength: width }), { minLength: 1, maxLength: 20 })),
        fc.constantFrom(',', ';', '\t', '|'),
        (rows, delimiter) => {
          expect(parse(stringify(rows, { delimiter }))).toEqual(rows);
        },
      ),
      { numRuns: 1000 },
    );
  });

  it('round-trips objects through parseObjects', () => {
    const keys = fc.uniqueArray(tricky, { minLength: 1, maxLength: 5 });
    fc.assert(
      fc.property(
        keys.chain((names) =>
          fc.tuple(fc.constant(names), fc.array(fc.array(tricky, { minLength: names.length, maxLength: names.length }), { maxLength: 5 })),
        ),
        ([names, values]) => {
          const objects = values.map((row) => Object.fromEntries(names.map((name, i) => [name, row[i]])));
          const csv = stringify(objects, { columns: names });
          expect(parseObjects(csv, { delimiter: ',' })).toEqual(objects);
        },
      ),
      { numRuns: 1500 },
    );
  });

  it('reads back every kind of value as the text Excel shows', () => {
    const value = fc.oneof(
      fc.double(),
      fc.bigInt(),
      fc.boolean(),
      fc.date(),
      fc.constant(null),
      fc.constant(undefined),
      tricky,
      fc.array(fc.integer(), { maxLength: 3 }),
      fc.dictionary(fc.string({ maxLength: 3 }), fc.integer(), { maxKeys: 2 }),
    );
    fc.assert(
      fc.property(fc.array(value, { minLength: 1, maxLength: 5 }), (row) => {
        const expected = row.map((v) => {
          const cell = formatCell(v, { timeZone: 'UTC' });
          return unwrapTextFormula(cell) ?? cell;
        });
        expect(parse(stringify([row], { timeZone: 'UTC' }), { delimiter: ',' })).toEqual([expected]);
      }),
      { numRuns: 2000 },
    );
  });
});

describe('safety invariants', () => {
  it('the executable check agrees with isFormulaLike except for a bare leading tab or CR', () => {
    fc.assert(
      fc.property(tricky, (text) => {
        if (executable(text)) expect(isFormulaLike(text)).toBe(true);
      }),
    );
  });

  it('never writes a cell a spreadsheet would execute', () => {
    fc.assert(
      fc.property(table, fc.constantFrom('formula' as const, 'tab' as const, 'none' as const), (rows, protect) => {
        const csv = stringify(rows, { protect, bom: false });
        for (const [r, row] of parse(csv, { unwrapFormulas: false, delimiter: ',' }).entries()) {
          for (const [c, cell] of row.entries()) {
            if (!executable(cell)) continue;
            // The only formulas written are text formulas that evaluate to the original value.
            expect(unwrapTextFormula(cell)).toBe(rows[r]?.[c]);
          }
        }
      }),
      { numRuns: 2000 },
    );
  });

  it('keeps every record on the right number of fields', () => {
    fc.assert(
      fc.property(table, outputOptions, (rows, options) => {
        const parsed = parse(stringify(rows, options), { delimiter: options.delimiter ?? ',' });
        expect(parsed.map((row) => row.length)).toEqual(rows.map((row) => row.length));
      }),
      { numRuns: 1000 },
    );
  });

  it('the incremental writer matches stringify', () => {
    const objects = fc.array(fc.record({ a: tricky, b: fc.oneof(fc.integer(), tricky), c: fc.boolean() }), { maxLength: 10 });
    fc.assert(
      fc.property(objects, outputOptions, (rows, options) => {
        const all: StringifyOptions = { ...options, columns: ['a', 'b', 'c'] };
        const writer = createWriter(all);
        let csv = '';
        for (const row of rows) csv += writer.write(row);
        csv += writer.end();
        expect(csv).toBe(stringify(rows, all));
      }),
      { numRuns: 500 },
    );
  });
});

describe('parser robustness', () => {
  it('never throws on arbitrary input in lenient mode', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary', maxLength: 200 }), (input) => {
        const rows = parse(input);
        expect(Array.isArray(rows)).toBe(true);
        for (const row of rows) expect(row.length).toBeGreaterThan(0);
      }),
      { numRuns: 5000 },
    );
  });

  it('never throws on arbitrary bytes', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 200 }), fc.constantFrom('windows-1252', 'euc-kr', 'shift_jis'), (bytes, fallbackEncoding) => {
        expect(Array.isArray(parse(bytes, { fallbackEncoding }))).toBe(true);
      }),
      { numRuns: 3000 },
    );
  });

  it('only throws CsvError PARSE_ERROR in strict mode', () => {
    fc.assert(
      fc.property(fc.string({ unit: fc.constantFrom(...'a,"\r\n;'), maxLength: 30 }), (input) => {
        try {
          parse(input, { strict: true });
        } catch (error) {
          expect(error).toBeInstanceOf(CsvError);
          expect((error as CsvError).code).toBe('PARSE_ERROR');
          expect((error as CsvError).line).toBeGreaterThanOrEqual(1);
        }
      }),
      { numRuns: 5000 },
    );
  });

  it('strict and lenient agree on valid CSV', () => {
    fc.assert(
      fc.property(table, (rows) => {
        const csv = stringify(rows, { bom: false });
        expect(parse(csv, { strict: true, delimiter: ',' })).toEqual(parse(csv, { delimiter: ',' }));
      }),
      { numRuns: 1000 },
    );
  });
});
