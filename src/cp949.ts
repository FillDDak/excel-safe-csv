/*
 * CP949 ("Unified Hangul Code", WHATWG "euc-kr") decoder.
 *
 * Excel on Korean Windows saves CSV files in CP949. Browsers, Deno and Bun
 * decode it correctly, but Node.js's ICU-based TextDecoder("euc-kr") only
 * implements the older EUC-KR subset: the 8,822 additional Hangul syllables
 * of CP949 (e.g. "갂", "똠", "햏") come out as garbage. When the runtime's
 * decoder is incomplete, this module takes over.
 *
 * The table is exactly WHATWG's index-euc-kr, built from three parts:
 *  1. KS X 1001 (lead and trail 0xA1–0xFE), taken from the runtime decoder;
 *  2. two symbols added in KS X 1001:1998 (€, ®), and user-defined rows
 *     0xC9/0xFE that WHATWG leaves unmapped (ICU maps them to private use);
 *  3. the CP949 extension: every modern Hangul syllable missing from KS X
 *     1001, in Unicode order, filling leads 0x81–0xC6 with trails
 *     0x41–0x5A, 0x61–0x7A and 0x81–0xFE (0x81–0xA0 for leads ≥ 0xA1).
 */

const LEADS = 0xfe - 0x81 + 1;
const TRAILS = 0xfe - 0x41 + 1;

let table: Uint16Array | undefined;

const pointer = (lead: number, trail: number): number => (lead - 0x81) * TRAILS + (trail - 0x41);

function buildTable(): Uint16Array {
  const result = new Uint16Array(LEADS * TRAILS);
  // 1. KS X 1001: decode every pair, each followed by a newline so the pairs stay aligned.
  const bytes = new Uint8Array(94 * 94 * 3);
  let at = 0;
  for (let lead = 0xa1; lead <= 0xfe; lead++) {
    for (let trail = 0xa1; trail <= 0xfe; trail++) {
      bytes[at++] = lead;
      bytes[at++] = trail;
      bytes[at++] = 0x0a;
    }
  }
  const chars = new TextDecoder('euc-kr').decode(bytes).split('\n');
  for (let i = 0; i < 94 * 94; i++) {
    const lead = 0xa1 + Math.floor(i / 94);
    const trail = 0xa1 + (i % 94);
    const char = chars[i] as string;
    const code = char.charCodeAt(0);
    if (char.length !== 1 || code === 0xfffd || lead === 0xc9 || lead === 0xfe || (code >= 0xe000 && code <= 0xf8ff)) continue;
    result[pointer(lead, trail)] = code;
  }
  // 2. KS X 1001:1998 additions.
  result[pointer(0xa2, 0xe6)] = 0x20ac; // €
  result[pointer(0xa2, 0xe7)] = 0x00ae; // ®
  // 3. CP949 extension syllables.
  const inKsx = new Uint8Array(0xd7a4 - 0xac00);
  for (const code of result) if (code >= 0xac00 && code <= 0xd7a3) inKsx[code - 0xac00] = 1;
  let syllable = 0xac00;
  fill: for (let lead = 0x81; lead <= 0xc6; lead++) {
    for (let trail = 0x41; trail <= (lead < 0xa1 ? 0xfe : 0xa0); trail++) {
      if ((trail > 0x5a && trail < 0x61) || (trail > 0x7a && trail < 0x81)) continue;
      while (syllable <= 0xd7a3 && inKsx[syllable - 0xac00] === 1) syllable++;
      if (syllable > 0xd7a3) break fill; // all 8,822 syllables placed (the last is 0xC6 0x52)
      result[pointer(lead, trail)] = syllable++;
    }
  }
  return result;
}

/** @internal Exposed for tests. */
export function cp949Table(): Uint16Array {
  return (table ??= buildTable());
}

/** @internal A TextDecoder-like CP949 decoder following the WHATWG euc-kr algorithm. */
export class Cp949Decoder {
  readonly encoding = 'euc-kr';
  readonly #fatal: boolean;

  constructor(fatal: boolean) {
    this.#fatal = fatal;
  }

  decode(bytes: Uint8Array): string {
    const map = cp949Table();
    const parts: string[] = [];
    let units: number[] = [];
    const n = bytes.length;
    for (let i = 0; i < n; ) {
      const byte = bytes[i] as number;
      let code: number;
      if (byte < 0x80) {
        code = byte;
        i++;
      } else {
        const trail = i + 1 < n ? (bytes[i + 1] as number) : -1;
        const mapped = byte >= 0x81 && byte <= 0xfe && trail >= 0x41 && trail <= 0xfe ? (map[pointer(byte, trail)] as number) : 0;
        if (mapped !== 0) {
          code = mapped;
          i += 2;
        } else {
          if (this.#fatal) throw new TypeError('The encoded data was not valid for encoding euc-kr');
          code = 0xfffd;
          // An ASCII trail byte is not consumed: it is decoded on its own.
          i += byte >= 0x81 && byte <= 0xfe && trail >= 0x80 ? 2 : 1;
        }
      }
      units.push(code);
      if (units.length === 8192) {
        parts.push(String.fromCharCode(...units));
        units = [];
      }
    }
    parts.push(String.fromCharCode(...units));
    return parts.join('');
  }
}

let nativeIsComplete: boolean | undefined;

/** @internal True if the runtime's TextDecoder implements full CP949 (browsers, Deno, Bun). */
export function nativeCp949(): boolean {
  if (nativeIsComplete === undefined) {
    const sample = new TextDecoder('euc-kr').decode(new Uint8Array([0x81, 0x41, 0xc6, 0x52, 0xa2, 0xe6]));
    nativeIsComplete = sample === '갂힣€';
  }
  return nativeIsComplete;
}
