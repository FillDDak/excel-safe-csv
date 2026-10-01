import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { encode, parse } from '../src/index';
import packageJson from '../package.json';

const CLI = join(__dirname, '..', 'dist', 'cli.js');
const BOM = '﻿';

function run(args: string[], input?: string | Uint8Array): { stdout: string; stderr: string; status: number | null; bytes: Buffer } {
  const result = spawnSync(process.execPath, [CLI, ...args], { input });
  return { stdout: result.stdout.toString('utf8'), stderr: result.stderr.toString('utf8'), status: result.status, bytes: result.stdout };
}

const tmp = (): string => mkdtempSync(join(tmpdir(), 'excel-safe-csv-cli-'));

describe('excel-safe-csv CLI', () => {
  it('prints help and version', () => {
    const help = run(['--help']);
    expect(help.status).toBe(0);
    expect(help.stdout).toMatch(/^excel-safe-csv — CSV files that Excel cannot mangle/);
    expect(help.stdout).toMatch(/excel-safe-csv fix/);
    expect(run(['-h']).stdout).toBe(help.stdout);
    expect(run(['--version']).stdout).toBe(`${packageJson.version}\n`);
    expect(run(['-v']).status).toBe(0);
  });

  it('prints help and fails without a command', () => {
    const result = run([]);
    expect(result.status).toBe(2);
    expect(result.stdout).toMatch(/Usage:/);
  });

  it('rejects unknown commands, options and extra arguments', () => {
    expect(run(['explode'])).toMatchObject({ status: 2, stderr: expect.stringMatching(/unknown command "explode"/) });
    expect(run(['fix', '--bogus'])).toMatchObject({ status: 2, stderr: expect.stringMatching(/Unknown option '--bogus'/) });
    expect(run(['fix', 'a.csv', 'b.csv'])).toMatchObject({ status: 2, stderr: expect.stringMatching(/unexpected argument "b.csv"/) });
    expect(run(['fix', '--encoding', 'latin1'], 'a')).toMatchObject({ status: 2, stderr: expect.stringMatching(/--encoding must be/) });
    expect(run(['fix', '-d', ';;'], 'a')).toMatchObject({ status: 2, stderr: expect.stringMatching(/--delimiter must be a single character/) });
    expect(run(['fix', '--protect', 'maybe'], 'a')).toMatchObject({ status: 2, stderr: expect.stringMatching(/Invalid option "protect"/) });
  });

  describe('fix', () => {
    it('protects values and keeps plain numbers numeric', () => {
      const result = run(['fix'], 'id,zip,amount,phone,formula\n1,007,1.50,010-1234-5678,=1+1\n2,02134,-3.25,+82 10,@x\n');
      expect(result.status).toBe(0);
      expect(result.stdout).toBe(
        `${BOM}"ID",zip,amount,phone,formula\r\n`.replace('"ID"', 'id') +
          '1,"=""007""","=""1.50""","=""010-1234-5678""","=""=1+1"""\r\n' +
          '2,"=""02134""",-3.25,"=""+82 10""","=""@x"""\r\n',
      );
      expect(parse(result.bytes)).toEqual([
        ['id', 'zip', 'amount', 'phone', 'formula'],
        ['1', '007', '1.50', '010-1234-5678', '=1+1'],
        ['2', '02134', '-3.25', '+82 10', '@x'],
      ]);
    });

    it('keeps numbers as text with --text', () => {
      expect(run(['fix', '--text', '--no-bom'], 'a\n1\n').stdout).toBe('a\r\n"=""1"""\r\n');
    });

    it('does not turn lossy numbers into numbers', () => {
      expect(run(['fix', '--no-bom'], '0.10,-0,1234567890123456,00,1e5,5.\n').stdout).toBe(
        '"=""0.10""","=""-0""","=""1234567890123456""","=""00""","=""1e5""","=""5."""\r\n',
      );
      expect(run(['fix', '--no-bom'], '0,-1,0.5,123456789012345\n').stdout).toBe('0,-1,0.5,123456789012345\r\n');
    });

    it('reads CP949 input and writes UTF-16LE', () => {
      const cp949 = new Uint8Array([0xc0, 0xcc, 0xb8, 0xa7, 0x09, 0x8c, 0x63, 0x0d, 0x0a, 0x30, 0x37, 0x09, 0x31]);
      const result = run(['fix', '--fallback-encoding', 'cp949', '--encoding', 'utf-16le', '-d', 'tab'], cp949);
      expect([...result.bytes.subarray(0, 2)]).toEqual([0xff, 0xfe]);
      expect(parse(result.bytes)).toEqual([
        ['이름', '똠'],
        ['07', '1'],
      ]);
      expect(result.bytes.toString('utf16le')).toBe(`${BOM}이름\t똠\r\n"=""07"""\t1\r\n`);
    });

    it('honours input and output options', () => {
      const result = run(['fix', '--input-delimiter', ';', '--input-encoding', 'utf-8', '-d', ';', '--protect', 'tab', '--formulas', 'allow'], 'a;b\n007;=SUM(1)\n');
      expect(result.stdout).toBe(`${BOM}a;b\r\n"\t007";=SUM(1)\r\n`);
      expect(run(['fix', '--input-delimiter', 'tab', '--no-bom'], 'a\tb,c\n').stdout).toBe('a,"b,c"\r\n');
      expect(run(['fix', '--input-delimiter', '\\t', '--no-bom'], 'a\tb\n').stdout).toBe('a,b\r\n');
      expect(run(['fix', '--formulas', 'throw'], '=1\n')).toMatchObject({ status: 2, stderr: expect.stringMatching(/would be evaluated as a formula/) });
    });

    it('reads and writes files', () => {
      const dir = tmp();
      writeFileSync(join(dir, 'in.csv'), 'zip\n007\n');
      const result = run(['fix', join(dir, 'in.csv'), '-o', join(dir, 'out.csv')]);
      expect(result).toMatchObject({ status: 0, stdout: '' });
      expect(readFileSync(join(dir, 'out.csv'), 'utf8')).toBe(`${BOM}zip\r\n"=""007"""\r\n`);
      expect(run(['fix', '-'], 'a\n').stdout).toBe(`${BOM}a\r\n`);
    });

    it('reports unreadable input and unwritable output', () => {
      const dir = tmp();
      expect(run(['fix', join(dir, 'missing.csv')])).toMatchObject({ status: 2, stderr: expect.stringMatching(/cannot read .*missing\.csv/) });
      expect(run(['fix', '-o', join(dir, 'no', 'such', 'dir.csv')], 'a')).toMatchObject({
        status: 2,
        stderr: expect.stringMatching(/cannot write/),
      });
    });
  });

  describe('from-json', () => {
    it('converts objects and arrays', () => {
      expect(run(['from-json'], '[{"name":"Kim","zip":"02134","n":1.5,"ok":true,"none":null}]').stdout).toBe(
        `${BOM}name,zip,n,ok,none\r\nKim,"=""02134""",1.5,TRUE,\r\n`,
      );
      expect(run(['from-json', '--no-bom'], '[[1,"007"],[2]]').stdout).toBe('1,"=""007"""\r\n2\r\n');
      expect(run(['from-json', '--no-bom', '--text'], '[[1]]').stdout).toBe('"=""1"""\r\n');
      expect(run(['from-json', '--no-bom', '-d', ';'], '[[1,2]]').stdout).toBe('1;2\r\n');
    });

    it('accepts a time zone option', () => {
      expect(run(['from-json', '--no-bom', '--time-zone', 'Asia/Seoul'], '[["2024-01-01T00:00:00Z"]]').stdout).toBe(
        '"=""2024-01-01T00:00:00Z"""\r\n',
      );
      expect(run(['from-json', '--time-zone', 'Nowhere/City'], '[[1]]')).toMatchObject({ status: 2, stderr: expect.stringMatching(/unknown time zone/) });
    });

    it('rejects invalid JSON and non-arrays', () => {
      expect(run(['from-json'], '{')).toMatchObject({ status: 2, stderr: expect.stringMatching(/not valid JSON/) });
      expect(run(['from-json'], '{"a":1}')).toMatchObject({ status: 2, stderr: expect.stringMatching(/must be an array/) });
      expect(run(['from-json'], '[1]')).toMatchObject({ status: 2, stderr: expect.stringMatching(/Row 0 must be an array or an object/) });
    });
  });

  describe('clean', () => {
    it('converts an Excel CSV to plain UTF-8 without BOM', () => {
      const excel = encode(`${BOM}sep=;\r\nname;zip\r\nKim;"=""02134"""\r\n`);
      expect(run(['clean'], excel).stdout).toBe('name,zip\r\nKim,02134\r\n');
    });

    it('writes values raw, even formulas', () => {
      expect(run(['clean'], 'a\n=1+1\n007\n').stdout).toBe('a\r\n=1+1\r\n007\r\n');
    });

    it('decodes legacy encodings', () => {
      const cp949 = new Uint8Array([0xc7, 0xd1, 0xb1, 0xdb, 0x2c, 0x31]);
      expect(run(['clean', '--fallback-encoding', 'euc-kr'], cp949).stdout).toBe('한글,1\r\n');
      expect(run(['clean', '--input-encoding', 'euc-kr'], cp949).stdout).toBe('한글,1\r\n');
    });

    it('writes a BOM for UTF-16LE output', () => {
      const result = run(['clean', '--encoding', 'utf-16le'], 'a\n');
      expect(result.bytes.toString('utf16le')).toBe(`${BOM}a\r\n`);
      expect(run(['clean', '--encoding', 'utf-16le', '--no-bom'], 'a\n').bytes.toString('utf16le')).toBe('a\r\n');
    });
  });
});
