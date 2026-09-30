import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Cp949Decoder, cp949Table, nativeCp949 } from '../src/cp949';
import { decode, parse } from '../src/index';
import fixtures from './fixtures/cp949-whatwg.json';

/** SHA-256 of WHATWG index-euc-kr as a little-endian Uint16Array (computed with Bun's native decoder). */
const WHATWG_TABLE_SHA256 = '5dcdb2df739d690617df4cda682ab548e0e9b55d7c9c73f05e6715ce16296132';

const bytes = (...values: number[]): Uint8Array => new Uint8Array(values);

describe('CP949 decoder', () => {
  it('builds exactly the WHATWG euc-kr index', () => {
    const table = cp949Table();
    expect(table.filter((code) => code !== 0).length).toBe(17048);
    expect(createHash('sha256').update(new Uint8Array(table.buffer)).digest('hex')).toBe(WHATWG_TABLE_SHA256);
    expect(cp949Table()).toBe(table);
  });

  it('matches a WHATWG decoder on random input', () => {
    for (const { bytes: input, text, valid } of fixtures as { bytes: number[]; text: string; valid: boolean }[]) {
      const data = Uint8Array.from(input);
      expect(new Cp949Decoder(false).decode(data), JSON.stringify(input)).toBe(text);
      if (valid) expect(new Cp949Decoder(true).decode(data)).toBe(text);
      else expect(() => new Cp949Decoder(true).decode(data)).toThrow(TypeError);
    }
  });

  it('decodes KS X 1001 and the CP949 extension', () => {
    const decoder = new Cp949Decoder(true);
    expect(decoder.encoding).toBe('euc-kr');
    expect(decoder.decode(bytes(0xc7, 0xd1, 0xb1, 0xdb))).toBe('한글');
    expect(decoder.decode(bytes(0x81, 0x41))).toBe('갂');
    expect(decoder.decode(bytes(0x8c, 0x63))).toBe('똠');
    expect(decoder.decode(bytes(0xc6, 0x52))).toBe('힣');
    expect(decoder.decode(bytes(0xa2, 0xe6, 0xa2, 0xe7))).toBe('€®');
    expect(decoder.decode(bytes(0x41, 0x0a))).toBe('A\n');
  });

  it('handles errors like WHATWG', () => {
    const lenient = new Cp949Decoder(false);
    expect(lenient.decode(bytes(0x80))).toBe('�');
    expect(lenient.decode(bytes(0xff, 0x41))).toBe('�A');
    expect(lenient.decode(bytes(0xc7))).toBe('�');
    expect(lenient.decode(bytes(0xc7, 0x2c))).toBe('�,'); // ASCII trail is kept
    expect(lenient.decode(bytes(0xc9, 0xa1, 0x41))).toBe('�A'); // unmapped pair is consumed
    expect(lenient.decode(bytes(0xc7, 0x80, 0x41))).toBe('�A');
    expect(() => new Cp949Decoder(true).decode(bytes(0xc9, 0xa1))).toThrow(TypeError);
  });

  it('decodes large inputs', () => {
    const input = new Uint8Array(100_000).fill(0x61);
    for (let i = 0; i < input.length; i += 10) {
      input[i] = 0x81;
      input[i + 1] = 0x41;
    }
    const text = new Cp949Decoder(true).decode(input);
    expect(text.length).toBe(90_000);
    expect(text.slice(0, 10)).toBe('갂aaaaaaaa갂');
  });

  it('is used by decode() when the runtime decoder is incomplete', () => {
    // Node.js's ICU decoder lacks the CP949 extension; WHATWG runtimes have it.
    expect(typeof nativeCp949()).toBe('boolean');
    expect(decode(bytes(0x81, 0x41, 0x2c, 0xc7, 0xd1), { encoding: 'euc-kr' }).text).toBe('갂,한');
    expect(decode(bytes(0x8c, 0x63), { fallbackEncoding: ['euc-kr', 'windows-1252'] })).toMatchObject({ text: '똠', encoding: 'euc-kr' });
    expect(parse(bytes(0xc0, 0xcc, 0xb8, 0xa7, 0x0d, 0x0a, 0x8c, 0x63, 0xb9, 0xe6), { fallbackEncoding: 'cp949' })).toEqual([['이름'], ['똠방']]);
  });
});
