import { CsvError, describe, invalidOption } from './errors';

/**
 * How a column's values are written.
 *
 * - `'auto'` (default): strings stay text, numbers stay numbers, dates stay
 *   dates. Strings that Excel would convert or evaluate are protected.
 * - `'text'`: every value (numbers and dates too) is written as text that Excel
 *   shows exactly as formatted. Use it for IDs, account numbers, postal codes.
 * - `'number'`: like `'auto'`, but strings in plain decimal notation
 *   (`"1234.50"`, `"-7"`, `"1e3"`) are written as numbers. Handy for database
 *   `DECIMAL` columns that arrive as strings.
 * - `'raw'`: nothing is protected; the value is only CSV-escaped. **Unsafe
 *   with untrusted data** (formula injection). Use it to emit your own formulas.
 */
export type ColumnType = 'auto' | 'text' | 'number' | 'raw';

/** How to keep a value as text when Excel would otherwise convert or evaluate it. */
export type ProtectStrategy = 'formula' | 'tab' | 'none';

/** What to do with strings that a spreadsheet would evaluate as formulas. */
export type FormulaPolicy = 'neutralize' | 'allow' | 'throw';

/** How `Date` values are written. */
export type DateFormat = 'datetime' | 'date' | 'iso' | ((date: Date) => string);

/** How to treat Excel's hard limits (32,767 characters per cell, 16,384 columns, 1,048,576 rows). */
export type LimitPolicy = 'error' | 'truncate' | 'ignore';

/** Options that control how a single value becomes cell text. */
export interface CellOptions {
  /**
   * How to keep a string as text when Excel would change it (`007`, `1/2`, `MARCH1`)
   * or evaluate it (`=1+1`).
   *
   * - `'formula'` (default): write it as `="007"`. Excel and Google Sheets show
   *   exactly `007`; the value is lossless and can never run as a formula.
   * - `'tab'`: prefix a tab character. Readable by any program, but the tab
   *   becomes part of the value.
   * - `'none'`: do not protect against conversion.
   *
   * With `'tab'` and `'none'`, formula-like strings are neutralized with a
   * leading `'` (the OWASP recommendation) instead.
   * @default 'formula'
   */
  protect?: ProtectStrategy;
  /**
   * Strings that start with `=`, `+`, `-`, `@`, tab or carriage return:
   *
   * - `'neutralize'` (default): write them so they are displayed, never executed.
   * - `'allow'`: write strings starting with `=` unchanged so Excel evaluates
   *   them. Only use with trusted data.
   * - `'throw'`: throw a {@link CsvError} with code `FORMULA_REJECTED`.
   * @default 'neutralize'
   */
  formulas?: FormulaPolicy;
  /**
   * Decimal separator used when writing numbers. Excel in most European
   * locales expects `','` (usually together with `delimiter: ';'`).
   * @default '.'
   */
  decimalSeparator?: '.' | ',';
  /**
   * - `'datetime'` (default): `2024-01-31 13:45:00`, a real date in every Excel locale.
   * - `'date'`: `2024-01-31`, a real date without the time.
   * - `'iso'`: `2024-01-31T04:45:00.000Z`, kept as text.
   * - a function: its return value is written as text.
   * @default 'datetime'
   */
  dateFormat?: DateFormat;
  /**
   * Time zone used by `dateFormat: 'datetime' | 'date'`: `'local'`, `'UTC'`
   * or an IANA name such as `'Asia/Seoul'`.
   * @default 'local'
   */
  timeZone?: string;
  /**
   * Text for `true` / `false`. By default Excel's own `TRUE` / `FALSE`
   * booleans are written. Pass e.g. `['Yes', 'No']` or `['예', '아니오']` to
   * write text instead.
   */
  booleans?: readonly [trueText: string, falseText: string];
  /**
   * Excel keeps only 15 significant digits, so the integer
   * `1234567890123456789` would become `1234567890123456800`.
   *
   * - `'text'` (default): integers (`number` or `bigint`) with more than 15
   *   significant digits, and numbers outside Excel's range, are written as text.
   * - `'number'`: always write them as numbers and accept the rounding.
   * @default 'text'
   */
  largeNumbers?: 'text' | 'number';
  /**
   * What to do when Excel's hard limits are exceeded (cells longer than 32,767
   * characters, more than 16,384 columns or 1,048,576 rows).
   *
   * - `'error'` (default): throw a {@link CsvError}.
   * - `'truncate'`: shorten long cells to 32,767 characters. Too many rows
   *   or columns still throw.
   * - `'ignore'`: do not check.
   * @default 'error'
   */
  limits?: LimitPolicy;
}

/** Options for {@link formatCell}. */
export interface FormatCellOptions extends CellOptions {
  /** @default 'auto' */
  type?: ColumnType;
}

/** A column described in full. Provide either `key` or `value`. */
export interface ColumnDefinition<T = any> {
  /** Property name (object rows) or index (array rows) to read. */
  key?: ColumnKey<T>;
  /** Computes the cell value from the row. Use instead of `key`. */
  value?: (row: T, index: number) => unknown;
  /** Header text. Defaults to `key`. Required when `value` is used and headers are written. */
  header?: string;
  /** @default 'auto' */
  type?: ColumnType;
}

/** A property name of `T` (with autocompletion), or any string/number. */
export type ColumnKey<T> = 0 extends 1 & T
  ? string | number // T is any
  : [T] extends [never]
    ? string | number
    : [T] extends [readonly unknown[]]
      ? number
      : Extract<keyof T, string | number> | (string & {}) | number;

/** @internal Blocks inference of `T` from a position (like TypeScript 5.4's `NoInfer`). */
export type NoInfer<T> = [T][T extends any ? 0 : never];

/** A column: a key shorthand or a full {@link ColumnDefinition}. */
export type Column<T = any> = ColumnKey<T> | ColumnDefinition<T>;

/**
 * Columns to write, in order: an array of keys / definitions, or an object
 * mapping keys to header text (`{ name: 'Name', phone: '전화번호' }`).
 */
export type Columns<T = any> = readonly Column<T>[] | Readonly<Record<string, string>>;

/** Options for {@link stringify}, {@link createWriter}, {@link stringifyAsync} and {@link stringifyStream}. */
export interface StringifyOptions<T = any> extends CellOptions {
  /**
   * Columns to write. When omitted they are taken from the rows: the keys of
   * object rows (in order of first appearance), or the elements of array rows.
   */
  columns?: Columns<T>;
  /**
   * Write a header row. Defaults to `true` when column names are known
   * (explicit `columns` or object rows) and `false` for array rows.
   */
  header?: boolean;
  /** Field delimiter: a single character other than `"`, CR or LF. @default ',' */
  delimiter?: string;
  /** Record separator. @default '\r\n' */
  newline?: '\r\n' | '\n';
  /**
   * Start the output with a UTF-8 byte order mark so Excel detects UTF-8
   * (without it, non-ASCII text such as Korean or accented letters is garbled).
   * @default true
   */
  bom?: boolean;
  /**
   * Write a `sep=<delimiter>` first line that tells Excel which delimiter to
   * use regardless of locale. Caution: Excel ignores the BOM when this line is
   * present, so use it only for ASCII data or with `encoding: 'utf-16le'`.
   * @default false
   */
  sepHint?: boolean;
  /** `'auto'` quotes fields only when needed; `'always'` quotes every field. @default 'auto' */
  quote?: 'auto' | 'always';
  /**
   * Default {@link ColumnType} for every column that does not set its own
   * `type`. For example `type: 'text'` writes all values as text.
   * @default 'auto'
   */
  type?: ColumnType;
}

/* ------------------------------------------------------------------------- */
/* Normalization                                                             */
/* ------------------------------------------------------------------------- */

/** @internal */
export interface ResolvedCellOptions {
  protect: ProtectStrategy;
  formulas: FormulaPolicy;
  decimalSeparator: '.' | ',';
  dateFormat: DateFormat;
  timeZone: string;
  booleans: readonly [string, string] | null;
  largeNumbers: 'text' | 'number';
  limits: LimitPolicy;
}

/** @internal */
export interface ResolvedColumn {
  read: (row: any, index: number) => unknown;
  header: string | undefined;
  type: ColumnType;
  /** Key or index used in error messages. */
  id: string | number;
}

/** @internal */
export interface ResolvedStringifyOptions extends ResolvedCellOptions {
  columns: ResolvedColumn[] | null;
  header: boolean | undefined;
  delimiter: string;
  newline: '\r\n' | '\n';
  bom: boolean;
  sepHint: boolean;
  quoteAll: boolean;
  type: ColumnType;
}

function oneOf<V extends string>(name: string, value: unknown, allowed: readonly V[], fallback: V): V {
  if (value === undefined) return fallback;
  if (typeof value === 'string' && (allowed as readonly string[]).includes(value)) return value as V;
  throw invalidOption(name, allowed.map((v) => JSON.stringify(v)).join(' | '), value);
}

function bool(name: string, value: unknown, fallback: boolean): boolean;
function bool(name: string, value: unknown, fallback: undefined): boolean | undefined;
function bool(name: string, value: unknown, fallback: boolean | undefined): boolean | undefined {
  if (value === undefined) return fallback;
  if (typeof value === 'boolean') return value;
  throw invalidOption(name, 'a boolean', value);
}

function assertObject(name: string, value: unknown): Record<string, unknown> {
  if (value === undefined) return {};
  if (value === null || typeof value !== 'object') throw invalidOption(name, 'an object', value);
  return value as Record<string, unknown>;
}

const zoneCache = new Map<string, Intl.DateTimeFormat>();

/** @internal Returns a cached formatter for an IANA time zone. */
export function zoneFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = zoneCache.get(timeZone);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    zoneCache.set(timeZone, formatter);
  }
  return formatter;
}

/** @internal */
export function resolveCellOptions(input: unknown, name = 'options'): ResolvedCellOptions {
  const options = assertObject(name, input);
  const { dateFormat, timeZone, booleans } = options;

  if (
    dateFormat !== undefined &&
    typeof dateFormat !== 'function' &&
    !(['datetime', 'date', 'iso'] as unknown[]).includes(dateFormat)
  ) {
    throw invalidOption('dateFormat', '"datetime" | "date" | "iso" | a function', dateFormat);
  }

  let zone = 'local';
  if (timeZone !== undefined) {
    if (typeof timeZone !== 'string' || timeZone === '') throw invalidOption('timeZone', 'a time zone name', timeZone);
    if (timeZone.toLowerCase() === 'local') zone = 'local';
    else if (timeZone.toUpperCase() === 'UTC') zone = 'UTC';
    else {
      try {
        zoneFormatter(timeZone);
      } catch (cause) {
        throw new CsvError('INVALID_OPTION', `Invalid option "timeZone": unknown time zone ${describe(timeZone)}.`, {
          cause,
        });
      }
      zone = timeZone;
    }
  }

  let resolvedBooleans: readonly [string, string] | null = null;
  if (booleans !== undefined) {
    if (
      !Array.isArray(booleans) ||
      booleans.length !== 2 ||
      typeof booleans[0] !== 'string' ||
      typeof booleans[1] !== 'string'
    ) {
      throw invalidOption('booleans', 'a [trueText, falseText] pair of strings', booleans);
    }
    if (booleans[0] !== 'TRUE' || booleans[1] !== 'FALSE') resolvedBooleans = [booleans[0], booleans[1]];
  }

  return {
    protect: oneOf('protect', options.protect, ['formula', 'tab', 'none'], 'formula'),
    formulas: oneOf('formulas', options.formulas, ['neutralize', 'allow', 'throw'], 'neutralize'),
    decimalSeparator: oneOf('decimalSeparator', options.decimalSeparator, ['.', ','], '.'),
    dateFormat: (dateFormat ?? 'datetime') as DateFormat,
    timeZone: zone,
    booleans: resolvedBooleans,
    largeNumbers: oneOf('largeNumbers', options.largeNumbers, ['text', 'number'], 'text'),
    limits: oneOf('limits', options.limits, ['error', 'truncate', 'ignore'], 'error'),
  };
}

const COLUMN_TYPES = ['auto', 'text', 'number', 'raw'] as const;

/** @internal */
export function resolveColumnType(value: unknown, name: string): ColumnType {
  return oneOf(name, value, COLUMN_TYPES, 'auto');
}

function keyReader(key: string | number): (row: any) => unknown {
  return (row) => row[key];
}

function resolveColumns(input: unknown, defaultType: ColumnType): ResolvedColumn[] | null {
  if (input === undefined) return null;
  if (input === null || typeof input !== 'object') {
    throw invalidOption('columns', 'an array of columns or an object of { key: header }', input);
  }
  if (!Array.isArray(input)) {
    return Object.entries(input).map(([key, header]): ResolvedColumn => {
      if (typeof header !== 'string') throw invalidOption(`columns.${key}`, 'a header string', header);
      return { read: keyReader(key), header, type: defaultType, id: key };
    });
  }
  return input.map((column: unknown, index): ResolvedColumn => {
    const name = `columns[${index}]`;
    if (typeof column === 'string' || typeof column === 'number') {
      if (typeof column === 'number' && !(Number.isInteger(column) && column >= 0)) {
        throw invalidOption(name, 'a property name or a non-negative integer index', column);
      }
      return { read: keyReader(column), header: String(column), type: defaultType, id: column };
    }
    if (column === null || typeof column !== 'object' || Array.isArray(column)) {
      throw invalidOption(name, 'a key or a column definition object', column);
    }
    const { key, value, header, type } = column as ColumnDefinition;
    if (header !== undefined && typeof header !== 'string') throw invalidOption(`${name}.header`, 'a string', header);
    const resolvedType = type === undefined ? defaultType : resolveColumnType(type, `${name}.type`);
    if (value !== undefined) {
      if (key !== undefined) throw invalidOption(name, 'either "key" or "value", not both', column);
      if (typeof value !== 'function') throw invalidOption(`${name}.value`, 'a function', value);
      return { read: value, header, type: resolvedType, id: header ?? index };
    }
    if (!(typeof key === 'string' || (typeof key === 'number' && Number.isInteger(key) && key >= 0))) {
      throw invalidOption(`${name}.key`, 'a property name or a non-negative integer index', key);
    }
    const id = key as string | number;
    return { read: keyReader(id), header: header ?? String(id), type: resolvedType, id };
  });
}

/** @internal */
export function resolveStringifyOptions(input: unknown): ResolvedStringifyOptions {
  const options = assertObject('options', input);
  const cell = resolveCellOptions(options);
  const delimiter = options.delimiter ?? ',';
  if (
    typeof delimiter !== 'string' ||
    delimiter.length !== 1 ||
    delimiter === '"' ||
    delimiter === '\r' ||
    delimiter === '\n'
  ) {
    throw invalidOption('delimiter', 'a single character other than a double quote, CR or LF', delimiter);
  }
  const type = resolveColumnType(options.type, 'type');
  const columns = resolveColumns(options.columns, type);
  if (columns !== null && columns.length > 16384 && cell.limits !== 'ignore') {
    throw new CsvError('TOO_MANY_COLUMNS', `Excel supports at most 16,384 columns; ${columns.length} were given.`);
  }
  return {
    ...cell,
    columns,
    header: bool('header', options.header, undefined),
    delimiter,
    newline: oneOf('newline', options.newline, ['\r\n', '\n'], '\r\n'),
    bom: bool('bom', options.bom, true),
    sepHint: bool('sepHint', options.sepHint, false),
    quoteAll: oneOf('quote', options.quote, ['auto', 'always'], 'auto') === 'always',
    type,
  };
}
