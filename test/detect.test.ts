import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CsvError, isFormulaLike, wouldExcelConvert } from '../src/index';

const EXCEL_LOCALES = [
  'ar', 'bg', 'ca', 'cs', 'cy', 'da', 'de', 'de-AT', 'de-CH', 'el', 'en', 'en-GB', 'en-IN', 'en-US', 'es', 'es-MX', 'et',
  'eu', 'fa', 'fi', 'fil', 'fr', 'fr-CA', 'ga', 'gl', 'he', 'hi', 'hr', 'hu', 'id', 'is', 'it', 'ja', 'ja-JP', 'kk', 'ko',
  'ko-KR', 'lt', 'lv', 'mk', 'ms', 'mt', 'nb', 'nl', 'nn', 'pl', 'pt', 'pt-BR', 'pt-PT', 'ro', 'ru', 'sk', 'sl', 'sq',
  'sr', 'sr-Latn', 'sv', 'th', 'tr', 'uk', 'ur', 'vi', 'zh', 'zh-CN', 'zh-Hant', 'zh-HK', 'zh-TW',
];

describe('wouldExcelConvert', () => {
  const converted = {
    'leading zeros': ['007', '0', '00', '0123456789', ' 007', '007 ', '\u{a0}007'],
    'plain numbers': ['1', '-1', '+1', '1.0', '1.', '.5', '0.5', '1.10', '123456', '-0'],
    'long digit strings (precision loss)': ['1234567890123456', '12345678901234567890', '4111111111111111'],
    'scientific notation': ['1E5', '1e5', '1E+05', '1e-5', '2E10', '12E3', '1.5e3'],
    'thousands separators': ['1,234', '1,234,567.89', '1.234,56', '1 234', "1'000", '1’000', '1,2,3'],
    'negative forms': ['(123)', '(1,234.00)', '1-', '−5'],
    'currency': ['$1', '$1,000', '1$', '€1,00', '£5', '¥100', '₩1,000', '￦1,000', '100원', 'USD 100', '100 kr', 'CHF 100', 'R$ 100', '$ -5'],
    'percent': ['50%', '50 %', '-5%', '10‰'],
    'fractions': ['1/2', '3 1/4', '0 1/2'],
    'dates': [
      '2024-01-02',
      '2024-01',
      '1-2',
      '1-1-1',
      '2024/01/02',
      '01.02.2024',
      '2024.01.02',
      '2024. 1. 2.',
      '1/2/24',
      '12345-6789',
      '010-1234-5678',
      '192.168.0.1',
      '1.2.3',
    ],
    'month and weekday names': [
      'Jan 2',
      '2-Jan',
      'Jan-24',
      'January 2024',
      '2 January 2024',
      'January 2, 2024',
      'Monday, January 2, 2024',
      '2nd Jan',
      'May 5th',
      'Sept 1',
      '1. März 2024',
      '1 janv. 2024',
      '3 de mayo',
      '1 янв',
    ],
    'gene names Excel turns into dates': ['MARCH1', 'SEPT2', 'DEC1', 'OCT4', 'MAR-1', 'NOV2', 'APR1'],
    'times': ['1:30', '12:30:45', '12:30 PM', '12:30pm', '12 PM', '9am', '9 a.m.', '1 a', '10:00:00.123', '13:45'],
    'ISO timestamps': ['2024-01-15T00:00:00Z', '2024-01-15T09:00:00+09:00', '2024-01-15 13:45:00.000'],
    'Korean dates and times': ['3월 1일', '2024년 1월 2일', '1월', '오후 3:00', '15시 30분', '2024년', '12월 25일 월요일'],
    'Japanese / Chinese dates': ['2024年1月2日', '令和6年1月1日', 'R6.1.1', 'H31/4/30', '1月2日', '午後3時'],
    'full-width and other digit forms': ['１２３', '０１２', '①', '٣٤', '１／２'],
    'booleans': ['TRUE', 'true', 'False', ' TRUE ', 'WAHR', 'falsch', 'VRAI', 'verdadero', 'ИСТИНА'],
    'error values': ['#N/A', '#n/a', '#DIV/0!', '#VALUE!', '#REF!', '#NAME?', '#NUM!', '#NULL!', '#SPILL!', '#CALC!'],
    'apostrophe text marker': ["'abc", "'007", "  'x"],
  };

  for (const [group, values] of Object.entries(converted)) {
    it(`detects ${group}`, () => {
      for (const value of values) expect(wouldExcelConvert(value), JSON.stringify(value)).toBe(true);
    });
  }

  const preserved = [
    '',
    ' ',
    '\t',
    'Hello',
    'Seoul',
    '김철수',
    'user@example.com',
    'ABC-123',
    'SKU-A1B2',
    'Room 5',
    'No. 5',
    '5 apples',
    'iPhone 15',
    'COVID-19',
    'H2O',
    '0x1F',
    'https://example.com/1',
    'Mar',
    'May',
    'N/A',
    '#hashtag',
    '#1',
    'truth',
    '1 apple',
    'Apt 1-A',
    '서울시 강남구 1번지',
  ];

  it('leaves ordinary text alone', () => {
    for (const value of preserved) expect(wouldExcelConvert(value), JSON.stringify(value)).toBe(false);
  });

  it('detects the string form of every finite number', () => {
    fc.assert(
      fc.property(fc.double({ noNaN: true, noDefaultInfinity: true }), (n) => {
        expect(wouldExcelConvert(String(n))).toBe(true);
      }),
      { numRuns: 2000 },
    );
    fc.assert(
      fc.property(fc.bigInt(), (n) => {
        expect(wouldExcelConvert(n.toString())).toBe(true);
      }),
    );
  });

  it('detects numbers formatted by Intl in many locales', () => {
    const locales = EXCEL_LOCALES;
    fc.assert(
      fc.property(
        fc.double({ min: -1e12, max: 1e12, noNaN: true }),
        fc.constantFrom(...locales),
        fc.constantFrom<Intl.NumberFormatOptions>(
          {},
          { style: 'percent' },
          { style: 'currency', currency: 'USD' },
          { style: 'currency', currency: 'EUR' },
          { style: 'currency', currency: 'KRW' },
          { style: 'currency', currency: 'JPY' },
          { style: 'currency', currency: 'GBP' },
          { style: 'currency', currency: 'CHF', currencyDisplay: 'code' },
          { style: 'currency', currency: 'SEK' },
          { style: 'currency', currency: 'CNY' },
          { style: 'currency', currency: 'INR', currencyDisplay: 'narrowSymbol' },
          { style: 'currency', currency: 'BRL' },
          { style: 'currency', currency: 'PLN' },
          { minimumFractionDigits: 2 },
          { notation: 'scientific' },
          { notation: 'engineering' },
          { useGrouping: false },
        ),
        (n, locale, format) => {
          const text = new Intl.NumberFormat(locale, format).format(n);
          expect(wouldExcelConvert(text), `${locale} ${JSON.stringify(format)} ${text}`).toBe(true);
        },
      ),
      { numRuns: 3000 },
    );
  });

  it('detects dates and times formatted by Intl in many locales', () => {
    const locales = EXCEL_LOCALES;
    const styles: Intl.DateTimeFormatOptions[] = [
      { dateStyle: 'full' },
      { dateStyle: 'short' },
      { dateStyle: 'medium' },
      { dateStyle: 'long' },
      { timeStyle: 'short' },
      { timeStyle: 'medium' },
      { dateStyle: 'short', timeStyle: 'short' },
      { month: 'short', day: 'numeric' },
      { month: 'long', year: 'numeric' },
      { year: 'numeric', month: '2-digit' },
      { weekday: 'short', day: 'numeric', month: 'short' },
      { hour: 'numeric', minute: '2-digit', hour12: true },
    ];
    fc.assert(
      fc.property(
        fc.date({ min: new Date(Date.UTC(1900, 0, 1)), max: new Date(Date.UTC(2200, 11, 31)), noInvalidDate: true }),
        fc.constantFrom(...locales),
        fc.constantFrom(...styles),
        (date, locale, style) => {
          const text = new Intl.DateTimeFormat(locale, { ...style, timeZone: 'UTC' }).format(date);
          expect(wouldExcelConvert(text), `${locale} ${JSON.stringify(style)} ${text}`).toBe(true);
        },
      ),
      { numRuns: 3000 },
    );
  });

  it('detects ISO strings of any date', () => {
    fc.assert(
      fc.property(fc.date({ noInvalidDate: true }), (date) => {
        expect(wouldExcelConvert(date.toISOString())).toBe(true);
        expect(wouldExcelConvert(date.toISOString().slice(0, 10))).toBe(true);
      }),
    );
  });

  it('never throws on arbitrary strings', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary' }), (s) => {
        expect(typeof wouldExcelConvert(s)).toBe('boolean');
      }),
      { numRuns: 5000 },
    );
  });

  it('rejects non-strings with a CsvError', () => {
    expect(() => wouldExcelConvert(7 as unknown as string)).toThrow(CsvError);
    expect(() => wouldExcelConvert(undefined as unknown as string)).toThrow(/expects a string, received undefined/);
  });
});

describe('isFormulaLike', () => {
  it('detects formula starts', () => {
    for (const value of [
      '=1+1',
      '+1',
      '-1',
      '@SUM(A1)',
      '\t=1',
      '\t',
      '\rabc',
      ' =1',
      '\u{a0}=1',
      '\u{200b}=1',
      '\u{feff}=1',
      '\u{2028}=1',
      '\n=1',
      '＝1',
      '＋1',
      '－1',
      '＠x',
      '−1',
      '﹢1',
      '﹣1',
      '﹦1',
      "=cmd|' /C calc'!A0",
      '=HYPERLINK("http://evil","x")',
      '-',
      '--',
    ]) {
      expect(isFormulaLike(value), JSON.stringify(value)).toBe(true);
    }
  });

  it('ignores ordinary text', () => {
    for (const value of ['', 'a=1', '1-2', 'abc', "'=1", '"=1"', 'x@example.com', '\n', 'a\n=1']) {
      expect(isFormulaLike(value), JSON.stringify(value)).toBe(false);
    }
  });

  it('rejects non-strings with a CsvError', () => {
    expect(() => isFormulaLike(null as unknown as string)).toThrow(CsvError);
  });
});
