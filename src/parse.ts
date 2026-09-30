import { decode, type BinaryInput, type DecodeOptions } from './encoding';
import { CsvError, describe, invalidOption } from './errors';
import { unwrapTextFormula } from './formula';

/** Options for {@link parse}. */
export interface ParseOptions extends DecodeOptions {
  /**
   * Field delimiter, or `'auto'` to detect it from `,` `;` tab and `|`.
   * A `sep=` first line (written by Excel and by `sepHint: true`) always
   * wins over detection.
   * @default 'auto'
   */
  delimiter?: string;
  /**
   * Turn text formulas such as `="007"` (the protection written by
   * excel-csv and many other exporters) back into their text, `007`.
   * @default true
   */
  unwrapFormulas?: boolean;
  /** Skip lines that are completely empty. @default false */
  skipEmptyLines?: boolean;
  /**
   * Throw a {@link CsvError} (`PARSE_ERROR`) on malformed input instead of
   * recovering like Excel does: an unterminated quoted field, text after a
   * closing quote, or a quote inside an unquoted field.
   * @default false
   */
  strict?: boolean;
}

/** Options for {@link parseObjects}. */
export interface ParseObjectsOptions extends ParseOptions {
  /**
   * Column names to use. When given, the first row is treated as data rather
   * than as the header row.
   */
  headers?: readonly string[];
}

const CANDIDATES = [',', ';', '\t', '|'];
const SAMPLE_SIZE = 64 * 1024;
const SAMPLE_RECORDS = 50;

function lineOf(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) {
    const code = text.charCodeAt(i);
    if (code === 10 || (code === 13 && text.charCodeAt(i + 1) !== 10)) line++;
  }
  return line;
}

function parseError(text: string, index: number, message: string): CsvError {
  const line = lineOf(text, index);
  return new CsvError('PARSE_ERROR', `${message} (line ${line}).`, { line });
}

/** RFC 4180 parser with Excel's recovery rules. `limit` stops after that many records. */
function readRecords(text: string, delimiter: string, strict: boolean, limit = Infinity): string[][] {
  const records: string[][] = [];
  const n = text.length;
  if (n === 0) return records;
  const d = delimiter.charCodeAt(0);
  let row: string[] = [];
  let i = 0;
  for (;;) {
    let field: string;
    if (text.charCodeAt(i) === 34 /* " */) {
      field = '';
      let from = i + 1;
      for (;;) {
        const quote = text.indexOf('"', from);
        if (quote === -1) {
          if (strict) throw parseError(text, i, 'Unterminated quoted field');
          field += text.slice(from);
          i = n;
          break;
        }
        field += text.slice(from, quote);
        if (text.charCodeAt(quote + 1) === 34) {
          field += '"';
          from = quote + 2;
          continue;
        }
        i = quote + 1;
        break;
      }
      // Excel keeps any text between the closing quote and the next delimiter.
      let j = i;
      while (j < n) {
        const c = text.charCodeAt(j);
        if (c === d || c === 10 || c === 13) break;
        j++;
      }
      if (j > i) {
        if (strict) throw parseError(text, i, 'Unexpected text after a closing quote');
        field += text.slice(i, j);
        i = j;
      }
    } else {
      let j = i;
      while (j < n) {
        const c = text.charCodeAt(j);
        if (c === d || c === 10 || c === 13) break;
        j++;
      }
      field = text.slice(i, j);
      if (strict && field.includes('"')) throw parseError(text, i, 'Unexpected quote in an unquoted field');
      i = j;
    }
    row.push(field);
    if (i >= n) {
      records.push(row);
      break;
    }
    const c = text.charCodeAt(i);
    if (c === d) {
      i++;
      if (i >= n) {
        row.push('');
        records.push(row);
        break;
      }
      continue;
    }
    i += c === 13 && text.charCodeAt(i + 1) === 10 ? 2 : 1;
    records.push(row);
    if (i >= n || records.length >= limit) break;
    row = [];
  }
  return records;
}

/**
 * Picks the candidate delimiter that splits the first record (normally the
 * header) into at least two fields and gives the most following records the
 * same number of fields.
 */
function detectDelimiter(text: string): string {
  const truncated = text.length > SAMPLE_SIZE;
  const sample = truncated ? text.slice(0, SAMPLE_SIZE) : text;
  let best = ',';
  let bestScore = 0;
  for (const candidate of CANDIDATES) {
    const records = readRecords(sample, candidate, false, SAMPLE_RECORDS + 1);
    if (truncated || records.length > SAMPLE_RECORDS) records.pop(); // may be incomplete
    const counts = records.filter((r) => !(r.length === 1 && r[0] === '')).map((r) => r.length);
    const width = counts[0];
    if (width === undefined || width < 2) continue;
    const consistent = counts.filter((count) => count === width).length / counts.length;
    // Consistency first, then the number of columns.
    const score = consistent * 1e6 + width;
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

function toText(input: unknown, options: ParseOptions): string {
  if (typeof input === 'string') return input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  return decode(input as BinaryInput, options).text;
}

function assertOptions(options: unknown): ParseObjectsOptions {
  if (options === undefined) return {};
  if (options === null || typeof options !== 'object') throw invalidOption('options', 'an object', options);
  const o = options as Record<string, unknown>;
  for (const name of ['unwrapFormulas', 'skipEmptyLines', 'strict'] as const) {
    if (o[name] !== undefined && typeof o[name] !== 'boolean') throw invalidOption(name, 'a boolean', o[name]);
  }
  const { delimiter } = o;
  if (
    delimiter !== undefined &&
    delimiter !== 'auto' &&
    (typeof delimiter !== 'string' || delimiter.length !== 1 || delimiter === '"' || delimiter === '\r' || delimiter === '\n')
  ) {
    throw invalidOption('delimiter', '"auto" or a single character other than a double quote, CR or LF', delimiter);
  }
  return o as ParseObjectsOptions;
}

const SEP_LINE = /^sep=([^\r\n"])(?:\r\n|\n|\r|$)/i;

/**
 * Parses CSV text or bytes into rows of strings. Handles everything Excel
 * produces: UTF-8/UTF-16 byte order marks, legacy encodings such as CP949,
 * `sep=` lines, `,` `;` tab or `|` delimiters, CRLF/LF/CR line endings,
 * quoted fields spanning several lines, and `="..."` text formulas.
 *
 * Values are always returned as strings; nothing is converted.
 *
 * @example
 * parse('name,zip\r\nKim,"=""02134"""\r\n'); // [['name', 'zip'], ['Kim', '02134']]
 * parse(await file.arrayBuffer(), { fallbackEncoding: 'euc-kr' });
 */
export function parse(input: string | BinaryInput, options?: ParseOptions): string[][] {
  const o = assertOptions(options);
  let text = toText(input, o);
  let delimiter = o.delimiter ?? 'auto';
  const sep = SEP_LINE.exec(text);
  if (sep !== null) {
    if (delimiter === 'auto') delimiter = sep[1] as string;
    text = text.slice(sep[0].length);
  }
  if (delimiter === 'auto') delimiter = detectDelimiter(text);
  const records = readRecords(text, delimiter, o.strict ?? false);
  const skipEmpty = o.skipEmptyLines ?? false;
  const unwrap = o.unwrapFormulas ?? true;
  const result: string[][] = [];
  for (const record of records) {
    if (skipEmpty && record.length === 1 && record[0] === '') continue;
    if (unwrap) {
      for (let i = 0; i < record.length; i++) {
        const unwrapped = unwrapTextFormula(record[i] as string);
        if (unwrapped !== null) record[i] = unwrapped;
      }
    }
    result.push(record);
  }
  return result;
}

function uniqueNames(names: readonly string[], width: number): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (let i = 0; i < width; i++) {
    const base = i < names.length ? (names[i] as string) : `column_${i + 1}`;
    let name = base;
    for (let k = 2; seen.has(name); k++) name = `${base}_${k}`;
    seen.add(name);
    result.push(name);
  }
  return result;
}

/**
 * Parses CSV into objects keyed by the header row.
 *
 * - Duplicate header names get a suffix: `name`, `name_2`, `name_3`.
 * - Missing cells become `''`; cells beyond the header get the names
 *   `column_<n>` (1-based). With `strict: true`, rows whose length differs
 *   from the header throw instead.
 *
 * @example
 * parseObjects('name,zip\r\nKim,02134\r\n'); // [{ name: 'Kim', zip: '02134' }]
 */
export function parseObjects(input: string | BinaryInput, options?: ParseObjectsOptions): Record<string, string>[] {
  const o = assertOptions(options);
  const { headers } = o;
  if (headers !== undefined && (!Array.isArray(headers) || headers.some((h) => typeof h !== 'string'))) {
    throw invalidOption('headers', 'an array of strings', headers);
  }
  const rows = parse(input, o);
  const names = headers ?? rows.shift();
  if (names === undefined) return [];
  const strict = o.strict ?? false;
  const width = rows.reduce((max, row) => Math.max(max, row.length), names.length);
  const keys = uniqueNames(names, width);
  return rows.map((row, index) => {
    if (strict && row.length !== names.length) {
      throw new CsvError(
        'PARSE_ERROR',
        `Row ${index} has ${row.length} fields but the header has ${names.length}: ${describe(row.join(','))}.`,
        { row: index },
      );
    }
    const length = Math.max(row.length, names.length);
    return Object.fromEntries(keys.slice(0, length).map((key, i) => [key, row[i] ?? '']));
  });
}
