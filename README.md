# excel-safe-csv

**Write CSV files that Excel can't mangle, and read the CSV files Excel produces.**

[![npm](https://img.shields.io/npm/v/excel-safe-csv.svg)](https://www.npmjs.com/package/excel-safe-csv)
[![CI](https://github.com/fillddak/module/actions/workflows/ci.yml/badge.svg)](https://github.com/fillddak/module/actions/workflows/ci.yml)
![zero dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)
![types](https://img.shields.io/badge/types-TypeScript-blue)
[![license](https://img.shields.io/npm/l/excel-safe-csv.svg)](./LICENSE)

[한국어 문서 (Korean)](./README.ko.md)

Every "Export to CSV" button runs into the same problems when the file is opened in Excel:

| Your data                        | What Excel shows                        | With excel-safe-csv |
| -------------------------------- | --------------------------------------- | -------------- |
| `007` (zip code, employee ID)    | `7`                                     | `007`          |
| `1234567890123456789` (order ID) | `1.23457E+18` (digits lost for good)    | `1234567890123456789` |
| `MARCH1`, `SEPT2` (gene names)   | `1-Mar`, `2-Sep`                        | `MARCH1`, `SEPT2` |
| `1/2`, `2024-01`                 | `2-Jan`, `Jan-24`                       | `1/2`, `2024-01` |
| `1E5` (part number)              | `1.00E+05`                              | `1E5`          |
| `=HYPERLINK("http://evil…")`     | a live link (**CSV injection**)         | the text, inert |
| `김철수`, `café` without a BOM    | `ê¹€ì² ìˆ˜`, `cafÃ©`                     | `김철수`, `café` |

excel-safe-csv fixes all of these, **without changing your data**: what you write is exactly what Excel
shows. It also reads CSV files saved by Excel (UTF-8, UTF-16, the legacy Korean/Japanese/Chinese/Western
code pages, `sep=` lines) so user uploads just work.

- **Lossless**: every string is displayed verbatim; nothing is truncated, rounded, or prefixed.
- **Safe**: formulas in untrusted data can never run ([OWASP CSV injection](https://owasp.org/www-community/attacks/CSV_Injection)).
- **Typed**: numbers stay numbers, dates stay real dates, booleans stay booleans.
- **Everywhere**: Node.js ≥ 18, browsers, Deno, Bun, Cloudflare Workers. ESM and CommonJS. Zero dependencies, ~16 kB gzipped.
- **Streaming**: millions of rows from a database cursor into an HTTP response.
- **Verified**: 270 tests, 100% coverage, property-based tests, and end-to-end tests that open the output in a real spreadsheet engine.

## Contents

- [Install](#install)
- [Quick start](#quick-start)
- [Recipes](#recipes): browser download · Node.js / Express · Fetch `Response` (Next.js, Hono, Bun, Deno, Workers) · reading uploads · European Excel · other CSV libraries
- [How it works](#how-it-works)
- [API](#api)
- [Options](#options)
- [Command line](#command-line)
- [Compatibility](#compatibility)
- [FAQ](#faq)
- [How it is tested](#how-it-is-tested)

## Install

```sh
npm install excel-safe-csv
# pnpm add excel-safe-csv · yarn add excel-safe-csv · bun add excel-safe-csv · deno add npm:excel-safe-csv
```

## Quick start

```js
import { stringify } from 'excel-safe-csv';

const csv = stringify(
  [
    {
      name: 'Kim Minji',
      phone: '010-1234-5678',
      zip: '02134',
      orderId: 1234567890123456789n,
      total: 42000,
      paidAt: new Date('2024-03-01T05:30:00Z'),
    },
  ],
  { timeZone: 'Asia/Seoul' },
);
```

```text
﻿name,phone,zip,orderId,total,paidAt
Kim Minji,"=""010-1234-5678""","=""02134""","=""1234567890123456789""",42000,2024-03-01 14:30:00
```

Opened in Excel: `010-1234-5678`, `02134` and `1234567890123456789` are shown exactly as written,
`42000` is a number you can sum, and `2024-03-01 14:30:00` is a real date. The leading `﻿`
(byte order mark) makes Excel read the file as UTF-8.

Choose and rename columns with an object:

```js
stringify(users, { columns: { name: '이름', phone: '전화번호', memo: '메모' } });
```

Read a CSV file that Excel saved, in any encoding:

```js
import { parseObjects } from 'excel-safe-csv';

const rows = parseObjects(await file.arrayBuffer(), { fallbackEncoding: 'cp949' });
// [{ 이름: '김민지', 전화번호: '010-1234-5678', ... }]
```

## Recipes

### Download button in the browser

```js
import { stringify } from 'excel-safe-csv';

function downloadCsv(rows, filename) {
  const blob = new Blob([stringify(rows)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = Object.assign(document.createElement('a'), { href: url, download: filename });
  link.click();
  URL.revokeObjectURL(url);
}
```

### Node.js: files and Express

```js
import { writeFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import { encode, stringify, stringifyAsync } from 'excel-safe-csv';

// A file
writeFileSync('report.csv', encode(stringify(rows)));

// A large export, streamed row by row (arrays, generators, async iterables, DB cursors)
app.get('/export.csv', (req, res) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="export.csv"');
  Readable.from(stringifyAsync(db.streamOrders(), { columns: ['id', 'customer', 'total'] })).pipe(res);
});
```

### Fetch `Response`: Next.js, Remix, Hono, Bun, Deno, Cloudflare Workers

```js
import { stringifyStream } from 'excel-safe-csv';

export async function GET() {
  return new Response(stringifyStream(await getOrders()), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="orders.csv"',
    },
  });
}
```

### Reading uploads

`parse` and `parseObjects` accept a string, `Uint8Array`, `Buffer`, `ArrayBuffer` or any typed array.
The encoding is detected from the byte order mark, then UTF-8, then `fallbackEncoding`: the "ANSI" code
page Excel used when it saved the file.

```js
import { parse, parseObjects } from 'excel-safe-csv';

parse(bytes, { fallbackEncoding: 'cp949' }); // Korea: CP949 / EUC-KR
parse(bytes, { fallbackEncoding: 'shift_jis' }); // Japan
parse(bytes, { fallbackEncoding: ['gbk', 'big5'] }); // tried in order
parse(bytes); // default fallback: windows-1252 (Western Europe, Americas)
```

The delimiter (`,` `;` tab `|`) is detected automatically, `sep=` lines are honored, and `="…"` cells
written by excel-safe-csv (or other exporters) are turned back into their text.
Values always come back as strings; nothing is converted.

Legacy encodings rely on the runtime's `TextDecoder`: Node.js, browsers and Deno support all
[WHATWG encodings](https://encoding.spec.whatwg.org/#names-and-labels); Bun supports the common ones
(including CP949, Shift_JIS, GBK, Big5 and Windows-1252). An unsupported label throws a `CsvError`
with code `INVALID_OPTION`.

> Node.js's built-in `TextDecoder('euc-kr')` does not implement the 8,822 extra Hangul syllables of
> CP949 (such as `똠` or `햏`) that Korean Excel writes. excel-safe-csv detects this and uses its own
> WHATWG-conformant decoder, so Korean text decodes correctly on every runtime.

### European Excel (semicolons and decimal commas)

Excel in most of Europe expects `;` between fields and `,` as the decimal separator:

```js
stringify(rows, {
  delimiter: ';',
  decimalSeparator: ',',
  booleans: ['WAHR', 'FALSCH'], // Excel shows booleans in the user's language
});
// product;price;date
// Kaffee;3,5;2024-01-31
```

Alternatively, `stringifyStream(rows, { delimiter: '\t', encoding: 'utf-16le' })` produces Excel's
"Unicode Text" format, which opens correctly in every locale.

### Making another CSV library Excel-safe

Already using Papa Parse, csv-stringify or fast-csv? Run each value through `formatCell`:

```js
import { formatCell } from 'excel-safe-csv';
import { stringify } from 'csv-stringify/sync';

stringify(records, { cast: { string: (value) => formatCell(value) } });
Papa.unparse(records.map((record) => record.map((value) => formatCell(value))));
```

## How it works

**Strings stay strings, numbers stay numbers.** excel-safe-csv writes each value so Excel shows it as
its JavaScript type:

| Value                           | Written as                                  | Excel shows                |
| ------------------------------- | ------------------------------------------- | -------------------------- |
| string Excel would not change   | as is: `Hello`                              | `Hello` (text)             |
| string Excel would change       | a text formula: `="007"`                    | `007` (text)               |
| string that looks like a formula | a text formula: `="=1+1"`                  | `=1+1` (text, never runs)  |
| `number`, `bigint`              | as is: `42`, `-1.5`, `1E+21`                | a number                   |
| integer with more than 15 digits | text: `="1234567890123456789"`             | every digit (Excel keeps only 15) |
| `Date`                          | `2024-01-31 13:45:00` in `timeZone`         | a date                     |
| `boolean`                       | `TRUE` / `FALSE`                            | a boolean                  |
| `null`, `undefined`             | empty                                       | an empty cell              |
| array, plain object             | JSON: `[1,2]`                               | text                       |
| other objects                   | `String(value)` (e.g. `URL`, `Decimal`)     | text                       |

A string is protected only if Excel might change it. The check (`wouldExcelConvert`) covers numbers
in every notation, percentages, fractions, currency amounts, dates and times in any format, month and
weekday names in the 60+ locales Excel ships in (generated from Unicode CLDR), booleans in any
language, and error values like `#N/A`. It is deliberately conservative: when in doubt, the value is
protected, because protecting a string never changes what Excel displays.

Why `="007"`? It is a formula whose result is the text `007`. Excel and Google Sheets display exactly
`007`, sort and filter it as text, and never run anything. Strings longer than 255 characters are
split into `="…"&"…"` (Excel's limit per literal), line breaks become `CHAR(10)`, and quotes are
escaped, so any text round-trips. Other strategies are available through the `protect` option.

Also handled automatically:

- a UTF-8 byte order mark so Excel detects UTF-8 (`bom`);
- quoting of fields with delimiters, quotes, line breaks or surrounding whitespace;
- a first cell starting with `ID`, which makes Excel think the file is SYLK and refuse to open it;
- Excel's hard limits: 32,767 characters per cell, 16,384 columns, 1,048,576 rows (`limits`);
- dates Excel cannot represent (before 1900 or after 9999), written as ISO text.

## API

All functions are named exports. Every error thrown is a [`CsvError`](#csverror).

### `stringify(rows, options?)`

Converts an array (or any iterable) of objects or arrays to a CSV string.

```js
stringify([{ a: 1, b: 'x' }]); // '﻿a,b\r\n1,x\r\n'
stringify([[1, 'x'], [2, 'y']]); // '﻿1,x\r\n2,y\r\n' (array rows: no header by default)
```

Without `columns`, object rows are written with the union of their keys, in order of first appearance.

### `createWriter(options?)`

Formats rows one at a time. `write(row)` returns the text for that row (the first call also returns
the BOM and header); `end()` returns the header if no row was written, so empty exports still have
one. `rowCount` is the number of rows written.

```js
const writer = createWriter({ columns: ['id', 'name'] });
let csv = '';
for (const user of users) csv += writer.write(user);
csv += writer.end();
```

Without `columns`, columns come from the first row; a later row with an unknown key throws instead of
silently dropping data. A row that throws leaves the writer unchanged, so you may skip it and go on.

### `stringifyAsync(rows, options?)`

Returns an `AsyncGenerator<string>` of chunks (about 64 KB each) from an iterable or async iterable of
rows. Use `Readable.from(...)` to get a Node.js stream.

### `stringifyStream(rows, options?)`

Returns a web `ReadableStream<Uint8Array>`, ready to be a `Response` body. Accepts
`encoding: 'utf-8' | 'utf-16le'` (default `'utf-8'`).

### `formatCell(value, options?)`

Returns the protected text for a single cell, **without** CSV quoting. Accepts the
[cell options](#cell-options) and `type`.

```js
formatCell('007'); // '="007"'
formatCell('=1+1'); // '="=1+1"'
formatCell(42); // '42'
formatCell(1234567890123456789n); // '="1234567890123456789"'
formatCell(new Date(Date.UTC(2024, 0, 31)), { timeZone: 'UTC' }); // '2024-01-31 00:00:00'
```

### `parse(input, options?)`

Parses CSV text or bytes into `string[][]`. Follows RFC 4180 and recovers from malformed input the way
Excel does (text after a closing quote is kept, a quote inside an unquoted field is literal, an
unterminated quote runs to the end). Pass `strict: true` to throw instead.

```js
parse('﻿sep=;\r\nname;zip\r\nKim;"=""02134"""\r\n'); // [['name', 'zip'], ['Kim', '02134']]
```

| Option             | Default          | Description |
| ------------------ | ---------------- | ----------- |
| `delimiter`        | `'auto'`         | `'auto'` detects `,` `;` tab or `|`; a `sep=` line always wins. |
| `encoding`         | `'auto'`         | Encoding of byte input. Any [WHATWG label](https://encoding.spec.whatwg.org/#names-and-labels), plus `cp949`, `ms949`, `uhc`, `cp932`, `cp936`, `cp950`. A byte order mark takes precedence. |
| `fallbackEncoding` | `'windows-1252'` | Encoding(s) tried in order when the bytes are not valid UTF-8. |
| `unwrapFormulas`   | `true`           | Turn `="007"` back into `007`. |
| `skipEmptyLines`   | `false`          | Skip completely empty lines. |
| `strict`           | `false`          | Throw `PARSE_ERROR` (with `line`) on malformed input. |

### `parseObjects(input, options?)`

Like `parse`, but returns objects keyed by the header row. Duplicate names get a suffix (`name`,
`name_2`); missing cells become `''`; extra cells are named `column_<n>`. Accepts `headers` to supply
the names yourself (the first row is then data). With `strict: true`, rows whose length differs from
the header throw.

```js
parseObjects('name,zip\r\nKim,"=""02134"""\r\n'); // [{ name: 'Kim', zip: '02134' }]
```

### `decode(bytes, options?)` and `encode(text, encoding?)`

`decode` returns `{ text, encoding, bom }` using the same detection as `parse`.
`encode` turns text into `utf-8` (default) or `utf-16le` bytes; a leading `﻿` becomes the right BOM.

```js
decode(bytes, { fallbackEncoding: 'cp949' }); // { text: '한글', encoding: 'euc-kr', bom: false }
fs.writeFileSync('report.txt', encode(stringify(rows, { delimiter: '\t' }), 'utf-16le'));
```

### `wouldExcelConvert(text)` and `isFormulaLike(text)`

The two checks behind the protection, exported for your own use.

```js
wouldExcelConvert('007'); // true
wouldExcelConvert('3월 1일'); // true
wouldExcelConvert('Hello'); // false
isFormulaLike('=1+1'); // true
isFormulaLike('-5'); // true (a leading - starts a formula in Excel)
```

### `CsvError`

`error.code` is one of `INVALID_OPTION`, `INVALID_ROW`, `INVALID_VALUE`, `FORMULA_REJECTED`,
`CELL_TOO_LONG`, `TOO_MANY_COLUMNS`, `TOO_MANY_ROWS`, `PARSE_ERROR`, `WRITER_CLOSED`. Where relevant,
`error.row` (zero-based data row), `error.column` (key or index), `error.line` (one-based, parse
errors) and `error.cause` tell you exactly what failed.

```js
try {
  stringify(rows);
} catch (error) {
  if (error instanceof CsvError && error.code === 'CELL_TOO_LONG') console.log(error.row, error.column);
}
```

### Constants

`MAX_ROWS` (1,048,576), `MAX_COLUMNS` (16,384), `MAX_CELL_LENGTH` (32,767).

## Options

### Output options

For `stringify`, `createWriter`, `stringifyAsync` and `stringifyStream`.

| Option      | Default    | Description |
| ----------- | ---------- | ----------- |
| `columns`   | from rows  | Array of keys / [column definitions](#columns), or `{ key: 'Header' }`. |
| `header`    | `true`\*   | Write a header row. \*`false` for array rows without `columns`. |
| `type`      | `'auto'`   | Default [column type](#column-types) for all columns. |
| `delimiter` | `','`      | Any single character except `"`, CR and LF. |
| `newline`   | `'\r\n'`   | `'\r\n'` or `'\n'`. |
| `bom`       | `true`     | Start with a UTF-8 byte order mark. Required for Excel to read non-ASCII text correctly. |
| `sepHint`   | `false`    | Write a `sep=,` first line so Excel uses the delimiter in any locale. Excel may then ignore the BOM, so use it for ASCII data or with `encoding: 'utf-16le'`. |
| `quote`     | `'auto'`   | `'always'` quotes every field. |

### Cell options

Also accepted by `formatCell`.

| Option             | Default        | Description |
| ------------------ | -------------- | ----------- |
| `protect`          | `'formula'`    | How to keep a value as text: `'formula'` (`="007"`, lossless), `'tab'` (a leading tab, which becomes part of the value), `'none'`. With `'tab'` and `'none'`, formula-like values get a leading `'` instead. |
| `formulas`         | `'neutralize'` | Values starting with `=` `+` `-` `@`, tab or CR: `'neutralize'` (shown, never run), `'allow'` (write strings starting with `=` as live formulas; **trusted data only**), `'throw'` (`FORMULA_REJECTED`). |
| `decimalSeparator` | `'.'`          | `','` for most European locales. |
| `dateFormat`       | `'datetime'`   | `'datetime'` (`2024-01-31 13:45:00`), `'date'` (`2024-01-31`): real Excel dates. `'iso'` (`2024-01-31T04:45:00.000Z`) or a `(date) => string` function: text. |
| `timeZone`         | `'local'`      | `'local'`, `'UTC'`, or an IANA name like `'Asia/Seoul'`. |
| `booleans`         | Excel booleans | Text for `true` / `false`, e.g. `['Yes', 'No']` or `['예', '아니오']`. |
| `largeNumbers`     | `'text'`       | Integers with more than 15 significant digits: `'text'` keeps every digit, `'number'` lets Excel round. |
| `limits`           | `'error'`      | Excel's limits: `'error'` throws, `'truncate'` shortens long cells (too many rows/columns still throw), `'ignore'`. |

### Columns

```js
stringify(orders, {
  columns: [
    'id', // a key
    { key: 'customer', header: 'Customer' }, // a key with a header
    { key: 'account', header: 'Account', type: 'text' }, // a key with a type
    { header: 'Total', value: (order) => order.price * order.quantity }, // a computed value
    { key: 0, header: 'First' }, // array rows: an index
  ],
});
```

### Column types

| Type       | Behavior |
| ---------- | -------- |
| `'auto'`   | The default: the table in [How it works](#how-it-works). |
| `'text'`   | Every value, including numbers and dates, is written as text shown exactly as formatted. For IDs, account numbers, postal codes. |
| `'number'` | Like `'auto'`, but strings in plain decimal notation (`'1234.50'`, `'-7'`, `'1e3'`) are written as numbers. For database `DECIMAL` columns that arrive as strings. |
| `'raw'`    | No protection at all, only CSV quoting. **Unsafe with untrusted data.** For your own formulas. |

```js
stringify([{ account: 12345, price: '1234.50', formula: '=SUM(B2:B9)' }], {
  columns: [
    { key: 'account', type: 'text' }, // ="12345"
    { key: 'price', type: 'number' }, // 1234.50
    { key: 'formula', type: 'raw' }, // =SUM(B2:B9)
  ],
});
```

Header cells are always protected like `'auto'` strings.

## Command line

```sh
npx excel-safe-csv fix export.csv -o export-for-excel.csv         # make an existing CSV safe to open in Excel
npx excel-safe-csv from-json users.json -o users.csv              # JSON array → Excel-safe CSV
npx excel-safe-csv clean upload.csv --fallback-encoding cp949 > clean.csv   # Excel CSV → plain UTF-8
```

`fix` keeps plain numbers such as `42` or `-1.5` as numbers (Excel shows them unchanged) and protects
everything else; `--text` protects numbers too. Run `npx excel-safe-csv --help` for all options
(`--delimiter`, `--encoding utf-16le`, `--no-bom`, `--protect`, `--formulas`, `--time-zone`, …).

## Compatibility

| Environment | Support |
| ----------- | ------- |
| Node.js | 18, 20, 22, 24 and later (tested on 18, 20, 21, 22) |
| Browsers | All modern browsers (tested in Chromium) |
| Deno, Bun | Yes (tested on Bun) |
| Edge runtimes | Cloudflare Workers, Vercel Edge and other runtimes with `TextDecoder` and `ReadableStream` |
| Modules | ESM and CommonJS, with TypeScript declarations for both |

How spreadsheet applications display protected (`="…"`) cells:

| Application | Result |
| ----------- | ------ |
| Microsoft Excel (Windows, Mac, web) | Exact text |
| Google Sheets | Exact text |
| LibreOffice Calc | Exact text with its default CSV settings (verified with LibreOffice 24.2 in the test suite). If "Evaluate formulas" is turned off in the import dialog, cells show `="007"`. |
| Programs reading the CSV | `="007"`: use `parse()` or `excel-safe-csv clean` to get `007` back, or `protect: 'tab'` / `'none'` if the file is not meant for spreadsheets. |

## FAQ

**Excel shows a small green triangle on some cells.**
That is Excel's "Number stored as text" hint on protected values like `007`. It is expected and
harmless; the value is exactly what you exported.

**The formula bar shows `="007"`.**
Yes: that is how the text is kept safe from conversion. Copying the cell, sorting and filtering all use
the text `007`.

**I want a column to be real numbers.**
Pass numbers instead of strings, or use `type: 'number'` for columns of numeric strings.

**Why not generate `.xlsx` instead?**
When you can, do! But CSV needs no dependencies, streams with constant memory, opens in every
program, and is often required by the people or systems receiving the file. excel-safe-csv makes CSV as
reliable as it can be.

**Does protection change the data for other programs?**
Only the protected cells, and only in a reversible way: `parse()` returns the original text. Use
`protect: 'tab'` or `'none'` if the file is primarily for programs rather than spreadsheets.

**Is `formulas: 'allow'` safe?**
Only with data you fully control. With untrusted input, a cell like `=HYPERLINK(...)` becomes a live
link that can leak data or phish users. The default `'neutralize'` is always safe.

## How it is tested

- **270 unit and integration tests**, 100% line, branch, function and statement coverage.
- **Property-based tests** ([fast-check](https://fast-check.dev)) with tens of thousands of random
  tables: every value written is read back identically, under every combination of delimiter,
  newline, BOM, quoting and `sep=` options; no written cell can ever execute; the parser never throws
  on arbitrary input.
- **Locale coverage**: numbers, currencies, dates and times formatted by `Intl` in 60+ locales must all
  be detected.
- **A real spreadsheet engine**: LibreOffice Calc opens the output with formula evaluation and special
  number detection enabled; hundreds of tricky and random values must display verbatim, numbers and
  dates must stay native, and a control run confirms the same values are mangled without protection.
- **CP949 ground truth**: the Korean decoder is checked against a SHA-256 of the WHATWG index and
  against a WHATWG-conformant runtime on random byte sequences.
- **Runtimes**: Node.js 18, 20, 22 (full suite), 21 and Bun (smoke tests), Chromium (smoke tests),
  plus CommonJS/ESM entry points, [publint](https://publint.dev) and
  [Are the types wrong?](https://arethetypeswrong.github.io).

```sh
npm test                 # unit, property, CLI and (if LibreOffice is installed) spreadsheet tests
npm run test:coverage    # with the 100% coverage gate
npm run check            # typecheck + coverage + build + smoke tests + package lint
```

## License

[MIT](./LICENSE)
