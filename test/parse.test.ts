import { describe, expect, it } from 'vitest';
import { CsvError, encode, parse, parseObjects } from '../src/index';

const errorOf = (fn: () => unknown): CsvError => {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(CsvError);
    return error as CsvError;
  }
  throw new Error('expected a CsvError');
};

describe('parse: RFC 4180', () => {
  it('parses simple records', () => {
    expect(parse('a,b\r\nc,d\r\n')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
    expect(parse('a,b\r\nc,d')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('parses empty input', () => {
    expect(parse('')).toEqual([]);
    expect(parse('\u{feff}')).toEqual([]);
    expect(parse(new Uint8Array())).toEqual([]);
  });

  it('parses empty fields and lines', () => {
    expect(parse(',')).toEqual([['', '']]);
    expect(parse('a,')).toEqual([['a', '']]);
    expect(parse(',a')).toEqual([['', 'a']]);
    expect(parse('\n')).toEqual([['']]);
    expect(parse('a\n\nb')).toEqual([['a'], [''], ['b']]);
    expect(parse('a,\n')).toEqual([['a', '']]);
    expect(parse('""')).toEqual([['']]);
    expect(parse('"",""')).toEqual([['', '']]);
  });

  it('parses quoted fields', () => {
    expect(parse('"a,b","c""d","e\r\nf","g\nh"')).toEqual([['a,b', 'c"d', 'e\r\nf', 'g\nh']]);
    expect(parse('"a"\r\n"b"')).toEqual([['a'], ['b']]);
    expect(parse('"a"""')).toEqual([['a"']]);
    expect(parse('""""')).toEqual([['"']]);
  });

  it('accepts CRLF, LF and CR line endings', () => {
    expect(parse('a\rb\nc\r\nd')).toEqual([['a'], ['b'], ['c'], ['d']]);
    expect(parse('a\r')).toEqual([['a']]);
    expect(parse('a\r\r')).toEqual([['a'], ['']]);
  });

  it('keeps spaces', () => {
    expect(parse(' a , b ')).toEqual([[' a ', ' b ']]);
  });

  it('never converts values', () => {
    expect(parse('007,1.50,TRUE,2024-01-01')).toEqual([['007', '1.50', 'TRUE', '2024-01-01']]);
  });
});

describe('parse: Excel leniency', () => {
  it('keeps text after a closing quote', () => {
    expect(parse('"ab"cd,e')).toEqual([['abcd', 'e']]);
    expect(parse('"ab" ,e')).toEqual([['ab ', 'e']]);
    expect(parse('"a"b"c"')).toEqual([['ab"c"']]);
  });

  it('treats quotes inside unquoted fields literally', () => {
    expect(parse('a"b,c')).toEqual([['a"b', 'c']]);
    expect(parse('5" pipe,x')).toEqual([['5" pipe', 'x']]);
  });

  it('reads an unterminated quoted field to the end', () => {
    expect(parse('a,"b\nc')).toEqual([['a', 'b\nc']]);
    expect(parse('"')).toEqual([['']]);
  });
});

describe('parse: strict mode', () => {
  it('rejects malformed input with a line number', () => {
    const unterminated = errorOf(() => parse('a\nb,"c\nd', { strict: true }));
    expect(unterminated.code).toBe('PARSE_ERROR');
    expect(unterminated.line).toBe(2);
    expect(unterminated.message).toBe('Unterminated quoted field (line 2).');
    expect(errorOf(() => parse('"a"b', { strict: true })).message).toMatch(/Unexpected text after a closing quote \(line 1\)/);
    expect(errorOf(() => parse('x\r\ny\rz\na"b', { strict: true })).line).toBe(4);
    expect(errorOf(() => parse('"a\r\nb"\r\nc"d', { strict: true })).line).toBe(3);
  });

  it('accepts valid input', () => {
    expect(parse('"a""b",c\r\n', { strict: true })).toEqual([['a"b', 'c']]);
  });
});

describe('parse: delimiters', () => {
  it('detects the delimiter', () => {
    expect(parse('a;b;c\n1;2;3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
    expect(parse('a\tb\n1\t2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
    expect(parse('a|b\n1|2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
    expect(parse('a,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('prefers the most consistent delimiter', () => {
    // Semicolon-separated with decimal commas (European Excel)
    expect(parse('name;price\nA;1,5\nB;2,25\nC;3')).toEqual([
      ['name', 'price'],
      ['A', '1,5'],
      ['B', '2,25'],
      ['C', '3'],
    ]);
    // Tab-separated with commas inside values
    expect(parse('a\tb\nx, y\tz\n1\t2, 3')).toEqual([
      ['a', 'b'],
      ['x, y', 'z'],
      ['1', '2, 3'],
    ]);
    // Delimiters inside quotes do not count
    expect(parse('"a;b";c\n"d;e";f')).toEqual([
      ['a;b', 'c'],
      ['d;e', 'f'],
    ]);
  });

  it('falls back to comma', () => {
    expect(parse('single')).toEqual([['single']]);
    expect(parse('a\nb')).toEqual([['a'], ['b']]);
    expect(parse('\n\n')).toEqual([[''], ['']]);
  });

  it('prefers comma on ties', () => {
    expect(parse('a,b;c')).toEqual([['a', 'b;c']]);
  });

  it('samples only the beginning of large inputs', () => {
    const body = Array.from({ length: 20_000 }, (_, i) => `${i};${i}`).join('\n');
    expect(parse(body)[19_999]).toEqual(['19999', '19999']);
    const many = Array.from({ length: 200 }, (_, i) => `${i}\t${i}`).join('\n');
    expect(parse(many)).toHaveLength(200);
    const oneHugeLine = `${'x'.repeat(70_000)}\ta`;
    expect(parse(oneHugeLine)).toEqual([[`${'x'.repeat(70_000)}\ta`]]);
  });

  it('honours an explicit delimiter', () => {
    expect(parse('a;b,c', { delimiter: ',' })).toEqual([['a;b', 'c']]);
    expect(parse('a;b,c', { delimiter: 'auto' })).toEqual([['a;b', 'c']]);
  });

  it('reads and removes a sep= line', () => {
    expect(parse('sep=;\r\na;b,c\r\n')).toEqual([['a', 'b,c']]);
    expect(parse('SEP=|\na|b')).toEqual([['a', 'b']]);
    expect(parse('\u{feff}sep=\t\na\tb')).toEqual([['a', 'b']]);
    expect(parse('sep=;')).toEqual([]);
    expect(parse('sep=;\ra;b')).toEqual([['a', 'b']]);
    expect(parse('sep=;\na;b,c', { delimiter: ',' })).toEqual([['a;b', 'c']]);
    expect(parse('"sep=;"\na')).toEqual([['sep=;'], ['a']]);
    expect(parse('sep=;;\na')).toEqual([['sep=', '', ''], ['a']]); // not a sep= line
  });

  it('rejects invalid delimiters', () => {
    for (const delimiter of ['', ',,', '"', '\n', '\r', 5]) {
      expect(errorOf(() => parse('a', { delimiter: delimiter as never })).code).toBe('INVALID_OPTION');
    }
  });
});

describe('parse: text formulas', () => {
  it('unwraps ="..." cells', () => {
    expect(parse('"=""007""",="1/2",x')).toEqual([['007', '1/2', 'x']]);
    expect(parse('"=""a""&CHAR(10)&""b"""')).toEqual([['a\nb']]);
    expect(parse('=SUM(A1),"=1+1"')).toEqual([['=SUM(A1)', '=1+1']]);
  });

  it('can keep them', () => {
    expect(parse('"=""007"""', { unwrapFormulas: false })).toEqual([['="007"']]);
  });
});

describe('parse: bytes', () => {
  it('decodes UTF-8 with or without BOM', () => {
    expect(parse(encode('\u{feff}이름,값\r\n김,1'))).toEqual([
      ['이름', '값'],
      ['김', '1'],
    ]);
    expect(parse(encode('이름,값'))).toEqual([['이름', '값']]);
  });

  it('decodes UTF-16LE (Excel "Unicode Text")', () => {
    expect(parse(encode('\u{feff}이름\t값\r\n김\t1\r\n', 'utf-16le'))).toEqual([
      ['이름', '값'],
      ['김', '1'],
    ]);
  });

  it('decodes CP949 (Excel on Korean Windows)', () => {
    const cp949 = new Uint8Array([0xc0, 0xcc, 0xb8, 0xa7, 0x2c, 0xb0, 0xaa, 0x0d, 0x0a, 0xb1, 0xe8, 0x2c, 0x31]);
    expect(parse(cp949, { fallbackEncoding: 'euc-kr' })).toEqual([
      ['이름', '값'],
      ['김', '1'],
    ]);
    expect(parse(cp949, { encoding: 'cp949' })).toEqual([
      ['이름', '값'],
      ['김', '1'],
    ]);
  });

  it('rejects invalid input', () => {
    expect(errorOf(() => parse(5 as never)).code).toBe('INVALID_VALUE');
  });
});

describe('parse: options', () => {
  it('skips empty lines', () => {
    expect(parse('a\n\n\nb\n,\n', { skipEmptyLines: true })).toEqual([['a'], ['b'], ['', '']]);
  });

  it('rejects invalid options', () => {
    expect(errorOf(() => parse('a', 'x' as never)).code).toBe('INVALID_OPTION');
    expect(errorOf(() => parse('a', null as never)).code).toBe('INVALID_OPTION');
    expect(errorOf(() => parse('a', { strict: 1 as never })).message).toMatch(/"strict"/);
    expect(errorOf(() => parse('a', { unwrapFormulas: 'no' as never })).message).toMatch(/"unwrapFormulas"/);
    expect(errorOf(() => parse('a', { skipEmptyLines: 0 as never })).message).toMatch(/"skipEmptyLines"/);
  });
});

describe('parseObjects', () => {
  it('uses the first row as header', () => {
    expect(parseObjects('name,zip\r\nKim,"=""02134"""\r\nLee,06236\r\n')).toEqual([
      { name: 'Kim', zip: '02134' },
      { name: 'Lee', zip: '06236' },
    ]);
  });

  it('returns nothing for empty input or a header only', () => {
    expect(parseObjects('')).toEqual([]);
    expect(parseObjects('a,b\r\n')).toEqual([]);
  });

  it('makes duplicate and empty header names unique', () => {
    expect(parseObjects('a,a,,a_2,a\n1,2,3,4,5')).toEqual([{ a: '1', a_2: '2', '': '3', a_2_2: '4', a_3: '5' }]);
  });

  it('fills missing cells and names extra ones', () => {
    expect(parseObjects('a,b\n1\n1,2,3\n1,2,3,4')).toEqual([
      { a: '1', b: '' },
      { a: '1', b: '2', column_3: '3' },
      { a: '1', b: '2', column_3: '3', column_4: '4' },
    ]);
    expect(parseObjects('a,column_3\n1,2,3')).toEqual([{ a: '1', column_3: '2', column_3_2: '3' }]);
  });

  it('rejects ragged rows in strict mode', () => {
    const error = errorOf(() => parseObjects('a,b\n1,2\n1', { strict: true }));
    expect(error.code).toBe('PARSE_ERROR');
    expect(error.row).toBe(1);
    expect(error.message).toMatch(/Row 1 has 1 fields but the header has 2/);
  });

  it('accepts explicit headers', () => {
    expect(parseObjects('1,2\n3,4', { headers: ['x', 'y'] })).toEqual([
      { x: '1', y: '2' },
      { x: '3', y: '4' },
    ]);
    expect(parseObjects('', { headers: ['x'] })).toEqual([]);
    expect(errorOf(() => parseObjects('a', { headers: 'x' as never })).message).toMatch(/"headers"/);
    expect(errorOf(() => parseObjects('a', { headers: [1] as never })).message).toMatch(/"headers"/);
  });

  it('creates own properties for dangerous keys', () => {
    const [row] = parseObjects('__proto__,constructor,toString\n1,2,3') as [Record<string, string>];
    expect(Object.getPrototypeOf(row)).toBe(Object.prototype);
    expect(Object.keys(row)).toEqual(['__proto__', 'constructor', 'toString']);
    expect(Object.getOwnPropertyDescriptor(row, '__proto__')?.value).toBe('1');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('passes options through', () => {
    expect(parseObjects('a;b\n1;2', { delimiter: ';' })).toEqual([{ a: '1', b: '2' }]);
    expect(parseObjects('a\n\n1', { skipEmptyLines: true })).toEqual([{ a: '1' }]);
  });
});

describe('parse: delimiter detection edge cases', () => {
  it('requires the delimiter to split the header', () => {
    expect(parse('007\r\n|\r\n')).toEqual([['007'], ['|']]);
    expect(parse('name\nA;B\nC;D')).toEqual([['name'], ['A;B'], ['C;D']]);
    expect(parse('\n\na;b\nc;d')).toEqual([[''], [''], ['a', 'b'], ['c', 'd']]);
  });
});
