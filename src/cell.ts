import { isFormulaLike, wouldExcelConvert } from './detect';
import { CsvError, describe } from './errors';
import { textFormula } from './formula';
import {
  resolveCellOptions,
  resolveColumnType,
  zoneFormatter,
  type ColumnType,
  type FormatCellOptions,
  type ResolvedCellOptions,
} from './options';

/** Excel's maximum number of characters in a cell. */
export const MAX_CELL_LENGTH = 32767;
/** Largest and smallest positive numbers Excel can store. */
const EXCEL_MAX = 9.99999999999999e307;
const EXCEL_MIN = 2.2250738585072014e-308;

/** @internal Where a value comes from, for error messages. */
export interface CellContext {
  row?: number;
  column?: string | number;
}

/**
 * The display form of a value. `native` values (numbers, booleans, dates) are
 * written unprotected so Excel parses them into real numbers/booleans/dates;
 * everything else is text that must be displayed verbatim.
 */
interface Display {
  text: string;
  native: boolean;
}

const text = (value: string): Display => ({ text: value, native: false });
const native = (value: string): Display => ({ text: value, native: true });

function fail(code: 'INVALID_VALUE' | 'FORMULA_REJECTED' | 'CELL_TOO_LONG', message: string, ctx: CellContext, cause?: unknown): CsvError {
  const place: string[] = [];
  if (ctx.row !== undefined) place.push(`row ${ctx.row}`);
  if (ctx.column !== undefined) place.push(`column ${JSON.stringify(ctx.column)}`);
  const where = place.length === 0 ? '' : ` (${place.join(', ')})`;
  return new CsvError(code, `${message}${where}`, { ...ctx, cause });
}

/** Number of significant digits in a JavaScript number/bigint string such as `-1.2300e+21`. */
function significantDigits(numeric: string): number {
  const mantissa = numeric.replace(/[eE].*$/, '').replace(/[^0-9]/g, '');
  return mantissa.replace(/^0+/, '').replace(/0+$/, '').length;
}

function numberDisplay(value: number, options: ResolvedCellOptions): Display {
  if (!Number.isFinite(value)) return text(String(value));
  const magnitude = Math.abs(value);
  const string = String(value === 0 ? 0 : value); // also turns -0 into "0"
  if (magnitude !== 0 && (magnitude > EXCEL_MAX || magnitude < EXCEL_MIN)) return text(string);
  if (options.largeNumbers === 'text' && Number.isInteger(value) && significantDigits(string) > 15) {
    return text(string);
  }
  return native(localizeNumber(string, options));
}

function localizeNumber(numeric: string, options: ResolvedCellOptions): string {
  const upper = numeric.replace('e', 'E');
  return options.decimalSeparator === ',' ? upper.replace('.', ',') : upper;
}

function bigintDisplay(value: bigint, options: ResolvedCellOptions): Display {
  const string = value.toString();
  const digits = string.replace('-', '');
  if (digits.length > 308) return text(string);
  if (options.largeNumbers === 'text' && significantDigits(digits) > 15) return text(string);
  return native(string);
}

const pad = (value: number, length = 2): string => String(value).padStart(length, '0');

function dateParts(date: Date, timeZone: string): number[] {
  if (timeZone === 'local') {
    return [date.getFullYear(), date.getMonth() + 1, date.getDate(), date.getHours(), date.getMinutes(), date.getSeconds()];
  }
  if (timeZone === 'UTC') {
    return [
      date.getUTCFullYear(),
      date.getUTCMonth() + 1,
      date.getUTCDate(),
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds(),
    ];
  }
  const parts: Record<string, number> = {};
  for (const part of zoneFormatter(timeZone).formatToParts(date)) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value);
  }
  return [
    parts.year as number,
    parts.month as number,
    parts.day as number,
    (parts.hour as number) % 24, // some engines report midnight as 24
    parts.minute as number,
    parts.second as number,
  ];
}

function dateDisplay(date: Date, options: ResolvedCellOptions, ctx: CellContext): Display {
  if (Number.isNaN(date.getTime())) return text('Invalid Date');
  const { dateFormat } = options;
  if (typeof dateFormat === 'function') {
    let formatted: unknown;
    try {
      formatted = dateFormat(date);
    } catch (cause) {
      throw fail('INVALID_VALUE', 'The dateFormat function threw', ctx, cause);
    }
    if (typeof formatted !== 'string') {
      throw fail('INVALID_VALUE', `The dateFormat function must return a string, received ${describe(formatted)}`, ctx);
    }
    return text(formatted);
  }
  if (dateFormat === 'iso') return text(date.toISOString());
  const [year, month, day, hour, minute, second] = dateParts(date, options.timeZone) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  // Excel cannot represent dates outside 1900–9999; write those as ISO text.
  if (year < 1900 || year > 9999) return text(date.toISOString());
  const ymd = `${year}-${pad(month)}-${pad(day)}`;
  return native(dateFormat === 'date' ? ymd : `${ymd} ${pad(hour)}:${pad(minute)}:${pad(second)}`);
}

function objectText(value: object, ctx: CellContext): string {
  const proto: unknown = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && proto !== Object.prototype && proto !== null && value.toString !== Object.prototype.toString) {
    return String(value);
  }
  let json: string | undefined;
  try {
    json = JSON.stringify(value);
  } catch (cause) {
    throw fail('INVALID_VALUE', 'Cannot convert object to JSON', ctx, cause);
  }
  return json ?? '';
}

/** Converts any value to its display form. */
function display(value: unknown, options: ResolvedCellOptions, ctx: CellContext): Display {
  switch (typeof value) {
    case 'string':
      return text(value);
    case 'number':
      return numberDisplay(value, options);
    case 'bigint':
      return bigintDisplay(value, options);
    case 'boolean':
      if (options.booleans === null) return native(value ? 'TRUE' : 'FALSE');
      return text(options.booleans[value ? 0 : 1]);
    case 'symbol':
      return text(value.toString());
    case 'function':
      throw fail('INVALID_VALUE', 'Cannot write a function to a cell', ctx);
    default:
      if (value === null || value === undefined) return native('');
      if (value instanceof Date) return dateDisplay(value, options, ctx);
      return text(objectText(value as object, ctx));
  }
}

/** Plain decimal notation accepted by `type: 'number'`. */
const DECIMAL = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

function numericStringDisplay(value: string, options: ResolvedCellOptions): Display | null {
  const trimmed = value.trim();
  if (!DECIMAL.test(trimmed)) return null;
  const numeric = trimmed.replace(/^\+/, '');
  const magnitude = Math.abs(Number(numeric));
  const zero = !/[1-9]/.test(numeric.replace(/e.*$/i, ''));
  // Out of Excel's range, including values like "1e-400" that underflow to 0.
  if (!zero && !(magnitude <= EXCEL_MAX && magnitude >= EXCEL_MIN)) return null;
  if (options.largeNumbers === 'text' && /^-?\d+$/.test(numeric) && significantDigits(numeric) > 15) return null;
  return native(localizeNumber(numeric, options));
}

function enforceLength(value: string, options: ResolvedCellOptions, ctx: CellContext): string {
  if (value.length <= MAX_CELL_LENGTH || options.limits === 'ignore') return value;
  if (options.limits === 'error') {
    throw fail(
      'CELL_TOO_LONG',
      `Cell has ${value.length} characters; Excel supports at most ${MAX_CELL_LENGTH} (set limits: 'truncate' to shorten it)`,
      ctx,
    );
  }
  const end = MAX_CELL_LENGTH;
  const last = value.charCodeAt(end - 1);
  // Never cut a surrogate pair in half.
  return value.slice(0, last >= 0xd800 && last <= 0xdbff ? end - 1 : end);
}

/** Protects text so Excel shows it verbatim and never evaluates it. */
function protectText(value: string, options: ResolvedCellOptions, ctx: CellContext, allowFormulas: boolean): string {
  if (value === '') return value;
  const formula = isFormulaLike(value);
  if (formula) {
    if (options.formulas === 'throw') {
      throw fail('FORMULA_REJECTED', `Value ${describe(value)} would be evaluated as a formula`, ctx);
    }
    if (allowFormulas && options.formulas === 'allow' && value.charCodeAt(0) === 61 /* = */) return value;
  }
  if (!formula && !wouldExcelConvert(value)) return value;
  if (options.protect === 'formula') {
    const wrapped = textFormula(value);
    if (wrapped !== null) return wrapped;
  }
  if (formula) return `'${value}`;
  return options.protect === 'none' ? value : `\t${value}`;
}

/** @internal Converts a value to the text of one cell (without CSV quoting). */
export function formatValue(value: unknown, type: ColumnType, options: ResolvedCellOptions, ctx: CellContext): string {
  if (type === 'number' && typeof value === 'string') {
    const numeric = numericStringDisplay(value, options);
    if (numeric !== null) return numeric.text;
  }
  const shown = display(value, options, ctx);
  const cell = enforceLength(shown.text, options, ctx);
  if (type === 'raw' || (shown.native && type !== 'text')) return cell;
  return protectText(cell, options, ctx, type !== 'text');
}

/**
 * Converts a single value to the text Excel should receive for one cell,
 * applying all protections, **without** CSV quoting.
 *
 * Useful to make another CSV library Excel-safe, e.g. in the `cast` option
 * of csv-stringify or the `transform` option of Papa Parse.
 *
 * @example
 * formatCell('007');        // '="007"'
 * formatCell('=1+1');       // '="=1+1"'
 * formatCell(42);           // '42'
 * formatCell(new Date(0), { timeZone: 'UTC' }); // '1970-01-01 00:00:00'
 */
export function formatCell(value: unknown, options?: FormatCellOptions): string {
  const resolved = resolveCellOptions(options);
  const type = resolveColumnType((options as FormatCellOptions | undefined)?.type, 'type');
  return formatValue(value, type, resolved, {});
}
