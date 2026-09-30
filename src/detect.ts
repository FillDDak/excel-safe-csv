import { CsvError, describe } from './errors';
import { CLDR_PUNCTUATION, CLDR_WORDS } from './vocabulary';

/*
 * Excel converts text it reads from a CSV file to numbers, dates, times,
 * booleans and error values, using rules that depend on the user's locale.
 * We cannot know the reader's locale, so the detector is deliberately
 * conservative: it answers "could *some* Excel installation convert this?".
 *
 * A false positive is harmless (the value is merely wrapped so Excel keeps it
 * as the exact same text); a false negative loses data. Every rule below is
 * therefore written to over-approximate.
 */

/** Words that Excel (in some locale) accepts as booleans. Compared lower-cased. */
const BOOLEAN_WORDS = new Set([
  'true', 'false', // English (also used by Korean, Japanese and Chinese Excel)
  'wahr', 'falsch', // German
  'vrai', 'faux', // French
  'verdadero', 'falso', // Spanish / Italian / Portuguese "false"
  'vero', // Italian
  'verdadeiro', // Portuguese
  'waar', 'onwaar', // Dutch
  'sant', 'falskt', // Swedish
  'sand', 'falsk', // Danish
  'sann', 'usann', // Norwegian
  'tosi', 'epätosi', // Finnish
  'prawda', 'fałsz', // Polish
  'pravda', 'nepravda', // Czech
  'igaz', 'hamis', // Hungarian
  'doğru', 'yanlış', // Turkish
  'истина', 'ложь', // Russian
  'αληθές', 'ψευδές', // Greek
]);

/** Excel error literals. Typing one of these produces an error value, not text. */
const ERROR_WORDS = new Set([
  '#null!', '#div/0!', '#value!', '#ref!', '#name?', '#num!', '#n/a', '#getting_data',
  '#spill!', '#calc!', '#field!', '#blocked!', '#connect!', '#busy!', '#unknown!',
  '#python!', '#external!',
]);

/**
 * Letter sequences that may appear inside a date, time, number or currency
 * value that Excel understands in at least one locale: every month, weekday,
 * day-period and currency word from Unicode CLDR for Excel's locales, plus a
 * few forms CLDR does not produce. All lower-case and NFKC-normalized.
 */
const VALUE_WORDS = new Set(
  [
    CLDR_WORDS,
    // English abbreviations Excel accepts that CLDR spells differently
    'sept tues thur thurs',
    // Time-of-day markers, ordinals, ISO 8601 separators, Japanese era initials (R6.1.1)
    'am pm a p m t z s h r st nd rd th',
    // Korean date and time units
    '년 월 일 시 분 초 오전 오후',
    // Chinese / Japanese date units and era names
    '年 月 日 时 時 分 秒 上午 下午 午前 午後 令和 平成 昭和 大正 明治 元年 元',
    // Currency words written next to amounts
    '원 円 元 руб р kr zł zl kč kc ft lei lv chf fr rs rp rm',
  ]
    .join(' ')
    .split(' '),
);

/** Everything except letters that can be part of an Excel number, date or time: digits and value punctuation. */
const VALUE_CHARS = new RegExp(`^[\\p{Nd}\\s\\p{Cf}\\p{Sc}+\\-\\u2212().,'’/:%‰‱${CLDR_PUNCTUATION}]*$`, 'u');
const WORDS = /[\p{L}\p{M}]+/gu;
const DIGIT = /\p{Nd}/u;
const ASCII_DIGIT = /[0-9]/;
const NON_ASCII = /[^\0-\x7f]/;
/** `1e5`, `2E-3`: an exponent marker between a digit and an (optionally signed) digit. */
const EXPONENT = /(\p{Nd})e(?=[+-]?\p{Nd})/gu;
/** Length of the longest boolean or error word. */
const LONGEST_WORD = Math.max(...[...BOOLEAN_WORDS, ...ERROR_WORDS].map((word) => word.length));

/**
 * Returns `true` if Excel might display `text` differently from how it is
 * written when it opens a CSV file: as a number (`007` → `7`,
 * `12345678901234567` → `1.23457E+16`, `1E5` → `100000`), a date or time
 * (`1/2`, `2024-01`, `MARCH1`, `3월 1일`), a boolean (`true`), a percentage,
 * a currency amount or an error value (`#N/A`).
 *
 * The check is locale-independent and errs on the side of `true`.
 * It does **not** check for formulas; see {@link isFormulaLike}.
 */
export function wouldExcelConvert(text: string): boolean {
  if (typeof text !== 'string') {
    throw new CsvError('INVALID_VALUE', `wouldExcelConvert() expects a string, received ${describe(text)}.`);
  }
  // NFKC folds full-width and other compatibility forms (１２３ → 123); ASCII needs no folding.
  const value = (NON_ASCII.test(text) ? text.normalize('NFKC') : text).trim();
  if (value === '') return false;
  // Some spreadsheet applications treat a leading apostrophe as a "text" marker and hide it.
  if (value.charCodeAt(0) === 39) return true;
  if (value.length <= LONGEST_WORD) {
    const lower = value.toLowerCase();
    if (BOOLEAN_WORDS.has(lower) || ERROR_WORDS.has(lower)) return true;
  }
  if (!ASCII_DIGIT.test(value) && !DIGIT.test(value)) return false;
  return looksLikeValue(value.toLowerCase().replace(EXPONENT, '$1 '));
}

/**
 * True when every letter-run of `value` is a known date/time/currency word and
 * every other character is a digit or value punctuation.
 */
function looksLikeValue(value: string): boolean {
  let rest = '';
  let last = 0;
  WORDS.lastIndex = 0;
  for (let match = WORDS.exec(value); match !== null; match = WORDS.exec(value)) {
    if (!VALUE_WORDS.has(match[0])) return false;
    rest += `${value.slice(last, match.index)} `;
    last = WORDS.lastIndex;
  }
  return VALUE_CHARS.test(rest + value.slice(last));
}

/**
 * Characters that make a spreadsheet treat a cell as a formula (OWASP "CSV
 * injection"), optionally preceded by whitespace or invisible characters.
 * Full-width variants are included because some IMEs produce them.
 */
const FORMULA_START = new RegExp(
  '^[\\s\\u0000-\\u001f\\u007f-\\u009f\\u00ad\\u180e\\u200b-\\u200f\\u2028-\\u202f\\u2060-\\u2064\\ufeff]*' +
    '[=+\\-@\\u2212\\ufe62\\ufe63\\ufe66\\uff0b\\uff0d\\uff1d\\uff20]',
  'u',
);

/**
 * Returns `true` if a spreadsheet might evaluate `text` as a formula, i.e. it
 * starts with `=`, `+`, `-`, `@`, a tab or a carriage return (optionally after
 * whitespace). Such values are the vector for CSV/formula injection attacks
 * (`=HYPERLINK(...)`, `=cmd|' /C calc'!A0`, ...).
 */
export function isFormulaLike(text: string): boolean {
  if (typeof text !== 'string') {
    throw new CsvError('INVALID_VALUE', `isFormulaLike() expects a string, received ${describe(text)}.`);
  }
  const first = text.charCodeAt(0);
  return first === 9 || first === 13 || FORMULA_START.test(text);
}
