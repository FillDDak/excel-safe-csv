import { Cp949Decoder, nativeCp949 } from './cp949';
import { CsvError, describe, invalidOption } from './errors';

/** Byte encodings {@link encode} can produce. */
export type OutputEncoding = 'utf-8' | 'utf-16le';

let utf8Encoder: TextEncoder | undefined;

/**
 * Encodes text to bytes. A leading `\uFEFF` (as added by `bom: true`) becomes
 * the correct byte order mark for the chosen encoding.
 *
 * `'utf-16le'` is what Excel calls "Unicode Text"; Excel opens it correctly
 * on every platform and locale, particularly with tab-delimited data.
 *
 * @example
 * fs.writeFileSync('export.csv', encode(stringify(rows)));
 * fs.writeFileSync('export.txt', encode(stringify(rows, { delimiter: '\t' }), 'utf-16le'));
 */
export function encode(text: string, encoding: OutputEncoding = 'utf-8'): Uint8Array {
  if (typeof text !== 'string') throw new CsvError('INVALID_VALUE', `encode() expects a string, received ${describe(text)}.`);
  if (encoding === 'utf-8') return (utf8Encoder ??= new TextEncoder()).encode(text);
  if (encoding !== 'utf-16le') throw invalidOption('encoding', '"utf-8" | "utf-16le"', encoding);
  const bytes = new Uint8Array(text.length * 2);
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    bytes[i * 2] = code & 0xff;
    bytes[i * 2 + 1] = code >> 8;
  }
  return bytes;
}

/** Options for {@link decode}, {@link parse} and {@link parseObjects} when the input is bytes. */
export interface DecodeOptions {
  /**
   * Encoding of the bytes, e.g. `'utf-8'`, `'euc-kr'`, `'shift_jis'`,
   * `'windows-1252'`: any WHATWG encoding label, plus the code page names
   * `cp949`/`ms949`/`uhc`, `cp932`, `cp936` and `cp950`. A byte order mark
   * always takes precedence, as in browsers.
   *
   * `'auto'` (default): use the BOM if present, else UTF-8 if the bytes are
   * valid UTF-8, else each `fallbackEncoding` in turn.
   * @default 'auto'
   */
  encoding?: string;
  /**
   * Encoding(s) to try, in order, when `encoding` is `'auto'` and the bytes
   * are not valid UTF-8. This is the "ANSI" code page Excel used when saving:
   * `'windows-1252'` in Western Europe and the Americas, `'euc-kr'` (CP949) in
   * Korea, `'shift_jis'` in Japan, `'gbk'` in China, `'big5'` in Taiwan.
   *
   * Every candidate but the last is used only if the bytes are valid in it.
   * The last one always succeeds (invalid bytes become U+FFFD).
   * @default 'windows-1252'
   */
  fallbackEncoding?: string | readonly string[];
}

/** Result of {@link decode}. */
export interface Decoded {
  /** The decoded text, without byte order mark. */
  text: string;
  /** Canonical name of the encoding that was used, e.g. `'utf-8'` or `'euc-kr'`. */
  encoding: string;
  /** Whether the input started with a byte order mark. */
  bom: boolean;
}

/** Bytes accepted by {@link decode}, {@link parse} and {@link parseObjects}. */
export type BinaryInput = Uint8Array | ArrayBuffer | SharedArrayBuffer | ArrayBufferView;

const isBuffer = (value: unknown): value is ArrayBufferLike => {
  // Cross-realm buffers (from a worker or an iframe) fail `instanceof`.
  const tag = Object.prototype.toString.call(value);
  return tag === '[object ArrayBuffer]' || tag === '[object SharedArrayBuffer]';
};

function toBytes(input: unknown): Uint8Array {
  let bytes: Uint8Array;
  if (ArrayBuffer.isView(input)) bytes = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  else if (isBuffer(input)) bytes = new Uint8Array(input);
  else {
    throw new CsvError('INVALID_VALUE', `Expected a string, Uint8Array, ArrayBuffer or typed array, received ${describe(input)}.`);
  }
  // TextDecoder refuses views of shared memory: decode a copy.
  return Object.prototype.toString.call(bytes.buffer) === '[object SharedArrayBuffer]' ? bytes.slice() : bytes;
}

/** Common code page names that are not WHATWG labels, mapped to the WHATWG encoding that covers them. */
const ALIASES: Record<string, string> = {
  cp949: 'euc-kr',
  ms949: 'euc-kr',
  uhc: 'euc-kr',
  'x-windows-949': 'euc-kr',
  cp932: 'shift_jis',
  ms932: 'shift_jis',
  cp936: 'gbk',
  ms936: 'gbk',
  cp950: 'big5',
  ms950: 'big5',
};

interface Decoder {
  readonly encoding: string;
  decode(input: Uint8Array): string;
}

function decoder(label: string, fatal: boolean): Decoder {
  try {
    const native = new TextDecoder(ALIASES[label.trim().toLowerCase()] ?? label, { fatal });
    return native.encoding === 'euc-kr' && !nativeCp949() ? new Cp949Decoder(fatal) : native;
  } catch (cause) {
    throw new CsvError(
      'INVALID_OPTION',
      `Encoding ${describe(label)} is not supported by this JavaScript runtime's TextDecoder.`,
      { cause },
    );
  }
}

function sniffBom(bytes: Uint8Array): string | null {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return 'utf-8';
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return 'utf-16le';
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return 'utf-16be';
  return null;
}

/**
 * Decodes bytes (for example an uploaded CSV file) to text, detecting the
 * encoding: BOM → valid UTF-8 → `fallbackEncoding`.
 *
 * @example
 * const { text, encoding } = decode(buffer, { fallbackEncoding: 'euc-kr' });
 */
export function decode(input: BinaryInput, options?: DecodeOptions): Decoded {
  const bytes = toBytes(input);
  if (options !== undefined && (options === null || typeof options !== 'object')) {
    throw invalidOption('options', 'an object', options);
  }
  const { encoding = 'auto', fallbackEncoding = 'windows-1252' } = options ?? {};
  if (typeof encoding !== 'string' || encoding === '') throw invalidOption('encoding', 'an encoding label or "auto"', encoding);
  const fallbacks: readonly unknown[] = Array.isArray(fallbackEncoding) ? fallbackEncoding : [fallbackEncoding];
  if (fallbacks.length === 0 || fallbacks.some((label) => typeof label !== 'string' || label === '')) {
    throw invalidOption('fallbackEncoding', 'an encoding label or a non-empty array of labels', fallbackEncoding);
  }

  const bom = sniffBom(bytes);
  if (bom !== null) {
    // TextDecoder strips the BOM that matches its encoding.
    return { text: decoder(bom, false).decode(bytes), encoding: bom, bom: true };
  }
  if (encoding.toLowerCase() !== 'auto') {
    const explicit = decoder(encoding, false);
    return { text: explicit.decode(bytes), encoding: explicit.encoding, bom: false };
  }

  const candidates = ['utf-8', ...(fallbacks as string[])];
  // Validate every label up front so a typo is reported even when UTF-8 succeeds.
  const decoders = candidates.map((label, i) => decoder(label, i < candidates.length - 1));
  const last = decoders.pop() as Decoder;
  for (const candidate of decoders) {
    try {
      return { text: candidate.decode(bytes), encoding: candidate.encoding, bom: false };
    } catch {
      // Not valid in this encoding: try the next candidate.
    }
  }
  return { text: last.decode(bytes), encoding: last.encoding, bom: false };
}
