/** Excel rejects string literals longer than 255 characters inside a formula. */
const MAX_LITERAL_LENGTH = 255;
/** Excel's maximum formula length. */
const MAX_FORMULA_LENGTH = 8192;

/**
 * Builds a formula that evaluates to exactly `text`, e.g. `007` → `="007"`.
 *
 * - Double quotes are doubled, as Excel requires inside string literals.
 * - Line breaks become `CHAR(10)` / `CHAR(13)` so the formula stays on one line.
 * - Literals are split into ≤255-character pieces joined with `&`, never
 *   splitting a surrogate pair.
 *
 * Returns `null` if the result would exceed Excel's formula length limit.
 * @internal
 */
export function textFormula(text: string): string | null {
  const parts: string[] = [];
  let literal = '';
  let literalLength = 0;
  const flush = (): void => {
    if (literalLength > 0) parts.push(`"${literal}"`);
    literal = '';
    literalLength = 0;
  };
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === 10 || code === 13) {
      flush();
      parts.push(`CHAR(${code})`);
      continue;
    }
    let piece = text[i] as string;
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        piece = text.slice(i, i + 2);
        i++;
      }
    } else if (code === 34) {
      piece = '""';
    }
    if (literalLength + piece.length > MAX_LITERAL_LENGTH) flush();
    literal += piece;
    literalLength += piece.length;
  }
  flush();
  const formula = parts.length === 0 ? '=""' : `=${parts.join('&')}`;
  return formula.length > MAX_FORMULA_LENGTH ? null : formula;
}

const TERM = String.raw`(?:"(?:[^"]|"")*"|CHAR\(\d{1,3}\))`;
const TEXT_FORMULA = new RegExp(String.raw`^=${TERM}(?:&${TERM})*$`, 'i');
const TOKEN = /"((?:[^"]|"")*)"|CHAR\((\d{1,3})\)/giy;

/**
 * Reverses {@link textFormula}: returns the text a pure "text formula" such as
 * `="007"` or `="a"&CHAR(10)&"b"` evaluates to, or `null` if `cell` is not
 * such a formula. `CHAR(n)` is only accepted for ASCII codes 1–127, whose
 * meaning does not depend on the code page.
 * @internal
 */
export function unwrapTextFormula(cell: string): string | null {
  if (cell.charCodeAt(0) !== 61 /* = */ || !TEXT_FORMULA.test(cell)) return null;
  let result = '';
  TOKEN.lastIndex = 1;
  while (TOKEN.lastIndex < cell.length) {
    const match = TOKEN.exec(cell) as RegExpExecArray;
    const [, literal, charCode] = match;
    if (literal === undefined) {
      const code = Number(charCode);
      if (code < 1 || code > 127) return null;
      result += String.fromCharCode(code);
    } else {
      result += literal.replace(/""/g, '"');
    }
    if (TOKEN.lastIndex < cell.length) TOKEN.lastIndex++; // skip "&"
  }
  return result;
}
