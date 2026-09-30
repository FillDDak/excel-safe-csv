import { describe as suite, expect, it } from 'vitest';
import { describe } from '../src/errors';
import { CsvError, formatCell, stringify } from '../src/index';

suite('CsvError', () => {
  it('carries a code, location and cause', () => {
    const cause = new Error('inner');
    const error = new CsvError('INVALID_VALUE', 'message', { row: 1, column: 'a', line: 3, cause });
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('CsvError');
    expect(error.message).toBe('message');
    expect(error.code).toBe('INVALID_VALUE');
    expect(error.row).toBe(1);
    expect(error.column).toBe('a');
    expect(error.line).toBe(3);
    expect(error.cause).toBe(cause);
    expect(String(error)).toBe('CsvError: message');
  });

  it('has no cause unless one is given', () => {
    const error = new CsvError('PARSE_ERROR', 'x');
    expect('cause' in error).toBe(false);
    expect(error.row).toBeUndefined();
    expect(error.column).toBeUndefined();
    expect(error.line).toBeUndefined();
  });

  it('names the header column that failed', () => {
    const long = 'x'.repeat(40_000);
    expect(() => stringify([], { columns: { a: long } })).toThrow(/\(column "a"\)$/);
    expect(() => formatCell(long)).toThrow(/characters; Excel supports at most 32767 \(set limits: 'truncate' to shorten it\)$/);
  });
});

suite('describe', () => {
  it('describes values safely and briefly', () => {
    expect(describe('abc')).toBe('"abc"');
    expect(describe('x'.repeat(50))).toBe(`"${'x'.repeat(40)}…"`);
    expect(describe(5n)).toBe('5n');
    expect(describe(() => 1)).toBe('a function');
    expect(describe(Symbol('s'))).toBe('Symbol(s)');
    expect(describe(null)).toBe('null');
    expect(describe(undefined)).toBe('undefined');
    expect(describe(1.5)).toBe('1.5');
    expect(describe(true)).toBe('true');
    expect(describe([1])).toBe('an array');
    expect(describe({ toString: () => 'secret' })).toBe('an object');
  });
});
