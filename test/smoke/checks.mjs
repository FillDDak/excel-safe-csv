// Runtime checks shared by the ESM, CommonJS, Bun and browser smoke tests.
// They exercise the built files in dist/, not the TypeScript sources.
export async function runChecks(lib, assert) {
  const { stringify, parse, parseObjects, formatCell, createWriter, stringifyAsync, stringifyStream, encode, decode } = lib;
  const BOM = '﻿';

  assert.equal(stringify([{ zip: '02134', n: 1.5 }]), `${BOM}zip,n\r\n"=""02134""",1.5\r\n`);
  assert.equal(formatCell('=1+1'), '="=1+1"');
  assert.equal(formatCell(12345678901234567890n), '="12345678901234567890"');
  assert.equal(formatCell(new Date(Date.UTC(2024, 0, 31, 4, 45)), { timeZone: 'Asia/Seoul' }), '2024-01-31 13:45:00');
  assert.equal(lib.wouldExcelConvert('MARCH1'), true);
  assert.equal(lib.isFormulaLike('@x'), true);

  assert.deepEqual(parse('sep=;\r\na;"=""007"""\r\n'), [['a', '007']]);
  assert.deepEqual(parseObjects('a,b\n1,2'), [{ a: '1', b: '2' }]);

  const writer = createWriter({ columns: ['a'], bom: false });
  assert.equal(writer.write({ a: 1 }) + writer.end(), 'a\r\n1\r\n');

  let text = '';
  for await (const chunk of stringifyAsync([[1], [2]], { bom: false })) text += chunk;
  assert.equal(text, '1\r\n2\r\n');

  const bytes = new Uint8Array(await new Response(stringifyStream([['한', '07']], { encoding: 'utf-16le', delimiter: '\t' })).arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 2)], [0xff, 0xfe]);
  assert.deepEqual(parse(bytes), [['한', '07']]);

  assert.deepEqual(decode(encode(`${BOM}x`)), { text: 'x', encoding: 'utf-8', bom: true });
  // CP949, including a syllable outside EUC-KR ("똠"), as saved by Excel on Korean Windows.
  const cp949 = new Uint8Array([0xc7, 0xd1, 0xb1, 0xdb, 0x2c, 0x8c, 0x63]);
  assert.deepEqual(decode(cp949, { fallbackEncoding: 'cp949' }), { text: '한글,똠', encoding: 'euc-kr', bom: false });

  assert.throws(() => stringify([], { delimiter: '"' }), (error) => error instanceof lib.CsvError && error.code === 'INVALID_OPTION');
  return true;
}
