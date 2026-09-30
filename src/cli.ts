import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { CsvError, encode, parse, stringify, type OutputEncoding, type StringifyOptions } from './index';

declare const __VERSION__: string;

const HELP = `excel-csv — CSV files that Excel cannot mangle

Usage:
  excel-csv fix [input] [options]        Rewrite a CSV so Excel shows every value exactly
  excel-csv from-json [input] [options]  Convert a JSON array (of objects or arrays) to an Excel-safe CSV
  excel-csv clean [input] [options]      Convert a CSV saved by Excel (any encoding, sep= line,
                                         ="..." cells) to a plain UTF-8 CSV (no BOM) for other programs

  [input] is a file path; omit it or use "-" to read standard input.

Input options:
  --input-encoding <label>     Encoding of the input (default: auto — BOM, then UTF-8, then fallback)
  --fallback-encoding <label>  Encoding to use when the input is not UTF-8, e.g. euc-kr, shift_jis
                               (default: windows-1252)
  --input-delimiter <char>     Delimiter of the input CSV: "," ";" "tab" "|" (default: auto)

Output options:
  -o, --output <file>          Write to a file instead of standard output
  -d, --delimiter <char>       Output delimiter: "," ";" "tab" "|" (default: ",")
  --encoding <name>            utf-8 or utf-16le (default: utf-8)
  --no-bom                     Do not write a byte order mark
  --protect <strategy>         formula, tab or none (default: formula)
  --formulas <policy>          neutralize, allow or throw (default: neutralize)
  --text                       Write every value as text (by default "fix" keeps plain numbers
                               such as 42 or -1.5 as numbers; they are shown unchanged)
  --time-zone <zone>           Time zone for dates (from-json), e.g. Asia/Seoul (default: local)

  -h, --help                   Show this help
  -v, --version                Show the version

Examples:
  excel-csv fix export.csv -o export-for-excel.csv
  excel-csv from-json users.json -o users.csv
  excel-csv clean upload.csv --fallback-encoding euc-kr > clean.csv
`;

function fail(message: string): never {
  process.stderr.write(`excel-csv: ${message}\nRun "excel-csv --help" for usage.\n`);
  process.exit(2);
}

function delimiterOption(value: string | undefined, name: string): string | undefined {
  if (value === undefined) return undefined;
  if (value === 'tab' || value === '\\t') return '\t';
  if (value.length !== 1) fail(`--${name} must be a single character or "tab".`);
  return value;
}

/**
 * Returns a number for strings Excel would read back unchanged ("42", "-1.5"),
 * so numeric columns stay summable; everything else stays a string.
 */
function canonicalNumber(value: string): string | number {
  if (!/^-?(?:0|[1-9]\d*)(?:\.\d*[1-9])?$/.test(value)) return value;
  const number = Number(value);
  return String(number) === value && value.replace(/^-?0*\.?0*/, '').replace('.', '').length <= 15 ? number : value;
}

function readInput(path: string | undefined): Uint8Array {
  try {
    return readFileSync(path === undefined || path === '-' ? 0 : path);
  } catch (error) {
    fail(`cannot read ${path ?? 'standard input'}: ${(error as Error).message}`);
  }
}

function main(argv: string[]): void {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        output: { type: 'string', short: 'o' },
        delimiter: { type: 'string', short: 'd' },
        'input-delimiter': { type: 'string' },
        'input-encoding': { type: 'string' },
        'fallback-encoding': { type: 'string' },
        encoding: { type: 'string' },
        'no-bom': { type: 'boolean' },
        protect: { type: 'string' },
        formulas: { type: 'string' },
        text: { type: 'boolean' },
        'time-zone': { type: 'string' },
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' },
      },
    });
  } catch (error) {
    fail((error as Error).message);
  }
  const { values, positionals } = parsed;
  if (values.help === true) {
    process.stdout.write(HELP);
    return;
  }
  if (values.version === true) {
    process.stdout.write(`${__VERSION__}\n`);
    return;
  }
  const [command, input, ...extra] = positionals;
  if (command === undefined) {
    process.stdout.write(HELP);
    process.exit(2);
  }
  if (!['fix', 'from-json', 'clean'].includes(command)) fail(`unknown command "${command}".`);
  if (extra.length > 0) fail(`unexpected argument "${extra[0]}".`);

  const encoding = (values.encoding ?? 'utf-8') as OutputEncoding;
  if (encoding !== 'utf-8' && encoding !== 'utf-16le') fail('--encoding must be utf-8 or utf-16le.');

  const output: Omit<StringifyOptions, 'columns'> = {
    bom: values['no-bom'] !== true,
    ...(values.protect === undefined ? {} : { protect: values.protect as StringifyOptions['protect'] & string }),
    ...(values.formulas === undefined ? {} : { formulas: values.formulas as StringifyOptions['formulas'] & string }),
  };
  const outDelimiter = delimiterOption(values.delimiter, 'delimiter');
  if (outDelimiter !== undefined) output.delimiter = outDelimiter;

  const bytes = readInput(input);
  let csv: string;
  if (command === 'from-json') {
    let data: unknown;
    try {
      data = JSON.parse(new TextDecoder().decode(bytes));
    } catch (error) {
      fail(`input is not valid JSON: ${(error as Error).message}`);
    }
    if (!Array.isArray(data)) fail('the JSON input must be an array of objects or arrays.');
    if (values.text === true) output.type = 'text';
    if (values['time-zone'] !== undefined) output.timeZone = values['time-zone'];
    csv = stringify(data, output);
  } else {
    const inDelimiter = delimiterOption(values['input-delimiter'], 'input-delimiter');
    const rows = parse(bytes, {
      ...(inDelimiter === undefined ? {} : { delimiter: inDelimiter }),
      ...(values['input-encoding'] === undefined ? {} : { encoding: values['input-encoding'] }),
      ...(values['fallback-encoding'] === undefined ? {} : { fallbackEncoding: values['fallback-encoding'] }),
    });
    if (command === 'clean') {
      csv = stringify(rows, { ...output, type: 'raw', bom: values['no-bom'] !== true && encoding === 'utf-16le' });
    } else if (values.text === true) {
      csv = stringify(rows, output);
    } else {
      csv = stringify(
        rows.map((row) => row.map(canonicalNumber)),
        output,
      );
    }
  }

  const result = encode(csv, encoding);
  if (values.output === undefined) {
    process.stdout.write(result);
  } else {
    try {
      writeFileSync(values.output, result);
    } catch (error) {
      fail(`cannot write ${values.output}: ${(error as Error).message}`);
    }
  }
}

// Exit quietly when the reader goes away (e.g. `excel-csv fix big.csv | head`).
process.stdout.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EPIPE') process.exit(0);
  throw error;
});

try {
  main(process.argv.slice(2));
} catch (error) {
  if (error instanceof CsvError) fail(error.message);
  throw error;
}
