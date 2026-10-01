/**
 * End-to-end test with a real spreadsheet engine: LibreOffice Calc opens the
 * CSV files written by excel-safe-csv (with formula evaluation and special-number
 * detection on, i.e. as aggressive as Excel), converts them to .xlsx, and the
 * resulting cells are compared with the original values.
 *
 * Skipped when `soffice` or Python's `openpyxl` is not installed.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { encode, stringify, type StringifyOptions } from '../../src/index';

const available = (() => {
  try {
    execFileSync('soffice', ['--version'], { stdio: 'ignore' });
    execFileSync('python3', ['-c', 'import openpyxl'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

type Cell = [value: unknown, type: string];

/** Opens CSV text in LibreOffice Calc and returns the cells it produced. */
function openInCalc(csv: string, { delimiter = 44, locale = 1033 }: { delimiter?: number; locale?: number } = {}): Cell[][] {
  const dir = mkdtempSync(join(tmpdir(), 'excel-safe-csv-'));
  writeFileSync(join(dir, 'data.csv'), encode(csv));
  // Separator, text delimiter ("), UTF-8, from line 1, no column formats, locale,
  // quoted-as-text off, detect special numbers on, ..., evaluate formulas on.
  const filter = `Text - txt - csv (StarCalc):${delimiter},34,76,1,,${locale},false,true,false,false,false,-1,true`;
  execFileSync('soffice', ['--headless', `--infilter=${filter}`, '--convert-to', 'xlsx', '--outdir', dir, join(dir, 'data.csv')], {
    stdio: 'ignore',
    timeout: 120_000,
  });
  const output = execFileSync('python3', [join(__dirname, 'read_xlsx.py'), join(dir, 'data.xlsx')], { encoding: 'utf8' });
  return JSON.parse(output) as Cell[][];
}

/** Values Excel is known to mangle, and a few that must stay untouched. */
const TRICKY = [
  '007', '0', '0123456789', '1234567890123456789', '4111111111111111', '1E5', '2e10', '1,234', '1.234,56', '1 234',
  '(123)', '$1,000', '€5', '₩1,000', '50%', '1/2', '3 1/4', '1-2', '2024-01', '2024-01-02', '01.02.2024',
  '2024/01/02', 'Jan 2', '2-Jan', 'MARCH1', 'SEPT2', 'DEC1', '1:30', '12:30 PM', '9am', 'TRUE', 'false', '#N/A',
  '#DIV/0!', '=1+1', '+1', '-1', '@SUM(1)', '-', '=HYPERLINK("http://evil.example","click")', "=cmd|' /C calc'!A0",
  '+82 10-1234-5678', '010-1234-5678', '02134', '12345-6789', '192.168.0.1', '1.10', '.5', '1.', "'abc", '  007  ',
  '3월 1일', '2024년 1월', '오후 3:00', '2024年1月2日', '１２３', '١٢٣', 'a"b', '"', '12\n34', 'line1\r\nline2',
  `${'9'.repeat(300)}`, 'Hello', '김철수', 'user@example.com', 'ABC-123', '',
];

describe.skipIf(!available)('LibreOffice Calc opens the output exactly', () => {
  it('shows every tricky string verbatim, as text', () => {
    const cells = openInCalc(stringify(TRICKY.map((value) => [value])));
    TRICKY.forEach((value, i) => {
      const [shown, type] = cells[i]?.[0] ?? [null, 'NoneType'];
      if (value === '') {
        expect(shown).toBeNull();
        return;
      }
      // Calc stores a CR LF inside a cell as LF.
      expect([shown, type], JSON.stringify(value)).toEqual([value.replace(/\r\n/g, '\n'), 'str']);
    });
  }, 180_000);

  it('shows random strings verbatim', () => {
    // XML (and so .xlsx) cannot store most C0 control characters.
    const unit = fc.oneof(fc.constantFrom(...'0123456789-/:.,+=@ %$E'), fc.string({ unit: 'grapheme', minLength: 1, maxLength: 1 }));
    const text = fc.string({ unit, maxLength: 12 }).filter(
      (s) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\r]/.test(s),
    );
    const values = fc.sample(text, { numRuns: 400, seed: 42 });
    const cells = openInCalc(stringify(values.map((value) => [value])));
    values.forEach((value, i) => {
      const shown = cells[i]?.[0]?.[0] ?? '';
      expect(shown, JSON.stringify(value)).toBe(value);
    });
  }, 180_000);

  it('keeps numbers, dates and booleans native', () => {
    const date = new Date(Date.UTC(2024, 0, 31, 13, 45, 6));
    const cells = openInCalc(stringify([[42, -1.5, 1e21, 123456789012345, date, true, false, 12345678901234567890n]], { timeZone: 'UTC' }));
    expect(cells[0]).toEqual([
      [42, 'int'],
      [-1.5, 'float'],
      [1e21, 'float'],
      [123456789012345, 'int'],
      ['2024-01-31T13:45:06', 'datetime'],
      [true, 'bool'],
      [false, 'bool'],
      ['12345678901234567890', 'str'], // more than 15 digits: kept as text
    ]);
  }, 180_000);

  it('works with semicolons and decimal commas in a German locale', () => {
    const options: StringifyOptions = { delimiter: ';', decimalSeparator: ',', timeZone: 'UTC', booleans: ['WAHR', 'FALSCH'] };
    const csv = stringify([[1.5, '1,5', new Date(Date.UTC(2024, 0, 31)), '007', true]], options);
    const cells = openInCalc(csv, { delimiter: 59, locale: 1031 });
    expect(cells[0]).toEqual([
      [1.5, 'float'],
      ['1,5', 'str'],
      ['2024-01-31T00:00:00', 'datetime'],
      ['007', 'str'],
      ['WAHR', 'str'],
    ]);
  }, 180_000);

  it('without protection, the same values are mangled (control experiment)', () => {
    const cells = openInCalc(stringify([['007'], ['1/2'], ['1234567890123456789'], ['=1+1']], { protect: 'none', formulas: 'allow' }));
    const [zero, date, long, formula] = cells.map((row) => row[0]);
    expect(zero).toEqual([7, 'int']);
    expect(date?.[1]).toBe('datetime');
    expect(typeof long?.[0]).toBe('number');
    expect(String(long?.[0])).not.toBe('1234567890123456789');
    expect(formula).toEqual([2, 'int']);
  }, 180_000);
});
