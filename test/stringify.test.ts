import { describe, expect, it } from 'vitest';
import { CsvError, createWriter, MAX_COLUMNS, MAX_ROWS, stringify } from '../src/index';

const BOM = '\uFEFF';
const errorOf = (fn: () => unknown): CsvError => {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(CsvError);
    return error as CsvError;
  }
  throw new Error('expected a CsvError');
};

describe('stringify: basics', () => {
  it('writes object rows with a header, BOM and CRLF', () => {
    expect(stringify([{ a: 1, b: 'x' }])).toBe(`${BOM}a,b\r\n1,x\r\n`);
  });

  it('writes array rows without a header', () => {
    expect(stringify([[1, 'x'], [2, 'y']])).toBe(`${BOM}1,x\r\n2,y\r\n`);
  });

  it('writes an empty file', () => {
    expect(stringify([])).toBe(BOM);
    expect(stringify([], { bom: false })).toBe('');
    expect(stringify([], { columns: ['a', 'b'] })).toBe(`${BOM}a,b\r\n`);
    expect(stringify([], { columns: ['a'], header: false, bom: false })).toBe('');
  });

  it('writes empty rows', () => {
    expect(stringify([[], []], { bom: false })).toBe('\r\n\r\n');
    expect(stringify([{}], { bom: false })).toBe('\r\n\r\n');
  });

  it('keeps ragged array rows as they are', () => {
    expect(stringify([[1], [1, 2, 3], []], { bom: false })).toBe('1\r\n1,2,3\r\n\r\n');
  });

  it('accepts any iterable', () => {
    expect(stringify(new Set([[1]]), { bom: false })).toBe('1\r\n');
    function* rows(): Generator<number[]> {
      yield [1];
      yield [2];
    }
    expect(stringify(rows(), { bom: false })).toBe('1\r\n2\r\n');
  });

  it('rejects inputs that are not iterables of rows', () => {
    for (const input of [undefined, null, 5, 'abc', { a: 1 }]) {
      const error = errorOf(() => stringify(input as never));
      expect(error.code).toBe('INVALID_OPTION');
      expect(error.message).toMatch(/stringify\(\) expects an array or iterable of rows/);
    }
    const error = errorOf(() => stringify([1] as never));
    expect(error.code).toBe('INVALID_ROW');
    expect(error.row).toBe(0);
    expect(errorOf(() => stringify([[1], null] as never)).row).toBe(1);
  });
});

describe('stringify: columns', () => {
  const users = [
    { id: 1, name: 'Kim', phone: '010-1234-5678', extra: 'ignored' },
    { id: 2, name: 'Lee', phone: null, extra: 'ignored' },
  ];

  it('uses the union of keys of object rows', () => {
    expect(stringify([{ a: 1 }, { b: 2 }, { a: 3, c: 4 }], { bom: false })).toBe('a,b,c\r\n1,,\r\n,2,\r\n3,,4\r\n');
  });

  it('accepts a list of keys', () => {
    expect(stringify(users, { columns: ['name', 'id'], bom: false })).toBe('name,id\r\nKim,1\r\nLee,2\r\n');
  });

  it('accepts a { key: header } map', () => {
    expect(stringify(users, { columns: { name: '이름', phone: '전화번호' }, bom: false })).toBe(
      '이름,전화번호\r\nKim,"=""010-1234-5678"""\r\nLee,\r\n',
    );
  });

  it('accepts column definitions', () => {
    const csv = stringify(users, {
      bom: false,
      columns: [
        { key: 'id', header: 'ID', type: 'text' },
        { header: 'Label', value: (user, index) => `${index}:${user.name}` },
        { key: 'missing' },
      ],
    });
    expect(csv).toBe('"ID",Label,missing\r\n"=""1""",0:Kim,\r\n"=""2""",1:Lee,\r\n');
  });

  it('reads array rows by index', () => {
    expect(stringify([['a', 'b', 'c']], { columns: [2, { key: 0, header: 'first' }], bom: false })).toBe('"=""2""",first\r\nc,a\r\n');
  });

  it('writes a header for array rows only when columns are given', () => {
    expect(stringify([[1]], { columns: [0], header: false, bom: false })).toBe('1\r\n');
    expect(stringify([[1]], { columns: [{ key: 0, header: 'n' }], bom: false })).toBe('n\r\n1\r\n');
  });

  it('protects header cells too', () => {
    expect(stringify([], { columns: { a: '=cmd', b: '2024', c: 'ok' }, bom: false })).toBe('"=""=cmd""","=""2024""",ok\r\n');
  });

  it('applies the default type to every column', () => {
    expect(stringify([{ a: 1, b: 'x' }], { type: 'text', bom: false })).toBe('a,b\r\n"=""1""",x\r\n');
    expect(stringify([[1, '007']], { type: 'text', bom: false })).toBe('"=""1""","=""007"""\r\n');
    expect(stringify([{ a: '007' }], { columns: ['a', { key: 'a', header: 'b', type: 'raw' }], type: 'text', bom: false })).toBe(
      'a,b\r\n"=""007""",007\r\n',
    );
    expect(stringify([{ a: '007' }], { columns: { a: 'A' }, type: 'raw', bom: false })).toBe('A\r\n007\r\n');
  });

  it('reports errors thrown by accessors', () => {
    const error = errorOf(() =>
      stringify([{}], {
        columns: [
          {
            header: 'x',
            value: () => {
              throw new Error('boom');
            },
          },
        ],
      }),
    );
    expect(error.code).toBe('INVALID_VALUE');
    expect(error.row).toBe(0);
    expect(error.column).toBe('x');
    expect((error.cause as Error).message).toBe('boom');
  });

  it('reports the row and column of invalid values', () => {
    const error = errorOf(() => stringify([{ a: 1 }, { a: () => 1 }]));
    expect(error.code).toBe('INVALID_VALUE');
    expect(error.row).toBe(1);
    expect(error.column).toBe('a');
    expect(error.message).toBe('Cannot write a function to a cell (row 1, column "a")');
  });

  it('requires a header for value columns', () => {
    const error = errorOf(() => stringify([{}], { columns: [{ value: () => 1 }] }));
    expect(error.code).toBe('INVALID_OPTION');
    expect(stringify([{}], { columns: [{ value: () => 1 }], header: false, bom: false })).toBe('1\r\n');
    const unnamed = errorOf(() => stringify([{}], { columns: [{ value: () => () => 1 }], header: false }));
    expect(unnamed.column).toBe(0);
  });

  it('rejects mixed rows', () => {
    expect(errorOf(() => stringify([[1], { a: 1 }] as never)).code).toBe('INVALID_ROW');
    expect(errorOf(() => stringify([{ a: 1 }, [1]] as never)).code).toBe('INVALID_ROW');
  });

  it('rejects a header for array rows without columns', () => {
    const error = errorOf(() => stringify([[1]], { header: true }));
    expect(error.code).toBe('INVALID_OPTION');
    expect(error.message).toMatch(/pass "columns"/);
  });

  it.each([
    [{ columns: 'a' }, /"columns"/],
    [{ columns: null }, /"columns"/],
    [{ columns: [null] }, /"columns\[0\]"/],
    [{ columns: [[0]] }, /"columns\[0\]"/],
    [{ columns: [-1] }, /"columns\[0\]"/],
    [{ columns: [1.5] }, /"columns\[0\]"/],
    [{ columns: [{}] }, /"columns\[0\]\.key"/],
    [{ columns: [{ key: -1 }] }, /"columns\[0\]\.key"/],
    [{ columns: [{ key: true }] }, /"columns\[0\]\.key"/],
    [{ columns: [{ key: 'a', header: 1 }] }, /"columns\[0\]\.header"/],
    [{ columns: [{ key: 'a', type: 'date' }] }, /"columns\[0\]\.type"/],
    [{ columns: [{ key: 'a', value: () => 1 }] }, /either "key" or "value"/],
    [{ columns: [{ value: 'a' }] }, /"columns\[0\]\.value"/],
    [{ columns: { a: 1 } }, /"columns\.a"/],
    [{ type: 'x' }, /"type"/],
  ])('rejects invalid columns %o', (options, message) => {
    const error = errorOf(() => stringify([], options as never));
    expect(error.code).toBe('INVALID_OPTION');
    expect(error.message).toMatch(message);
  });
});

describe('stringify: output format', () => {
  it('supports other delimiters', () => {
    expect(stringify([['a;b', 'c', 1.5]], { delimiter: ';', decimalSeparator: ',', bom: false })).toBe('"a;b";c;1,5\r\n');
    expect(stringify([['a\tb', 'c']], { delimiter: '\t', bom: false })).toBe('"a\tb"\tc\r\n');
    expect(stringify([['a|b', 'c']], { delimiter: '|', bom: false })).toBe('"a|b"|c\r\n');
    expect(stringify([['a^b', 'c']], { delimiter: '^', bom: false })).toBe('"a^b"^c\r\n');
    expect(stringify([['a]b', 'c']], { delimiter: ']', bom: false })).toBe('"a]b"]c\r\n');
    expect(stringify([['a\\b', 'c']], { delimiter: '\\', bom: false })).toBe('"a\\b"\\c\r\n');
    expect(stringify([['a-b', 'c']], { delimiter: '-', bom: false })).toBe('"a-b"-c\r\n');
  });

  it('quotes decimal commas when the delimiter is a comma', () => {
    expect(stringify([[1.5]], { decimalSeparator: ',', bom: false })).toBe('"1,5"\r\n');
  });

  it('supports LF newlines', () => {
    expect(stringify([[1], [2]], { newline: '\n', bom: false })).toBe('1\n2\n');
  });

  it('quotes fields only when needed', () => {
    expect(stringify([['a"b', 'c,d', 'e\nf', 'g\rh', ' i', 'j ', '\tk', 'plain']], { bom: false })).toBe(
      '"a""b","c,d","e\nf","g\rh"," i","j ","=""\tk""",plain\r\n',
    );
  });

  it('quote: "always" quotes every field', () => {
    expect(stringify([['a', '', null, 1]], { quote: 'always', bom: false })).toBe('"a","","","1"\r\n');
  });

  it('writes a sep= hint', () => {
    expect(stringify([[1]], { sepHint: true })).toBe(`${BOM}sep=,\r\n1\r\n`);
    expect(stringify([[1]], { sepHint: true, delimiter: ';', bom: false, newline: '\n' })).toBe('sep=;\n1\n');
    expect(stringify([], { sepHint: true, bom: false })).toBe('sep=,\r\n');
  });

  it('quotes a first field that Excel would misread as SYLK or a sep= line', () => {
    expect(stringify([{ ID: 1 }], { bom: false })).toBe('"ID"\r\n1\r\n');
    expect(stringify([['IDENT', 'ID']], { bom: false })).toBe('"IDENT",ID\r\n');
    expect(stringify([['sep=;', 'sep=;']], { bom: false })).toBe('"sep=;",sep=;\r\n');
    expect(stringify([['SEP=x']], { bom: false })).toBe('"SEP=x"\r\n');
    expect(stringify([['id']], { bom: false })).toBe('id\r\n');
    expect(stringify([[''], ['ID']], { bom: false })).toBe('\r\nID\r\n');
    expect(stringify([['\uFEFFx', 'y']], { bom: false })).toBe('"\uFEFFx",y\r\n');
    expect(stringify([['Id', 'sEp=1']], { bom: false })).toBe('Id,sEp=1\r\n');
    expect(stringify([['sEp=1']], { bom: false })).toBe('"sEp=1"\r\n');
  });

  it.each([
    [{ delimiter: '' }, /"delimiter"/],
    [{ delimiter: ',,' }, /"delimiter"/],
    [{ delimiter: '"' }, /"delimiter"/],
    [{ delimiter: '\n' }, /"delimiter"/],
    [{ delimiter: '\r' }, /"delimiter"/],
    [{ delimiter: 1 }, /"delimiter"/],
    [{ newline: '\r' }, /"newline"/],
    [{ bom: 'yes' }, /"bom"/],
    [{ header: 1 }, /"header"/],
    [{ sepHint: 1 }, /"sepHint"/],
    [{ quote: 'never' }, /"quote"/],
    [{ protect: 'x' }, /"protect"/],
  ])('rejects %o', (options, message) => {
    expect(() => stringify([], options as never)).toThrow(message);
  });

  it('rejects non-object options', () => {
    expect(() => stringify([], 5 as never)).toThrow(/"options"/);
  });
});

describe('stringify: Excel limits', () => {
  it('rejects more than 16,384 columns', () => {
    const wide = Array.from({ length: MAX_COLUMNS + 1 }, () => 1);
    expect(stringify([wide.slice(1)], { bom: false })).toHaveLength(MAX_COLUMNS * 2 + 1);
    const error = errorOf(() => stringify([wide]));
    expect(error.code).toBe('TOO_MANY_COLUMNS');
    expect(error.row).toBe(0);
    expect(stringify([wide], { limits: 'ignore', bom: false })).toHaveLength((MAX_COLUMNS + 1) * 2 + 1);
    const columns = Array.from({ length: MAX_COLUMNS + 1 }, (_, i) => i);
    expect(errorOf(() => stringify([], { columns })).code).toBe('TOO_MANY_COLUMNS');
    expect(stringify([], { columns, limits: 'ignore', header: false, bom: false })).toBe('');
    const keys = Object.fromEntries(columns.map((i) => [`k${i}`, 1]));
    const headerError = errorOf(() => stringify([keys]));
    expect(headerError.code).toBe('TOO_MANY_COLUMNS');
    expect(headerError.row).toBeUndefined();
  });

  it('rejects more than 1,048,576 rows (including the header)', () => {
    const writer = createWriter({ columns: ['a'] });
    writer.write({ a: 1 });
    for (let i = 2; i < MAX_ROWS; i++) writer.write({});
    expect(writer.rowCount).toBe(MAX_ROWS - 1);
    const error = errorOf(() => writer.write({}));
    expect(error.code).toBe('TOO_MANY_ROWS');
    expect(error.row).toBe(MAX_ROWS - 1);

    const noHeader = createWriter({ bom: false });
    for (let i = 0; i < MAX_ROWS; i++) noHeader.write([]);
    expect(errorOf(() => noHeader.write([])).code).toBe('TOO_MANY_ROWS');

    const unlimited = createWriter({ limits: 'ignore' });
    for (let i = 0; i <= MAX_ROWS; i++) unlimited.write([]);
    expect(unlimited.rowCount).toBe(MAX_ROWS + 1);
  }, 30_000);

  it('always fits an empty export with a header', () => {
    expect(createWriter({ columns: ['a'], limits: 'error' }).end()).toBe(`${BOM}a\r\n`);
  });
});

describe('createWriter', () => {
  it('writes the preamble with the first row', () => {
    const writer = createWriter({ columns: { a: 'A' } });
    expect(writer.rowCount).toBe(0);
    expect(writer.write({ a: 1 })).toBe(`${BOM}A\r\n1\r\n`);
    expect(writer.write({ a: 2 })).toBe('2\r\n');
    expect(writer.rowCount).toBe(2);
    expect(writer.end()).toBe('');
  });

  it('writes the preamble on end() when there were no rows', () => {
    expect(createWriter({ columns: ['a'], sepHint: true }).end()).toBe(`${BOM}sep=,\r\na\r\n`);
    expect(createWriter().end()).toBe(BOM);
    expect(createWriter({ header: true }).end()).toBe(BOM);
  });

  it('infers columns from the first object row', () => {
    const writer = createWriter({ bom: false });
    expect(writer.write({ a: 1, b: 2 })).toBe('a,b\r\n1,2\r\n');
    expect(writer.write({ b: 3 })).toBe(',3\r\n');
    const error = errorOf(() => writer.write({ a: 1, c: 3 }));
    expect(error.code).toBe('INVALID_ROW');
    expect(error.column).toBe('c');
    expect(errorOf(() => writer.write([1] as never)).code).toBe('INVALID_ROW');
  });

  it('ignores extra keys when columns are explicit', () => {
    const writer = createWriter({ columns: ['a'], bom: false });
    expect(writer.write({ a: 1, z: 2 })).toBe('a\r\n1\r\n');
    expect(writer.write([9] as never)).toBe('\r\n');
  });

  it('writes array rows', () => {
    const writer = createWriter({ bom: false });
    expect(writer.write([1, 2])).toBe('1,2\r\n');
    expect(errorOf(() => writer.write({ a: 1 } as never)).code).toBe('INVALID_ROW');
  });

  it('rejects use after end()', () => {
    const writer = createWriter();
    writer.end();
    expect(errorOf(() => writer.write([])).code).toBe('WRITER_CLOSED');
    expect(errorOf(() => writer.end()).code).toBe('WRITER_CLOSED');
  });

  it('rejects invalid rows', () => {
    const writer = createWriter();
    expect(errorOf(() => writer.write('a' as never)).code).toBe('INVALID_ROW');
    writer.write([1]);
    expect(errorOf(() => writer.write(undefined as never)).code).toBe('INVALID_ROW');
  });

  it('leaves the writer unchanged when a row throws', () => {
    const writer = createWriter({ bom: false });
    expect(errorOf(() => writer.write({ a: () => 1 })).code).toBe('INVALID_VALUE');
    expect(writer.rowCount).toBe(0);
    // The failed first row did not fix the columns, and the header is still written.
    expect(writer.write({ b: 1 })).toBe('b\r\n1\r\n');
    expect(errorOf(() => writer.write({ b: 2, c: 3 })).code).toBe('INVALID_ROW');
    expect(writer.write({ b: 3 })).toBe('3\r\n');
    expect(writer.rowCount).toBe(2);

    const headerless = createWriter({ columns: [{ header: 'x', value: (r: { v: unknown }) => r.v }], bom: false, sepHint: true });
    expect(errorOf(() => headerless.write({ v: () => 1 })).code).toBe('INVALID_VALUE');
    expect(headerless.write({ v: 1 })).toBe('sep=,\r\nx\r\n1\r\n');
  });

  it('validates options eagerly', () => {
    expect(() => createWriter({ delimiter: '"' })).toThrow(CsvError);
  });
});
