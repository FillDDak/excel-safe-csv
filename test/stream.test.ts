import { describe, expect, it } from 'vitest';
import { CsvError, parse, stringify, stringifyAsync, stringifyStream } from '../src/index';

async function collect(source: AsyncIterable<string>): Promise<string[]> {
  const chunks: string[] = [];
  for await (const chunk of source) chunks.push(chunk);
  return chunks;
}

async function readBytes(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function* asyncRows<T>(rows: T[]): AsyncGenerator<T> {
  for (const row of rows) {
    await Promise.resolve();
    yield row;
  }
}

const rows = Array.from({ length: 5000 }, (_, i) => ({ id: i, code: String(i).padStart(6, '0'), note: `line ${i}\nnext` }));

describe('stringifyAsync', () => {
  it('produces the same text as stringify, in chunks', async () => {
    const chunks = await collect(stringifyAsync(asyncRows(rows)));
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks.slice(0, -1)) expect(chunk.length).toBeGreaterThanOrEqual(64 * 1024);
    expect(chunks.join('')).toBe(stringify(rows));
  });

  it('accepts sync iterables', async () => {
    expect((await collect(stringifyAsync([[1], [2]], { bom: false }))).join('')).toBe('1\r\n2\r\n');
  });

  it('yields the header of an empty source', async () => {
    expect(await collect(stringifyAsync([], { columns: ['a'] }))).toEqual(['\u{feff}a\r\n']);
    expect(await collect(stringifyAsync([], { bom: false }))).toEqual([]);
  });

  it('rejects non-iterables', async () => {
    await expect(collect(stringifyAsync(5 as never))).rejects.toThrow(/stringifyAsync\(\) expects an iterable or async iterable/);
    await expect(collect(stringifyAsync(null as never))).rejects.toBeInstanceOf(CsvError);
  });

  it('propagates row errors', async () => {
    await expect(collect(stringifyAsync(asyncRows([{ a: 1 }, { b: 2 }])))).rejects.toMatchObject({ code: 'INVALID_ROW', row: 1 });
  });

  it('propagates source errors', async () => {
    async function* failing(): AsyncGenerator<number[]> {
      yield [1];
      throw new Error('source failed');
    }
    await expect(collect(stringifyAsync(failing()))).rejects.toThrow('source failed');
  });
});

describe('stringifyStream', () => {
  it('streams UTF-8 bytes', async () => {
    const bytes = await readBytes(stringifyStream(asyncRows(rows)));
    expect(new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes)).toBe(stringify(rows));
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });

  it('streams UTF-16LE bytes with a BOM', async () => {
    const bytes = await readBytes(stringifyStream([['한', 'a']], { encoding: 'utf-16le', delimiter: '\t' }));
    expect([...bytes.slice(0, 2)]).toEqual([0xff, 0xfe]);
    expect(parse(bytes)).toEqual([['한', 'a']]);
  });

  it('works as a Response body', async () => {
    const response = new Response(stringifyStream([{ zip: '02134' }]), { headers: { 'Content-Type': 'text/csv; charset=utf-8' } });
    expect(await response.text()).toBe('zip\r\n"=""02134"""\r\n');
  });

  it('can be cancelled', async () => {
    let produced = 0;
    function* endless(): Generator<number[]> {
      for (;;) {
        produced++;
        yield [produced];
      }
    }
    const reader = stringifyStream(endless()).getReader();
    const { value } = await reader.read();
    expect(value?.length).toBeGreaterThan(0);
    await reader.cancel();
    const after = produced;
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(produced).toBe(after);
  });

  it('cancelling before reading is safe', async () => {
    await expect(stringifyStream([[1]]).cancel()).resolves.toBeUndefined();
  });

  it('validates arguments eagerly', () => {
    expect(() => stringifyStream([], { encoding: 'latin1' as never })).toThrow(/"encoding"/);
    expect(() => stringifyStream(3 as never)).toThrow(/stringifyStream\(\) expects/);
    expect(() => stringifyStream([], { delimiter: '' })).toThrow(/"delimiter"/);
  });

  it('errors the stream when a row is invalid', async () => {
    await expect(readBytes(stringifyStream([[1], 2] as never))).rejects.toMatchObject({ code: 'INVALID_ROW' });
  });
});
