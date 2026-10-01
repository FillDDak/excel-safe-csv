/** Machine-readable reason attached to every {@link CsvError}. */
export type CsvErrorCode =
  /** An option has an invalid value. */
  | 'INVALID_OPTION'
  /** A row is not an array or object, or does not match the inferred columns. */
  | 'INVALID_ROW'
  /** A value cannot be written to a cell (for example a function or a circular object). */
  | 'INVALID_VALUE'
  /** A cell looks like a formula and `formulas: 'throw'` is set. */
  | 'FORMULA_REJECTED'
  /** A cell is longer than Excel's 32,767 character limit. */
  | 'CELL_TOO_LONG'
  /** A row has more than Excel's 16,384 columns. */
  | 'TOO_MANY_COLUMNS'
  /** The file has more than Excel's 1,048,576 rows. */
  | 'TOO_MANY_ROWS'
  /** The input could not be parsed (`strict: true` only). */
  | 'PARSE_ERROR'
  /** The writer was used after `end()`. */
  | 'WRITER_CLOSED';

export interface CsvErrorDetails {
  /** Zero-based index of the data row (the header row is not counted) that caused the error. */
  row?: number;
  /** Key (or index) of the column that caused the error. */
  column?: string | number;
  /** One-based line number of the input (parse errors only). */
  line?: number;
  /** Underlying error, if any. */
  cause?: unknown;
}

/** The only error type thrown by excel-safe-csv. Check `code` to tell failures apart. */
export class CsvError extends Error {
  override readonly name = 'CsvError';
  readonly code: CsvErrorCode;
  readonly row: number | undefined;
  readonly column: string | number | undefined;
  readonly line: number | undefined;

  constructor(code: CsvErrorCode, message: string, details: CsvErrorDetails = {}) {
    super(message, details.cause === undefined ? undefined : { cause: details.cause });
    this.code = code;
    this.row = details.row;
    this.column = details.column;
    this.line = details.line;
  }
}

/** @internal */
export function invalidOption(name: string, expected: string, actual: unknown): CsvError {
  return new CsvError('INVALID_OPTION', `Invalid option "${name}": expected ${expected}, received ${describe(actual)}.`);
}

/** @internal Short, safe description of an arbitrary value for error messages. */
export function describe(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value.length > 40 ? `${value.slice(0, 40)}…` : value);
  if (typeof value === 'bigint') return `${value}n`;
  if (typeof value === 'function') return 'a function';
  if (typeof value === 'symbol') return value.toString();
  if (value === null || typeof value !== 'object') return String(value);
  if (Array.isArray(value)) return 'an array';
  return 'an object';
}
