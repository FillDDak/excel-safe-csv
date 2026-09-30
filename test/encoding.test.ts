import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CsvError, decode, encode } from '../src/index';

const bytes = (...values: number[]): Uint8Array => new Uint8Array(values);
// "한글" in CP949 / EUC-KR
const HANGUL_CP949 = [0xc7, 0xd1, 0xb1, 0xdb];
// "日本" in Shift_JIS
const NIHON_SJIS = [0x93, 0xfa, 0x96, 0x7b];
// "café" in Windows-1252
const CAFE_1252 = [0x63, 0x61, 0x66, 0xe9];

describe('encode', () => {
  it('encodes UTF-8', () => {
    expect([...encode('\u{feff}a한')]).toEqual([0xef, 0xbb, 0xbf, 0x61, 0xed, 0x95, 0x9c]);
    expect(encode('')).toEqual(new Uint8Array());
  });

  it('encodes UTF-16LE', () => {
    expect([...encode('\u{feff}a한😀', 'utf-16le')]).toEqual([0xff, 0xfe, 0x61, 0x00, 0x5c, 0xd5, 0x3d, 0xd8, 0x00, 0xde]);
  });

  it('round-trips through decode', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'grapheme' }), fc.constantFrom('utf-8', 'utf-16le' as const), (text, encoding) => {
        expect(decode(encode(`\u{feff}${text}`, encoding)).text).toBe(text);
      }),
    );
  });

  it('rejects invalid arguments', () => {
    expect(() => encode(1 as never)).toThrow(CsvError);
    expect(() => encode('a', 'latin1' as never)).toThrow(/"encoding"/);
  });
});

describe('decode', () => {
  it('detects byte order marks', () => {
    expect(decode(bytes(0xef, 0xbb, 0xbf, 0x61))).toEqual({ text: 'a', encoding: 'utf-8', bom: true });
    expect(decode(bytes(0xff, 0xfe, 0x61, 0x00))).toEqual({ text: 'a', encoding: 'utf-16le', bom: true });
    expect(decode(bytes(0xfe, 0xff, 0x00, 0x61))).toEqual({ text: 'a', encoding: 'utf-16be', bom: true });
  });

  it('lets the BOM win over an explicit encoding', () => {
    expect(decode(bytes(0xef, 0xbb, 0xbf, 0xed, 0x95, 0x9c), { encoding: 'euc-kr' })).toEqual({ text: '한', encoding: 'utf-8', bom: true });
  });

  it('detects UTF-8 without a BOM', () => {
    expect(decode(encode('한글,café'))).toEqual({ text: '한글,café', encoding: 'utf-8', bom: false });
    expect(decode(bytes())).toEqual({ text: '', encoding: 'utf-8', bom: false });
  });

  it('falls back to Windows-1252 by default', () => {
    expect(decode(bytes(...CAFE_1252))).toEqual({ text: 'café', encoding: 'windows-1252', bom: false });
  });

  it('falls back to the given legacy encoding', () => {
    expect(decode(bytes(...HANGUL_CP949), { fallbackEncoding: 'euc-kr' })).toEqual({ text: '한글', encoding: 'euc-kr', bom: false });
    for (const alias of ['cp949', 'CP949', 'ms949', 'uhc', 'x-windows-949', 'windows-949', 'ks_c_5601-1987']) {
      expect(decode(bytes(...HANGUL_CP949), { fallbackEncoding: alias })).toMatchObject({ text: '한글', encoding: 'euc-kr' });
    }
    // A CP949-only (UHC extension) syllable, outside EUC-KR proper
    expect(decode(bytes(0x81, 0x41), { encoding: 'cp949' }).text).toBe('갂');
    expect(decode(bytes(0x82, 0xa0), { encoding: 'cp932' }).text).toBe('あ');
    expect(decode(bytes(0xc4, 0xe3), { encoding: 'cp936' }).text).toBe('你');
    expect(decode(bytes(0xa4, 0x40), { encoding: 'cp950' }).text).toBe('一');
    expect(decode(bytes(...NIHON_SJIS), { fallbackEncoding: 'shift_jis' }).text).toBe('日本');
  });

  it('tries fallbacks in order', () => {
    const options = { fallbackEncoding: ['euc-kr', 'shift_jis', 'windows-1252'] };
    expect(decode(bytes(...HANGUL_CP949), options).encoding).toBe('euc-kr');
    expect(decode(bytes(...CAFE_1252), options).encoding).toBe('windows-1252');
    // Half-width katakana followed by a comma is invalid CP949 but valid Shift_JIS.
    expect(decode(bytes(0xb1, 0x2c), { fallbackEncoding: ['euc-kr', 'shift_jis'] })).toMatchObject({ text: 'ｱ,', encoding: 'shift_jis' });
    // Some byte pairs are valid in several encodings: the first candidate wins.
    expect(decode(bytes(0x82, 0xa0), { fallbackEncoding: ['euc-kr', 'shift_jis'] })).toMatchObject({ text: '궇', encoding: 'euc-kr' });
    expect(decode(bytes(0x82, 0xa0), { fallbackEncoding: ['shift_jis', 'euc-kr'] })).toMatchObject({ text: 'あ', encoding: 'shift_jis' });
  });

  it('replaces invalid bytes in the last fallback', () => {
    expect(decode(bytes(0xff, 0x61), { fallbackEncoding: 'euc-kr' }).text).toBe('�a');
  });

  it('honours an explicit encoding', () => {
    expect(decode(bytes(...HANGUL_CP949), { encoding: 'euc-kr' })).toEqual({ text: '한글', encoding: 'euc-kr', bom: false });
    expect(decode(bytes(0xe9), { encoding: 'latin1' })).toEqual({ text: 'é', encoding: 'windows-1252', bom: false });
    expect(decode(bytes(0x61, 0x00), { encoding: 'utf-16le' }).text).toBe('a');
    expect(decode(bytes(0x61), { encoding: 'AUTO' }).text).toBe('a');
  });

  it('accepts ArrayBuffers, typed arrays, DataViews and Node buffers', () => {
    const source = encode('xa,b');
    expect(decode(source.buffer as ArrayBuffer).text).toBe('xa,b');
    expect(decode(source.subarray(1)).text).toBe('a,b');
    expect(decode(new DataView(source.buffer, 1, 2)).text).toBe('a,');
    expect(decode(new Uint16Array([0x6261])).text).toBe('ab');
    expect(decode(Buffer.from('a,b')).text).toBe('a,b');
  });

  it('accepts SharedArrayBuffers', () => {
    const shared = new SharedArrayBuffer(3);
    new Uint8Array(shared).set([0x61, 0x2c, 0x62]);
    expect(decode(shared).text).toBe('a,b');
    expect(decode(new Uint8Array(shared, 1)).text).toBe(',b');
  });

  it('accepts ArrayBuffers from another realm', async () => {
    const { runInNewContext } = await import('node:vm');
    const foreign = runInNewContext('new Uint8Array([0x61, 0x62]).buffer') as ArrayBuffer;
    expect(foreign instanceof ArrayBuffer).toBe(false);
    expect(decode(foreign).text).toBe('ab');
  });

  it('rejects invalid input and options', () => {
    for (const input of ['abc', 5, null, undefined, {}, [1, 2]]) {
      expect(() => decode(input as never)).toThrow(/Expected a string, Uint8Array, ArrayBuffer or typed array/);
    }
    expect(() => decode(bytes(), 'euc-kr' as never)).toThrow(/"options"/);
    expect(() => decode(bytes(), null as never)).toThrow(/"options"/);
    expect(() => decode(bytes(), { encoding: '' })).toThrow(/"encoding"/);
    expect(() => decode(bytes(), { encoding: 5 as never })).toThrow(/"encoding"/);
    expect(() => decode(bytes(), { fallbackEncoding: [] })).toThrow(/"fallbackEncoding"/);
    expect(() => decode(bytes(), { fallbackEncoding: [''] })).toThrow(/"fallbackEncoding"/);
    expect(() => decode(bytes(), { fallbackEncoding: 1 as never })).toThrow(/"fallbackEncoding"/);
  });

  it('reports unsupported encodings, even when UTF-8 succeeds', () => {
    expect(() => decode(bytes(0x61), { encoding: 'klingon' })).toThrow(/"klingon" is not supported/);
    expect(() => decode(bytes(0x61), { fallbackEncoding: 'klingon' })).toThrow(CsvError);
  });
});
