import { formatValue } from './cell';
import { encode, type OutputEncoding } from './encoding';
import { CsvError, describe } from './errors';
import {
  resolveStringifyOptions,
  type NoInfer,
  type ResolvedColumn,
  type ResolvedStringifyOptions,
  type StringifyOptions,
} from './options';

/** Excel's maximum number of rows per sheet (including the header row). */
export const MAX_ROWS = 1048576;
/** Excel's maximum number of columns per sheet. */
export const MAX_COLUMNS = 16384;

/** An incremental CSV writer. Each call returns the text to append to the output. */
export interface CsvWriter<T = any> {
  /**
   * Formats one row. The first call also returns the BOM, `sep=` line and
   * header row (whichever are enabled).
   */
  write(row: T): string;
  /**
   * Finishes the output. Returns the BOM/`sep=`/header if no row was written
   * (so an empty export still has its header), otherwise `''`.
   * The writer cannot be used afterwards.
   */
  end(): string;
  /** Number of data rows written so far. */
  readonly rowCount: number;
}

/** Text that is misread when it starts a file: SYLK marker, delimiter hint, byte order mark. */
const RISKY_START = /^(?:ID|[Ss][Ee][Pp]=|\uFEFF)/;

/** Columns of the output: explicit, inferred from the first object row (`known` set), or none (array rows). */
interface Layout {
  columns: ResolvedColumn[] | null;
  known: Set<string> | null;
}

class Writer<T> implements CsvWriter<T> {
  readonly #options: ResolvedStringifyOptions;
  readonly #quoteTest: RegExp;
  #layout: Layout;
  #started = false;
  #ended = false;
  /** Records written so far, including the header row. */
  #records = 0;
  #rows = 0;

  constructor(options: ResolvedStringifyOptions) {
    this.#options = options;
    this.#layout = { columns: options.columns, known: null };
    const d = options.delimiter.replace(/[\\^$.*+?()[\]{}|-]/g, '\\$&');
    this.#quoteTest = new RegExp(`[${d}"\\r\\n]|^\\s|\\s$`);
  }

  get rowCount(): number {
    return this.#rows;
  }

  // Each call computes everything first and commits state only on success, so
  // a row that throws leaves the writer exactly as it was.
  write(row: T): string {
    if (this.#ended) throw new CsvError('WRITER_CLOSED', 'Cannot write after end().');
    const index = this.#rows;
    assertRow(row, index);
    let layout = this.#layout;
    let out = '';
    let records = this.#records;
    if (!this.#started) {
      layout = this.#infer(row);
      if (this.#hasHeader(layout)) out = this.#preamble(layout, records++);
      else out = this.#preamble(layout, -1);
    }
    out += this.#record(this.#cells(row, index, layout), index, records);
    this.#layout = layout;
    this.#started = true;
    this.#records = records + 1;
    this.#rows++;
    return out;
  }

  end(): string {
    if (this.#ended) throw new CsvError('WRITER_CLOSED', 'end() was already called.');
    const out = this.#started ? '' : this.#preamble(this.#layout, this.#hasHeader(this.#layout) ? 0 : -1);
    this.#ended = true;
    return out;
  }

  #infer(row: T): Layout {
    if (this.#layout.columns !== null) return this.#layout;
    if (Array.isArray(row)) {
      if (this.#options.header === true) {
        throw new CsvError(
          'INVALID_OPTION',
          'Invalid option "header": array rows have no column names; pass "columns" to write a header row.',
        );
      }
      return this.#layout;
    }
    const keys = Object.keys(row as object);
    const columns = keys.map((key): ResolvedColumn => ({ read: (r: any) => r[key], header: key, type: this.#options.type, id: key }));
    return { columns, known: new Set(keys) };
  }

  #hasHeader(layout: Layout): boolean {
    return layout.columns !== null && (this.#options.header ?? true);
  }

  /** BOM, `sep=` line and, when `headerRecord` is not -1, the header row as that record. */
  #preamble(layout: Layout, headerRecord: number): string {
    const { bom, sepHint, delimiter, newline } = this.#options;
    let out = bom ? '\uFEFF' : '';
    if (sepHint) out += `sep=${delimiter}${newline}`;
    const { columns } = layout;
    if (headerRecord !== -1 && columns !== null) {
      const cells = columns.map((column, position) => {
        if (column.header === undefined) {
          throw new CsvError(
            'INVALID_OPTION',
            `Invalid option "columns": the column at position ${position} uses "value" and needs a "header" (or set header: false).`,
          );
        }
        return formatValue(column.header, 'auto', this.#options, { column: column.id });
      });
      out += this.#record(cells, undefined, headerRecord);
    }
    return out;
  }

  #cells(row: T, index: number, { columns, known }: Layout): string[] {
    if (columns === null) {
      if (!Array.isArray(row)) {
        throw new CsvError('INVALID_ROW', `Row ${index} is an object, but the first row was an array.`, { row: index });
      }
      return row.map((value, column) => formatValue(value, this.#options.type, this.#options, { row: index, column }));
    }
    if (known !== null) {
      if (Array.isArray(row)) {
        throw new CsvError('INVALID_ROW', `Row ${index} is an array, but the first row was an object.`, { row: index });
      }
      for (const key of Object.keys(row as object)) {
        if (!known.has(key)) {
          throw new CsvError(
            'INVALID_ROW',
            `Row ${index} has a key ${JSON.stringify(key)} that the first row did not have. Pass "columns" explicitly to write rows with different keys.`,
            { row: index, column: key },
          );
        }
      }
    }
    return columns.map((column) => {
      const ctx = { row: index, column: column.id };
      let value: unknown;
      try {
        value = column.read(row, index);
      } catch (cause) {
        throw new CsvError('INVALID_VALUE', `Reading column ${JSON.stringify(column.id)} of row ${index} threw.`, {
          ...ctx,
          cause,
        });
      }
      return formatValue(value, column.type, this.#options, ctx);
    });
  }

  /** Formats one record; `record` is its zero-based position in the file (header included). */
  #record(cells: string[], row: number | undefined, record: number): string {
    const { limits, delimiter, newline, quoteAll } = this.#options;
    if (limits !== 'ignore') {
      if (cells.length > MAX_COLUMNS) {
        throw new CsvError('TOO_MANY_COLUMNS', `Excel supports at most ${MAX_COLUMNS} columns; a row has ${cells.length}.`, {
          ...(row === undefined ? {} : { row }),
        });
      }
      if (record >= MAX_ROWS) {
        // The header is always the first record, so only data rows can overflow.
        throw new CsvError('TOO_MANY_ROWS', `Excel supports at most ${MAX_ROWS} rows (including the header row).`, {
          row: row as number,
        });
      }
    }
    let line = '';
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i] as string;
      if (i > 0) line += delimiter;
      // At the very start of the file, "ID" makes Excel think the file is SYLK, "sep=" is read as
      // a delimiter hint, and U+FEFF would be taken for a byte order mark.
      if (quoteAll || this.#quoteTest.test(cell) || (record === 0 && i === 0 && RISKY_START.test(cell))) {
        line += `"${cell.replace(/"/g, '""')}"`;
      } else {
        line += cell;
      }
    }
    return line + newline;
  }
}

function assertRow(row: unknown, index: number): void {
  if (row === null || typeof row !== 'object') {
    throw new CsvError('INVALID_ROW', `Row ${index} must be an array or an object, received ${describe(row)}.`, {
      row: index,
    });
  }
}

/**
 * Creates an incremental writer, for producing CSV row by row (e.g. while
 * reading from a database cursor).
 *
 * Without `columns`, the columns are taken from the **first** row; a later
 * object row with a key the first row did not have throws (instead of silently
 * dropping data), so pass `columns` when rows have different keys.
 *
 * @example
 * const writer = createWriter({ columns: { id: 'ID', name: 'Name' } });
 * let csv = '';
 * for (const user of users) csv += writer.write(user);
 * csv += writer.end();
 */
export function createWriter<T = any>(options?: StringifyOptions<NoInfer<T>>): CsvWriter<T> {
  return new Writer<T>(resolveStringifyOptions(options));
}

function assertIterable(rows: unknown, name: string, async: boolean): void {
  const ok =
    rows !== null &&
    typeof rows === 'object' &&
    (typeof (rows as Iterable<unknown>)[Symbol.iterator] === 'function' ||
      (async && typeof (rows as AsyncIterable<unknown>)[Symbol.asyncIterator] === 'function'));
  if (!ok) {
    throw new CsvError(
      'INVALID_OPTION',
      `${name}() expects ${async ? 'an iterable or async iterable' : 'an array or iterable'} of rows, received ${describe(rows)}.`,
    );
  }
}

/**
 * Converts rows (objects or arrays) to a CSV string that Excel opens correctly.
 *
 * @example
 * stringify([{ name: 'Kim', phone: '010-1234-5678', zip: '02134' }]);
 * // '\uFEFFname,phone,zip\r\nKim,"=""010-1234-5678""","=""02134"""\r\n'
 */
export function stringify<T = any>(rows: Iterable<T>, options?: StringifyOptions<NoInfer<T>>): string {
  assertIterable(rows, 'stringify', false);
  const resolved = resolveStringifyOptions(options);
  const list = Array.isArray(rows) ? (rows as T[]) : Array.from(rows);
  let effective = resolved;
  if (resolved.columns === null && list.length > 0 && list.every((row) => row !== null && typeof row === 'object' && !Array.isArray(row))) {
    // All rows are objects: use the union of their keys so no value is dropped.
    const keys = new Set<string>();
    for (const row of list) for (const key of Object.keys(row as object)) keys.add(key);
    effective = {
      ...resolved,
      columns: [...keys].map((key) => ({ read: (r: any) => r[key], header: key, type: resolved.type, id: key })),
    };
  }
  const writer = new Writer<T>(effective);
  const parts = list.map((row) => writer.write(row));
  parts.push(writer.end());
  return parts.join('');
}

/** Output is flushed in chunks of roughly this many UTF-16 code units. */
const CHUNK_SIZE = 64 * 1024;

/**
 * Converts a (possibly asynchronous) stream of rows to CSV text chunks.
 * Works with arrays, generators, async generators, database cursors and
 * Node.js readable streams in object mode.
 *
 * @example
 * import { Readable } from 'node:stream';
 * Readable.from(stringifyAsync(cursor, { columns })).pipe(response);
 */
export async function* stringifyAsync<T = any>(
  rows: Iterable<T> | AsyncIterable<T>,
  options?: StringifyOptions<NoInfer<T>>,
): AsyncGenerator<string, void, undefined> {
  assertIterable(rows, 'stringifyAsync', true);
  const writer = createWriter<T>(options as StringifyOptions<T>);
  let buffer = '';
  for await (const row of rows) {
    buffer += writer.write(row);
    if (buffer.length >= CHUNK_SIZE) {
      yield buffer;
      buffer = '';
    }
  }
  buffer += writer.end();
  if (buffer !== '') yield buffer;
}

/** Options for {@link stringifyStream}. */
export interface StringifyStreamOptions<T = any> extends StringifyOptions<T> {
  /**
   * Byte encoding of the stream. `'utf-16le'` (with its BOM) is the format
   * Excel opens correctly on every platform and locale, especially together
   * with `delimiter: '\t'`.
   * @default 'utf-8'
   */
  encoding?: OutputEncoding;
}

/**
 * Converts rows to a web `ReadableStream` of encoded bytes, ready to be used as
 * an HTTP response body (Fetch API, Next.js route handlers, Hono, Deno, Bun,
 * Cloudflare Workers, Node.js 18+).
 *
 * @example
 * return new Response(stringifyStream(rows), {
 *   headers: {
 *     'Content-Type': 'text/csv; charset=utf-8',
 *     'Content-Disposition': 'attachment; filename="export.csv"',
 *   },
 * });
 */
export function stringifyStream<T = any>(
  rows: Iterable<T> | AsyncIterable<T>,
  options?: StringifyStreamOptions<NoInfer<T>>,
): ReadableStream<Uint8Array> {
  const { encoding = 'utf-8', ...rest } = options ?? {};
  // Validate eagerly so mistakes surface where the stream is created.
  encode('', encoding);
  assertIterable(rows, 'stringifyStream', true);
  resolveStringifyOptions(rest);
  let chunks: AsyncGenerator<string, void, undefined> | undefined;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      chunks ??= stringifyAsync(rows, rest as StringifyOptions<T>);
      const next = await chunks.next();
      if (next.done === true) controller.close();
      else controller.enqueue(encode(next.value, encoding));
    },
    async cancel() {
      await chunks?.return();
    },
  });
}
