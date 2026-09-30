/**
 * Compile-time tests for the public types. Checked by `npm run typecheck`;
 * every `@ts-expect-error` must be an error, and everything else must compile.
 */
import {
  createWriter,
  decode,
  formatCell,
  parse,
  parseObjects,
  stringify,
  stringifyAsync,
  stringifyStream,
  type Column,
  type CsvErrorCode,
  type CsvWriter,
  type Decoded,
} from '../src/index';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const assert = <T extends true>(): T => true as T;

interface User {
  id: number;
  name: string;
  phone: string | null;
}
const users: User[] = [];

// Columns autocomplete the row's keys but accept any string.
stringify(users, { columns: ['id', 'name'] });
stringify(users, { columns: ['id', 'computed-later'] });
stringify(users, { columns: { name: '이름', phone: '전화번호' } });
stringify(users, {
  columns: [
    { key: 'id', header: 'ID', type: 'text' },
    { header: 'Label', value: (user, index) => `${index}:${user.name.toUpperCase()}` },
  ],
});
// @ts-expect-error: `value` receives the row type
stringify(users, { columns: [{ header: 'x', value: (user) => user.missing }] });
// @ts-expect-error: unknown column type
stringify(users, { columns: [{ key: 'id', type: 'date' }] });
// @ts-expect-error: invalid option value
stringify(users, { protect: 'always' });

// Array rows are indexed by number.
stringify([['a', 1]], { columns: [0, { key: 1, header: 'n' }] });
// @ts-expect-error: array rows have numeric keys
stringify([['a', 1]], { columns: [{ key: 'name' }] });

// Empty and untyped inputs accept any keys.
stringify([], { columns: ['a', 'b'] });
stringify([] as any[], { columns: ['a'] });
stringify(new Set([{ a: 1 }]));

const writer = createWriter<User>({ columns: ['id'] });
writer.write({ id: 1, name: 'Kim', phone: null });
// @ts-expect-error: rows must match the writer's type
writer.write({ id: '1' });
assert<Equal<typeof writer, CsvWriter<User>>>();
createWriter({ columns: ['a'] }).write({ anything: true });

assert<Equal<ReturnType<typeof stringifyAsync<User>>, AsyncGenerator<string, void, undefined>>>();
assert<Equal<ReturnType<typeof stringifyStream<User>>, ReadableStream<Uint8Array>>>();
stringifyStream(users, { encoding: 'utf-16le' });
// @ts-expect-error: only utf-8 and utf-16le can be written
stringifyStream(users, { encoding: 'euc-kr' });

assert<Equal<ReturnType<typeof formatCell>, string>>();
formatCell(new Date(), { timeZone: 'Asia/Seoul', dateFormat: (date) => date.toISOString() });
// @ts-expect-error: booleans is a pair
formatCell(true, { booleans: ['Y'] });

assert<Equal<ReturnType<typeof parse>, string[][]>>();
assert<Equal<ReturnType<typeof parseObjects>, Record<string, string>[]>>();
assert<Equal<ReturnType<typeof decode>, Decoded>>();
parse(new Uint8Array(), { fallbackEncoding: ['euc-kr', 'windows-1252'] });
parse(new ArrayBuffer(0));
parseObjects('a', { headers: ['x'], strict: true });

const column: Column<User> = 'name';
const code: CsvErrorCode = 'FORMULA_REJECTED';
void column;
void code;
