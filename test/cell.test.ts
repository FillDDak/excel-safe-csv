import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CsvError, formatCell, isFormulaLike, MAX_CELL_LENGTH } from '../src/index';
import { unwrapTextFormula } from '../src/formula';
import { executable } from './helpers';

const errorCode = (fn: () => unknown): string => {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(CsvError);
    return (error as CsvError).code;
  }
  throw new Error('expected a CsvError');
};

describe('formatCell: strings', () => {
  it('leaves ordinary text alone', () => {
    expect(formatCell('Hello')).toBe('Hello');
    expect(formatCell('')).toBe('');
    expect(formatCell('김철수')).toBe('김철수');
    expect(formatCell('a,b "c"\nd')).toBe('a,b "c"\nd');
  });

  it('protects values Excel would convert', () => {
    expect(formatCell('007')).toBe('="007"');
    expect(formatCell('1/2')).toBe('="1/2"');
    expect(formatCell('MARCH1')).toBe('="MARCH1"');
    expect(formatCell('TRUE')).toBe('="TRUE"');
    expect(formatCell('12\n34')).toBe('="12"&CHAR(10)&"34"');
  });

  it('neutralizes formulas losslessly', () => {
    expect(formatCell('=1+1')).toBe('="=1+1"');
    expect(formatCell('@SUM(A1)')).toBe('="@SUM(A1)"');
    expect(formatCell('-')).toBe('="-"');
    expect(formatCell('=HYPERLINK("http://x","y")')).toBe('="=HYPERLINK(""http://x"",""y"")"');
  });

  it('protect: "tab" prefixes a tab, and a quote for formulas', () => {
    expect(formatCell('007', { protect: 'tab' })).toBe('\t007');
    expect(formatCell('=1+1', { protect: 'tab' })).toBe("'=1+1");
    expect(formatCell('-5', { protect: 'tab' })).toBe("'-5");
    expect(formatCell('Hello', { protect: 'tab' })).toBe('Hello');
  });

  it('protect: "none" only neutralizes formulas', () => {
    expect(formatCell('007', { protect: 'none' })).toBe('007');
    expect(formatCell('=1+1', { protect: 'none' })).toBe("'=1+1");
  });

  it('falls back when the formula would be too long', () => {
    const long = '1'.repeat(9000);
    expect(formatCell(long)).toBe(`\t${long}`);
    expect(formatCell(`=${long}`)).toBe(`'=${long}`);
  });

  it('formulas: "allow" keeps strings starting with = only', () => {
    expect(formatCell('=SUM(A1:A3)', { formulas: 'allow' })).toBe('=SUM(A1:A3)');
    expect(formatCell('+1', { formulas: 'allow' })).toBe('="+1"');
    expect(formatCell(' =1', { formulas: 'allow' })).toBe('=" =1"');
    expect(formatCell('=SUM(A1)', { formulas: 'allow', type: 'text' })).toBe('="=SUM(A1)"');
  });

  it('formulas: "throw" rejects formula-like strings', () => {
    expect(errorCode(() => formatCell('=1', { formulas: 'throw' }))).toBe('FORMULA_REJECTED');
    expect(() => formatCell('\t1', { formulas: 'throw' })).toThrow(/would be evaluated as a formula/);
    expect(formatCell('1', { formulas: 'throw' })).toBe('="1"');
  });

  it('never produces an executable formula from untrusted text', () => {
    for (const protect of ['formula', 'tab', 'none'] as const) {
      fc.assert(
        fc.property(fc.string({ unit: 'binary', maxLength: 300 }), (text) => {
          const cell = formatCell(text, { protect });
          if (executable(cell)) expect(unwrapTextFormula(cell)).toBe(text);
          if (protect === 'formula' && isFormulaLike(cell)) expect(unwrapTextFormula(cell)).toBe(text);
        }),
        { numRuns: 1500 },
      );
    }
  });
});

describe('formatCell: numbers', () => {
  it('writes numbers as numbers', () => {
    expect(formatCell(42)).toBe('42');
    expect(formatCell(-1.5)).toBe('-1.5');
    expect(formatCell(0)).toBe('0');
    expect(formatCell(-0)).toBe('0');
    expect(formatCell(1e21)).toBe('1E+21');
    expect(formatCell(1.5e-7)).toBe('1.5E-7');
    expect(formatCell(0.1 + 0.2)).toBe('0.30000000000000004');
    expect(formatCell(123456789012345)).toBe('123456789012345');
    expect(formatCell(1e20)).toBe('100000000000000000000');
    expect(formatCell(9007199254740990)).toBe('9007199254740990'); // 15 significant digits
    expect(formatCell(Number.MAX_SAFE_INTEGER)).toBe('="9007199254740991"');
  });

  it('decimalSeparator: ","', () => {
    expect(formatCell(1.5, { decimalSeparator: ',' })).toBe('1,5');
    expect(formatCell(1.5e-7, { decimalSeparator: ',' })).toBe('1,5E-7');
    expect(formatCell(42, { decimalSeparator: ',' })).toBe('42');
  });

  it('writes integers with more than 15 significant digits as text', () => {
    expect(formatCell(1234567890123456)).toBe('="1234567890123456"');
    expect(formatCell(-1234567890123456)).toBe('="-1234567890123456"');
    expect(formatCell(1.2345678901234568e21)).toBe('="1.2345678901234568e+21"');
    expect(formatCell(1234567890123456, { largeNumbers: 'number' })).toBe('1234567890123456');
    expect(formatCell(1234567.891234567)).toBe('1234567.891234567');
  });

  it('writes values outside Excel range as text', () => {
    expect(formatCell(Number.MAX_VALUE)).toBe('="1.7976931348623157e+308"');
    expect(formatCell(5e-324)).toBe('="5e-324"');
    expect(formatCell(-1e-310)).toBe('="-1e-310"');
    expect(formatCell(9.99999999999999e307)).toBe('9.99999999999999E+307');
  });

  it('writes NaN and Infinity as text', () => {
    expect(formatCell(Number.NaN)).toBe('NaN');
    expect(formatCell(Infinity)).toBe('Infinity');
    expect(formatCell(-Infinity)).toBe('="-Infinity"');
  });

  it('writes bigints', () => {
    expect(formatCell(42n)).toBe('42');
    expect(formatCell(-123456789012345n)).toBe('-123456789012345');
    expect(formatCell(1234567890123456789n)).toBe('="1234567890123456789"');
    expect(formatCell(10n ** 300n)).toBe(`1${'0'.repeat(300)}`);
    expect(unwrapTextFormula(formatCell(10n ** 308n))).toBe(`1${'0'.repeat(308)}`);
    expect(formatCell(1234567890123456789n, { largeNumbers: 'number' })).toBe('1234567890123456789');
  });

  it('type: "number" converts numeric strings', () => {
    expect(formatCell('1234.50', { type: 'number' })).toBe('1234.50');
    expect(formatCell(' +7 ', { type: 'number' })).toBe('7');
    expect(formatCell('-.5', { type: 'number' })).toBe('-.5');
    expect(formatCell('1e3', { type: 'number' })).toBe('1E3');
    expect(formatCell('1.5', { type: 'number', decimalSeparator: ',' })).toBe('1,5');
    expect(formatCell('007', { type: 'number' })).toBe('007');
    expect(formatCell('0', { type: 'number' })).toBe('0');
    expect(formatCell('1,234', { type: 'number' })).toBe('="1,234"');
    expect(formatCell('abc', { type: 'number' })).toBe('abc');
    expect(formatCell('1e999', { type: 'number' })).toBe('="1e999"');
    expect(formatCell('1e-400', { type: 'number' })).toBe('="1e-400"');
    expect(formatCell('12345678901234567', { type: 'number' })).toBe('="12345678901234567"');
    expect(formatCell('12345678901234567', { type: 'number', largeNumbers: 'number' })).toBe('12345678901234567');
    expect(formatCell('1234567890.1234567', { type: 'number' })).toBe('1234567890.1234567');
    expect(formatCell(5, { type: 'number' })).toBe('5');
  });

  it('never loses a digit of any bigint', () => {
    fc.assert(
      fc.property(fc.bigInt(), (n) => {
        const cell = formatCell(n);
        expect(unwrapTextFormula(cell) ?? cell).toBe(n.toString());
      }),
    );
  });
});

describe('formatCell: booleans, empty values, other types', () => {
  it('writes booleans', () => {
    expect(formatCell(true)).toBe('TRUE');
    expect(formatCell(false)).toBe('FALSE');
    expect(formatCell(true, { booleans: ['TRUE', 'FALSE'] })).toBe('TRUE');
    expect(formatCell(true, { booleans: ['예', '아니오'] })).toBe('예');
    expect(formatCell(false, { booleans: ['Y', 'N'] })).toBe('N');
    expect(formatCell(true, { booleans: ['1', '0'] })).toBe('="1"');
    expect(formatCell(true, { type: 'text' })).toBe('="TRUE"');
  });

  it('writes null and undefined as empty cells', () => {
    expect(formatCell(null)).toBe('');
    expect(formatCell(undefined)).toBe('');
    expect(formatCell(null, { type: 'text' })).toBe('');
    expect(formatCell(undefined, { type: 'raw' })).toBe('');
  });

  it('writes plain objects and arrays as JSON', () => {
    expect(formatCell({ a: 1 })).toBe('{"a":1}');
    expect(formatCell([1, 2])).toBe('[1,2]');
    expect(formatCell(Object.assign(Object.create(null), { a: 1 }))).toBe('{"a":1}');
    expect(formatCell({ toJSON: () => undefined })).toBe('');
    expect(formatCell({ toJSON: () => '007' })).toBe('"007"');
    class Point {
      constructor(
        public x: number,
        public y: number,
      ) {}
    }
    expect(formatCell(new Point(1, 2))).toBe('{"x":1,"y":2}');
  });

  it('writes objects with their own toString as that string', () => {
    expect(formatCell(new URL('https://example.com/a'))).toBe('https://example.com/a');
    class Money {
      toString(): string {
        return '₩1,000';
      }
    }
    expect(formatCell(new Money())).toBe('="₩1,000"');
    expect(formatCell(/a+/g)).toBe('/a+/g');
    expect(formatCell(new Number(5))).toBe('="5"');
  });

  it('writes symbols by description', () => {
    expect(formatCell(Symbol('x'))).toBe('Symbol(x)');
  });

  it('rejects functions and circular objects', () => {
    expect(errorCode(() => formatCell(() => 1))).toBe('INVALID_VALUE');
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(errorCode(() => formatCell(circular))).toBe('INVALID_VALUE');
    expect(errorCode(() => formatCell({ n: 1n }))).toBe('INVALID_VALUE');
  });
});

describe('formatCell: dates', () => {
  const date = new Date(Date.UTC(2024, 0, 31, 4, 45, 6, 789));

  it('writes real Excel dates in the chosen time zone', () => {
    expect(formatCell(date, { timeZone: 'UTC' })).toBe('2024-01-31 04:45:06');
    expect(formatCell(date, { timeZone: 'utc' })).toBe('2024-01-31 04:45:06');
    expect(formatCell(date, { timeZone: 'Asia/Seoul' })).toBe('2024-01-31 13:45:06');
    expect(formatCell(date, { timeZone: 'America/Los_Angeles' })).toBe('2024-01-30 20:45:06');
    expect(formatCell(date, { timeZone: 'Asia/Kolkata' })).toBe('2024-01-31 10:15:06');
    expect(formatCell(date, { timeZone: 'Asia/Seoul', dateFormat: 'date' })).toBe('2024-01-31');
    expect(formatCell(new Date(Date.UTC(2024, 0, 31, 15)), { timeZone: 'Asia/Seoul' })).toBe('2024-02-01 00:00:00');
  });

  it('uses local time by default', () => {
    const local = new Date(2024, 5, 7, 8, 9, 10);
    expect(formatCell(local)).toBe('2024-06-07 08:09:10');
    expect(formatCell(local, { timeZone: 'local' })).toBe('2024-06-07 08:09:10');
    expect(formatCell(local, { dateFormat: 'date' })).toBe('2024-06-07');
  });

  it('matches Intl for any date and zone', () => {
    const zones = ['UTC', 'Asia/Seoul', 'America/New_York', 'Europe/London', 'Australia/Lord_Howe', 'Pacific/Chatham', 'Asia/Kathmandu'];
    fc.assert(
      fc.property(
        fc.date({ min: new Date(Date.UTC(1900, 0, 2)), max: new Date(Date.UTC(9999, 11, 30)), noInvalidDate: true }),
        fc.constantFrom(...zones),
        (d, timeZone) => {
          const parts = Object.fromEntries(
            new Intl.DateTimeFormat('en-US', {
              timeZone,
              hourCycle: 'h23',
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            })
              .formatToParts(d)
              .map((p) => [p.type, p.value]),
          );
          const expected = `${parts.year}-${parts.month}-${parts.day} ${parts.hour === '24' ? '00' : parts.hour}:${parts.minute}:${parts.second}`;
          expect(formatCell(d, { timeZone })).toBe(expected.padStart(19, '0'));
        },
      ),
    );
  });

  it('writes ISO text', () => {
    expect(formatCell(date, { dateFormat: 'iso' })).toBe('="2024-01-31T04:45:06.789Z"');
  });

  it('writes the result of a dateFormat function as text', () => {
    expect(formatCell(date, { dateFormat: (d) => `Y${d.getUTCFullYear()}` })).toBe('Y2024');
    expect(formatCell(date, { dateFormat: () => '2024/01/31' })).toBe('="2024/01/31"');
    expect(errorCode(() => formatCell(date, { dateFormat: () => 5 as unknown as string }))).toBe('INVALID_VALUE');
    expect(
      errorCode(() =>
        formatCell(date, {
          dateFormat: () => {
            throw new Error('boom');
          },
        }),
      ),
    ).toBe('INVALID_VALUE');
  });

  it('writes dates Excel cannot represent as ISO text', () => {
    expect(formatCell(new Date(Date.UTC(1899, 11, 31)), { timeZone: 'UTC' })).toBe('="1899-12-31T00:00:00.000Z"');
    expect(formatCell(new Date(Date.UTC(10000, 0, 1)), { timeZone: 'UTC' })).toBe('="+010000-01-01T00:00:00.000Z"');
    expect(formatCell(new Date(-8.64e15), { timeZone: 'Asia/Seoul' })).toBe('="-271821-04-20T00:00:00.000Z"');
    expect(formatCell(new Date(Date.UTC(1900, 0, 1)), { timeZone: 'UTC' })).toBe('1900-01-01 00:00:00');
    expect(formatCell(new Date(Date.UTC(9999, 11, 31, 23, 59, 59)), { timeZone: 'UTC' })).toBe('9999-12-31 23:59:59');
  });

  it('writes invalid dates as text', () => {
    expect(formatCell(new Date(Number.NaN))).toBe('Invalid Date');
  });

  it('type: "text" keeps the formatted date as text', () => {
    expect(formatCell(date, { timeZone: 'UTC', type: 'text' })).toBe('="2024-01-31 04:45:06"');
    expect(formatCell(date, { timeZone: 'UTC', type: 'raw' })).toBe('2024-01-31 04:45:06');
  });
});

describe('formatCell: column types', () => {
  it('type: "text" turns numbers into text', () => {
    expect(formatCell(7, { type: 'text' })).toBe('="7"');
    expect(formatCell(1.5, { type: 'text', decimalSeparator: ',' })).toBe('="1,5"');
    expect(formatCell('Hello', { type: 'text' })).toBe('Hello');
  });

  it('type: "raw" writes values unprotected', () => {
    expect(formatCell('=1+1', { type: 'raw' })).toBe('=1+1');
    expect(formatCell('007', { type: 'raw' })).toBe('007');
    expect(formatCell(7, { type: 'raw' })).toBe('7');
  });
});

describe('formatCell: Excel limits', () => {
  const long = 'x'.repeat(MAX_CELL_LENGTH + 1);

  it('throws for cells longer than 32,767 characters', () => {
    expect(formatCell('x'.repeat(MAX_CELL_LENGTH))).toHaveLength(MAX_CELL_LENGTH);
    expect(errorCode(() => formatCell(long))).toBe('CELL_TOO_LONG');
    expect(errorCode(() => formatCell(long, { type: 'raw' }))).toBe('CELL_TOO_LONG');
  });

  it('truncates when asked, without splitting surrogate pairs', () => {
    expect(formatCell(long, { limits: 'truncate' })).toHaveLength(MAX_CELL_LENGTH);
    const emoji = `${'x'.repeat(MAX_CELL_LENGTH - 1)}😀`;
    expect(formatCell(emoji, { limits: 'truncate' })).toBe('x'.repeat(MAX_CELL_LENGTH - 1));
    const after = `${'x'.repeat(MAX_CELL_LENGTH - 2)}😀y`;
    expect(formatCell(after, { limits: 'truncate' })).toBe(`${'x'.repeat(MAX_CELL_LENGTH - 2)}😀`);
  });

  it('ignores the limit when asked', () => {
    expect(formatCell(long, { limits: 'ignore' })).toBe(long);
  });
});

describe('formatCell: option validation', () => {
  it.each([
    [{ protect: 'x' }, /Invalid option "protect": expected "formula" \| "tab" \| "none", received "x"/],
    [{ formulas: 1 }, /Invalid option "formulas"/],
    [{ decimalSeparator: ';' }, /Invalid option "decimalSeparator"/],
    [{ dateFormat: 'yyyy' }, /Invalid option "dateFormat"/],
    [{ timeZone: '' }, /Invalid option "timeZone"/],
    [{ timeZone: 5 }, /Invalid option "timeZone"/],
    [{ timeZone: 'Mars/Olympus' }, /unknown time zone "Mars\/Olympus"/],
    [{ booleans: ['a'] }, /Invalid option "booleans"/],
    [{ booleans: 'yes' }, /Invalid option "booleans"/],
    [{ booleans: [1, 0] }, /Invalid option "booleans"/],
    [{ largeNumbers: 'string' }, /Invalid option "largeNumbers"/],
    [{ limits: false }, /Invalid option "limits"/],
    [{ type: 'date' }, /Invalid option "type"/],
  ])('rejects %o', (options, message) => {
    expect(() => formatCell('x', options as never)).toThrow(message);
    expect(errorCode(() => formatCell('x', options as never))).toBe('INVALID_OPTION');
  });

  it('rejects non-object options', () => {
    expect(() => formatCell('x', 'text' as never)).toThrow(/Invalid option "options": expected an object, received "text"/);
    expect(() => formatCell('x', null as never)).toThrow(/received null/);
  });

  it('accepts undefined options', () => {
    expect(formatCell('x', undefined)).toBe('x');
    expect(formatCell('x', {})).toBe('x');
  });
});
