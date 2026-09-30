import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { textFormula, unwrapTextFormula } from '../src/formula';

describe('textFormula', () => {
  it('wraps text in a string-literal formula', () => {
    expect(textFormula('007')).toBe('="007"');
    expect(textFormula('a"b')).toBe('="a""b"');
    expect(textFormula('"')).toBe('=""""');
    expect(textFormula('')).toBe('=""');
    expect(textFormula('=1+1')).toBe('="=1+1"');
  });

  it('turns line breaks into CHAR() calls', () => {
    expect(textFormula('a\nb')).toBe('="a"&CHAR(10)&"b"');
    expect(textFormula('a\r\nb')).toBe('="a"&CHAR(13)&CHAR(10)&"b"');
    expect(textFormula('\n')).toBe('=CHAR(10)');
    expect(textFormula('\nx\r')).toBe('=CHAR(10)&"x"&CHAR(13)');
  });

  it('splits literals at 255 characters', () => {
    const formula = textFormula('x'.repeat(600)) as string;
    expect(formula).toBe(`="${'x'.repeat(255)}"&"${'x'.repeat(255)}"&"${'x'.repeat(90)}"`);
  });

  it('counts escaped quotes towards the 255 limit', () => {
    const formula = textFormula('"'.repeat(200)) as string;
    const literals = formula.slice(1).split('&');
    for (const literal of literals) expect(literal.length - 2).toBeLessThanOrEqual(255);
    expect(unwrapTextFormula(formula)).toBe('"'.repeat(200));
  });

  it('never splits a surrogate pair', () => {
    const text = `${'x'.repeat(254)}😀tail`;
    const formula = textFormula(text) as string;
    expect(formula).toBe(`="${'x'.repeat(254)}"&"😀tail"`);
    expect(textFormula('😀'.repeat(200))?.split('&').every((part) => !/[\ud800-\udbff]"$/.test(part))).toBe(true);
  });

  it('keeps lone surrogates as they are', () => {
    expect(textFormula('\ud800')).toBe('="\ud800"');
    expect(textFormula('\udc00a')).toBe('="\udc00a"');
    expect(textFormula('\ud800a')).toBe('="\ud800a"');
  });

  it('returns null beyond the 8192 character formula limit', () => {
    expect(textFormula('x'.repeat(8000))).not.toBeNull();
    expect(textFormula('x'.repeat(8100))).toBeNull();
    expect(textFormula('\n'.repeat(1000))).toBeNull();
  });
});

describe('unwrapTextFormula', () => {
  it('unwraps text formulas', () => {
    expect(unwrapTextFormula('="007"')).toBe('007');
    expect(unwrapTextFormula('=""')).toBe('');
    expect(unwrapTextFormula('="a""b"')).toBe('a"b');
    expect(unwrapTextFormula('="a"&CHAR(10)&"b"')).toBe('a\nb');
    expect(unwrapTextFormula('=char(9)')).toBe('\t');
    expect(unwrapTextFormula('="a"&"b"')).toBe('ab');
  });

  it('rejects anything else', () => {
    for (const cell of [
      '',
      '007',
      '=',
      '="unterminated',
      '="a"b"',
      '=1+1',
      '="a"&',
      '="a"&B1',
      '=CHAR(0)',
      '=CHAR(128)',
      '=CHAR(999)',
      '=CHAR(1000)',
      '="a" & "b"',
      ' ="a"',
      '="a" ',
      '=T("a")',
      '=CHAR(10)&CHAR(200)',
    ]) {
      expect(unwrapTextFormula(cell), JSON.stringify(cell)).toBeNull();
    }
  });

  it('round-trips any text', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary', maxLength: 2000 }), (text) => {
        const formula = textFormula(text);
        if (formula !== null) expect(unwrapTextFormula(formula)).toBe(text);
      }),
      { numRuns: 3000 },
    );
  });
});
