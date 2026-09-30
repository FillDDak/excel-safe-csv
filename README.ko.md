# excel-csv

**엑셀이 망가뜨릴 수 없는 CSV를 만들고, 엑셀이 저장한 CSV를 그대로 읽습니다.**

[![npm](https://img.shields.io/npm/v/excel-csv.svg)](https://www.npmjs.com/package/excel-csv)
[![CI](https://github.com/fillddak/module/actions/workflows/ci.yml/badge.svg)](https://github.com/fillddak/module/actions/workflows/ci.yml)
![zero dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)
![types](https://img.shields.io/badge/types-TypeScript-blue)
[![license](https://img.shields.io/npm/l/excel-csv.svg)](./LICENSE)

[English](./README.md)

"CSV 다운로드" 버튼을 만들어 본 적이 있다면, 엑셀에서 파일을 열었을 때 이런 일을 겪어 보셨을 겁니다.

| 내보낸 데이터                         | 엑셀에 보이는 값                        | excel-csv 사용 시 |
| ------------------------------------ | --------------------------------------- | ----------------- |
| `02134` (우편번호), `007` (사번)       | `2134`, `7`                             | `02134`, `007`    |
| `1234567890123456789` (주문번호)      | `1.23457E+18` (뒷자리는 영영 사라짐)     | `1234567890123456789` |
| `MARCH1`, `SEPT2` (유전자 이름)        | `1-Mar`, `2-Sep`                        | `MARCH1`, `SEPT2` |
| `1/2`, `2024-01`                     | 날짜(`1월 2일`), `Jan-24`               | `1/2`, `2024-01`  |
| `1E5` (부품 번호)                     | `1.00E+05`                              | `1E5`             |
| `=HYPERLINK("http://evil…")`         | 실제로 동작하는 링크 (**CSV 인젝션**)     | 그냥 텍스트        |
| BOM 없는 `김철수`                      | `ê¹€ì² ìˆ˜` 같은 깨진 글자              | `김철수`           |

excel-csv는 이 문제들을 **데이터를 바꾸지 않고** 해결합니다. 넣은 값이 엑셀에 그대로 보입니다.
반대로 엑셀이 저장한 CSV(UTF-8, UTF-16, 한국어 윈도우의 CP949 등)도 정확히 읽어서, 사용자가 올린
파일을 바로 처리할 수 있습니다.

- **무손실**: 모든 문자열이 글자 그대로 표시됩니다. 잘리거나, 반올림되거나, 앞에 뭔가 붙지 않습니다.
- **안전**: 신뢰할 수 없는 데이터 속 수식은 절대 실행되지 않습니다([OWASP CSV Injection](https://owasp.org/www-community/attacks/CSV_Injection)).
- **타입 유지**: 숫자는 숫자로, 날짜는 진짜 날짜로, 불리언은 불리언으로 들어갑니다.
- **어디서나**: Node.js 18 이상, 브라우저, Deno, Bun, Cloudflare Workers. ESM·CommonJS 모두 지원, 의존성 0개, gzip 약 16 kB.
- **스트리밍**: DB 커서의 수백만 행을 메모리 걱정 없이 HTTP 응답으로 보낼 수 있습니다.
- **검증됨**: 테스트 270개, 커버리지 100%, 속성 기반 테스트, 실제 스프레드시트 엔진으로 결과를 열어 보는 E2E 테스트.

## 목차

- [설치](#설치)
- [빠른 시작](#빠른-시작)
- [활용 예시](#활용-예시)
- [동작 원리](#동작-원리)
- [API](#api)
- [옵션](#옵션)
- [명령줄 도구](#명령줄-도구)
- [호환성](#호환성)
- [자주 묻는 질문](#자주-묻는-질문)
- [테스트 방법](#테스트-방법)

## 설치

```sh
npm install excel-csv
# pnpm add excel-csv · yarn add excel-csv · bun add excel-csv · deno add npm:excel-csv
```

## 빠른 시작

```js
import { stringify } from 'excel-csv';

const csv = stringify(
  [
    {
      name: '김민지',
      phone: '010-1234-5678',
      zip: '02134',
      orderId: 1234567890123456789n,
      total: 42000,
      paidAt: new Date('2024-03-01T05:30:00Z'),
    },
  ],
  { timeZone: 'Asia/Seoul' },
);
```

```text
﻿name,phone,zip,orderId,total,paidAt
김민지,"=""010-1234-5678""","=""02134""","=""1234567890123456789""",42000,2024-03-01 14:30:00
```

엑셀에서 열면 `010-1234-5678`, `02134`, `1234567890123456789`는 쓴 그대로 보이고, `42000`은 합계를
낼 수 있는 숫자, `2024-03-01 14:30:00`은 진짜 날짜가 됩니다. 맨 앞의 `﻿`(BOM) 덕분에 엑셀이
UTF-8로 인식해 한글이 깨지지 않습니다.

열 선택과 한글 헤더는 객체 하나로 지정합니다.

```js
stringify(users, { columns: { name: '이름', phone: '전화번호', memo: '메모' } });
```

엑셀이 저장한 CSV는 인코딩과 상관없이 읽을 수 있습니다.

```js
import { parseObjects } from 'excel-csv';

const rows = parseObjects(await file.arrayBuffer(), { fallbackEncoding: 'cp949' });
// [{ 이름: '김민지', 전화번호: '010-1234-5678', ... }]
```

## 활용 예시

### 브라우저에서 다운로드 버튼

```js
import { stringify } from 'excel-csv';

function downloadCsv(rows, filename) {
  const blob = new Blob([stringify(rows)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = Object.assign(document.createElement('a'), { href: url, download: filename });
  link.click();
  URL.revokeObjectURL(url);
}
```

### Node.js: 파일 저장과 Express

```js
import { writeFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import { encode, stringify, stringifyAsync } from 'excel-csv';

// 파일로 저장
writeFileSync('report.csv', encode(stringify(rows)));

// 대용량 내보내기: 배열, 제너레이터, async iterable, DB 커서를 한 행씩 스트리밍
app.get('/export.csv', (req, res) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="export.csv"');
  Readable.from(stringifyAsync(db.streamOrders(), { columns: ['id', 'customer', 'total'] })).pipe(res);
});
```

> 한글 파일명을 쓰려면 `Content-Disposition`에 `filename*=UTF-8''${encodeURIComponent('주문내역.csv')}`
> 형식을 사용하세요.

### Fetch `Response`: Next.js, Remix, Hono, Bun, Deno, Cloudflare Workers

```js
import { stringifyStream } from 'excel-csv';

export async function GET() {
  return new Response(stringifyStream(await getOrders()), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="orders.csv"',
    },
  });
}
```

### 사용자가 올린 CSV 읽기

`parse`와 `parseObjects`는 문자열, `Uint8Array`, `Buffer`, `ArrayBuffer`, 모든 TypedArray를 받습니다.
인코딩은 BOM → UTF-8 → `fallbackEncoding` 순서로 판별합니다. 한국어 윈도우의 엑셀에서 "CSV(쉼표로
분리)"로 저장한 파일은 CP949이므로 `fallbackEncoding: 'cp949'`를 주면 됩니다.

```js
import { parse, parseObjects } from 'excel-csv';

parse(bytes, { fallbackEncoding: 'cp949' }); // 한국: CP949 / EUC-KR
parse(bytes, { fallbackEncoding: 'shift_jis' }); // 일본
parse(bytes, { fallbackEncoding: ['gbk', 'big5'] }); // 순서대로 시도
parse(bytes); // 기본값: windows-1252 (서유럽, 미주)
```

구분자(`,` `;` 탭 `|`)는 자동으로 감지하고, `sep=` 줄을 인식하며, excel-csv나 다른 도구가 쓴
`="…"` 셀은 원래 텍스트로 되돌립니다. 값은 항상 문자열로 반환되고, 어떤 변환도 하지 않습니다.

레거시 인코딩은 런타임의 `TextDecoder`에 의존합니다. Node.js, 브라우저, Deno는 모든
[WHATWG 인코딩](https://encoding.spec.whatwg.org/#names-and-labels)을, Bun은 주요 인코딩(CP949,
Shift_JIS, GBK, Big5, Windows-1252 등)을 지원합니다. 지원하지 않는 인코딩을 지정하면 `code`가
`INVALID_OPTION`인 `CsvError`가 발생합니다.

> **Node.js의 CP949 문제**: Node.js 내장 `TextDecoder('euc-kr')`는 CP949의 확장 한글 8,822자(`똠`,
> `햏`, `갂` 등)를 지원하지 않아 한국어 엑셀 파일의 일부 글자가 깨집니다. excel-csv는 이를 감지해
> WHATWG 표준을 그대로 따르는 자체 디코더를 사용하므로, 어떤 런타임에서도 한글이 정확히 읽힙니다.

### 유럽식 엑셀 (세미콜론, 소수점 쉼표)

유럽 대부분의 엑셀은 필드 구분자로 `;`, 소수점으로 `,`를 기대합니다.

```js
stringify(rows, {
  delimiter: ';',
  decimalSeparator: ',',
  booleans: ['WAHR', 'FALSCH'], // 엑셀은 불리언을 사용자 언어로 표시합니다
});
// product;price;date
// Kaffee;3,5;2024-01-31
```

또는 `stringifyStream(rows, { delimiter: '\t', encoding: 'utf-16le' })`로 엑셀의 "유니코드 텍스트"
형식을 만들면 어느 로캘에서나 올바르게 열립니다.

### 다른 CSV 라이브러리와 함께 쓰기

이미 Papa Parse, csv-stringify, fast-csv를 쓰고 있다면 각 값을 `formatCell`에 통과시키면 됩니다.

```js
import { formatCell } from 'excel-csv';
import { stringify } from 'csv-stringify/sync';

stringify(records, { cast: { string: (value) => formatCell(value) } });
Papa.unparse(records.map((record) => record.map((value) => formatCell(value))));
```

## 동작 원리

**문자열은 문자열로, 숫자는 숫자로.** excel-csv는 각 값을 자바스크립트 타입 그대로 엑셀에 보이도록
씁니다.

| 값                                  | 기록되는 형태                          | 엑셀에 보이는 값              |
| ----------------------------------- | -------------------------------------- | ----------------------------- |
| 엑셀이 바꾸지 않는 문자열             | 그대로: `Hello`                        | `Hello` (텍스트)              |
| 엑셀이 바꿔 버릴 문자열               | 텍스트 수식: `="007"`                  | `007` (텍스트)                |
| 수식처럼 보이는 문자열                | 텍스트 수식: `="=1+1"`                 | `=1+1` (텍스트, 실행되지 않음) |
| `number`, `bigint`                  | 그대로: `42`, `-1.5`, `1E+21`          | 숫자                          |
| 유효 숫자가 15자리를 넘는 정수        | 텍스트: `="1234567890123456789"`       | 모든 자릿수 (엑셀은 15자리까지만 저장) |
| `Date`                              | `timeZone` 기준 `2024-01-31 13:45:00`  | 날짜                          |
| `boolean`                           | `TRUE` / `FALSE`                       | 불리언                        |
| `null`, `undefined`                 | 빈 값                                  | 빈 셀                         |
| 배열, 일반 객체                      | JSON: `[1,2]`                          | 텍스트                        |
| 그 밖의 객체                         | `String(value)` (예: `URL`, `Decimal`) | 텍스트                        |

문자열은 엑셀이 바꿀 가능성이 있을 때만 보호합니다. 판별 함수(`wouldExcelConvert`)는 모든 표기법의
숫자, 퍼센트, 분수, 통화 금액, 모든 형식의 날짜와 시간, 엑셀이 지원하는 60여 개 로캘의 월·요일 이름
(Unicode CLDR에서 생성), 여러 언어의 불리언, `#N/A` 같은 오류 값을 다룹니다. 일부러 보수적으로
판단합니다. 애매하면 보호하는데, 보호해도 엑셀에 보이는 값은 절대 달라지지 않기 때문입니다.

왜 `="007"`일까요? 결과가 텍스트 `007`인 수식입니다. 엑셀과 구글 스프레드시트는 정확히 `007`로
표시하고, 텍스트로 정렬·필터링하며, 아무것도 실행하지 않습니다. 255자가 넘는 문자열은 `="…"&"…"`로
나누고(엑셀의 문자열 리터럴 한도), 줄바꿈은 `CHAR(10)`으로, 따옴표는 이스케이프하므로 어떤 텍스트든
그대로 복원됩니다. 다른 방식은 `protect` 옵션으로 고를 수 있습니다.

그 밖에 자동으로 처리하는 것들:

- 엑셀이 UTF-8을 인식하도록 BOM 추가 (`bom`)
- 구분자, 따옴표, 줄바꿈, 앞뒤 공백이 있는 필드의 따옴표 처리
- 첫 셀이 `ID`로 시작하면 엑셀이 SYLK 파일로 오인해 열지 못하는 문제
- 엑셀의 한계: 셀당 32,767자, 16,384열, 1,048,576행 (`limits`)
- 엑셀이 표현할 수 없는 날짜(1900년 이전, 9999년 이후)는 ISO 텍스트로 기록

## API

모든 함수는 이름 있는 내보내기(named export)이며, 발생하는 오류는 모두 [`CsvError`](#csverror)입니다.

### `stringify(rows, options?)`

객체나 배열의 배열(또는 모든 iterable)을 CSV 문자열로 바꿉니다.

```js
stringify([{ a: 1, b: 'x' }]); // '﻿a,b\r\n1,x\r\n'
stringify([[1, 'x'], [2, 'y']]); // '﻿1,x\r\n2,y\r\n' (배열 행은 기본적으로 헤더 없음)
```

`columns`가 없으면 모든 객체 행의 키를 처음 나온 순서대로 합쳐서 씁니다.

### `createWriter(options?)`

행을 하나씩 변환합니다. `write(row)`는 그 행의 텍스트를 반환하고(첫 호출은 BOM과 헤더 포함),
`end()`는 한 행도 쓰지 않았을 때 헤더를 반환하므로 빈 결과에도 헤더가 남습니다. `rowCount`는 쓴 행
수입니다.

```js
const writer = createWriter({ columns: ['id', 'name'] });
let csv = '';
for (const user of users) csv += writer.write(user);
csv += writer.end();
```

`columns`가 없으면 첫 행에서 열을 정하고, 이후 행에 모르는 키가 있으면 데이터를 조용히 버리는 대신
오류를 냅니다. 오류가 난 행은 작성기 상태를 바꾸지 않으므로 건너뛰고 계속 쓸 수 있습니다.

### `stringifyAsync(rows, options?)`

iterable 또는 async iterable을 받아 약 64 KB 단위 청크의 `AsyncGenerator<string>`을 반환합니다.
Node.js 스트림이 필요하면 `Readable.from(...)`을 쓰세요.

### `stringifyStream(rows, options?)`

`Response` 본문으로 바로 쓸 수 있는 웹 `ReadableStream<Uint8Array>`를 반환합니다.
`encoding: 'utf-8' | 'utf-16le'`(기본값 `'utf-8'`)를 지정할 수 있습니다.

### `formatCell(value, options?)`

셀 하나의 보호된 텍스트를 CSV 따옴표 처리 **없이** 반환합니다. [셀 옵션](#셀-옵션)과 `type`을 받습니다.

```js
formatCell('007'); // '="007"'
formatCell('=1+1'); // '="=1+1"'
formatCell(42); // '42'
formatCell(1234567890123456789n); // '="1234567890123456789"'
formatCell(new Date(Date.UTC(2024, 0, 31)), { timeZone: 'UTC' }); // '2024-01-31 00:00:00'
```

### `parse(input, options?)`

CSV 텍스트나 바이트를 `string[][]`로 파싱합니다. RFC 4180을 따르고, 잘못된 입력은 엑셀과 같은
방식으로 복구합니다(닫는 따옴표 뒤의 글자는 유지, 따옴표 없는 필드 속 따옴표는 문자 그대로, 닫히지
않은 따옴표는 끝까지). `strict: true`면 대신 오류를 냅니다.

```js
parse('﻿sep=;\r\nname;zip\r\nKim;"=""02134"""\r\n'); // [['name', 'zip'], ['Kim', '02134']]
```

| 옵션               | 기본값           | 설명 |
| ------------------ | ---------------- | ---- |
| `delimiter`        | `'auto'`         | `'auto'`는 `,` `;` 탭 `|` 중에서 감지합니다. `sep=` 줄이 있으면 항상 그것을 따릅니다. |
| `encoding`         | `'auto'`         | 바이트 입력의 인코딩. 모든 [WHATWG 레이블](https://encoding.spec.whatwg.org/#names-and-labels)과 `cp949`, `ms949`, `uhc`, `cp932`, `cp936`, `cp950`. BOM이 있으면 BOM이 우선합니다. |
| `fallbackEncoding` | `'windows-1252'` | 바이트가 올바른 UTF-8이 아닐 때 순서대로 시도할 인코딩. |
| `unwrapFormulas`   | `true`           | `="007"`을 `007`로 되돌립니다. |
| `skipEmptyLines`   | `false`          | 완전히 빈 줄을 건너뜁니다. |
| `strict`           | `false`          | 잘못된 입력에서 `PARSE_ERROR`(`line` 포함)를 던집니다. |

### `parseObjects(input, options?)`

`parse`와 같지만 헤더 행을 키로 하는 객체 배열을 반환합니다. 중복된 이름에는 접미사가 붙고(`name`,
`name_2`), 빠진 셀은 `''`, 헤더보다 많은 셀은 `column_<n>`으로 이름 붙습니다. `headers`로 이름을 직접
주면 첫 행도 데이터로 취급합니다. `strict: true`면 헤더와 길이가 다른 행에서 오류를 냅니다.

```js
parseObjects('name,zip\r\nKim,"=""02134"""\r\n'); // [{ name: 'Kim', zip: '02134' }]
```

### `decode(bytes, options?)`와 `encode(text, encoding?)`

`decode`는 `parse`와 같은 방식으로 인코딩을 판별해 `{ text, encoding, bom }`을 반환합니다.
`encode`는 텍스트를 `utf-8`(기본값) 또는 `utf-16le` 바이트로 바꾸며, 맨 앞의 `﻿`는 해당 인코딩의
BOM이 됩니다.

```js
decode(bytes, { fallbackEncoding: 'cp949' }); // { text: '한글', encoding: 'euc-kr', bom: false }
fs.writeFileSync('report.txt', encode(stringify(rows, { delimiter: '\t' }), 'utf-16le'));
```

### `wouldExcelConvert(text)`와 `isFormulaLike(text)`

보호 로직의 두 판별 함수를 그대로 공개합니다.

```js
wouldExcelConvert('007'); // true
wouldExcelConvert('3월 1일'); // true
wouldExcelConvert('Hello'); // false
isFormulaLike('=1+1'); // true
isFormulaLike('-5'); // true (엑셀은 -로 시작하면 수식으로 봅니다)
```

### `CsvError`

`error.code`는 `INVALID_OPTION`, `INVALID_ROW`, `INVALID_VALUE`, `FORMULA_REJECTED`, `CELL_TOO_LONG`,
`TOO_MANY_COLUMNS`, `TOO_MANY_ROWS`, `PARSE_ERROR`, `WRITER_CLOSED` 중 하나입니다. 해당하는 경우
`error.row`(0부터 세는 데이터 행), `error.column`(키 또는 인덱스), `error.line`(1부터 세는 줄, 파싱
오류), `error.cause`로 무엇이 실패했는지 정확히 알 수 있습니다.

### 상수

`MAX_ROWS`(1,048,576), `MAX_COLUMNS`(16,384), `MAX_CELL_LENGTH`(32,767).

## 옵션

### 출력 옵션

`stringify`, `createWriter`, `stringifyAsync`, `stringifyStream`에서 사용합니다.

| 옵션        | 기본값      | 설명 |
| ----------- | ----------- | ---- |
| `columns`   | 행에서 추출 | 키 / [열 정의](#열-정의)의 배열, 또는 `{ 키: '헤더' }`. |
| `header`    | `true`\*    | 헤더 행 작성 여부. \*`columns` 없이 배열 행을 쓰면 `false`. |
| `type`      | `'auto'`    | 모든 열의 기본 [열 타입](#열-타입). |
| `delimiter` | `','`       | `"`, CR, LF를 제외한 한 글자. |
| `newline`   | `'\r\n'`    | `'\r\n'` 또는 `'\n'`. |
| `bom`       | `true`      | UTF-8 BOM으로 시작합니다. 엑셀에서 한글이 깨지지 않으려면 필요합니다. |
| `sepHint`   | `false`     | 첫 줄에 `sep=,`를 써서 로캘과 상관없이 구분자를 지정합니다. 이때 엑셀이 BOM을 무시할 수 있으므로 ASCII 데이터나 `encoding: 'utf-16le'`와 함께 쓰세요. |
| `quote`     | `'auto'`    | `'always'`면 모든 필드를 따옴표로 감쌉니다. |

### 셀 옵션

`formatCell`에서도 사용합니다.

| 옵션               | 기본값          | 설명 |
| ------------------ | --------------- | ---- |
| `protect`          | `'formula'`     | 값을 텍스트로 유지하는 방법: `'formula'`(`="007"`, 무손실), `'tab'`(앞에 탭 추가, 탭이 값의 일부가 됨), `'none'`. `'tab'`과 `'none'`에서는 수식처럼 보이는 값 앞에 `'`를 붙입니다. |
| `formulas`         | `'neutralize'`  | `=` `+` `-` `@`, 탭, CR로 시작하는 값: `'neutralize'`(표시만, 실행 안 함), `'allow'`(`=`로 시작하는 문자열을 실제 수식으로. **신뢰할 수 있는 데이터에만**), `'throw'`(`FORMULA_REJECTED`). |
| `decimalSeparator` | `'.'`           | 유럽 대부분의 로캘은 `','`. |
| `dateFormat`       | `'datetime'`    | `'datetime'`(`2024-01-31 13:45:00`), `'date'`(`2024-01-31`)는 엑셀 날짜. `'iso'`(`2024-01-31T04:45:00.000Z`)나 `(date) => string` 함수는 텍스트. |
| `timeZone`         | `'local'`       | `'local'`, `'UTC'`, 또는 `'Asia/Seoul'` 같은 IANA 이름. 서버에서는 명시하는 것을 권장합니다. |
| `booleans`         | 엑셀 불리언     | `true` / `false` 대신 쓸 텍스트. 예: `['예', '아니오']`, `['Y', 'N']`. |
| `largeNumbers`     | `'text'`        | 유효 숫자 15자리를 넘는 정수: `'text'`는 모든 자릿수 유지, `'number'`는 엑셀의 반올림 허용. |
| `limits`           | `'error'`       | 엑셀 한계 초과 시: `'error'`는 오류, `'truncate'`는 긴 셀을 자름(행·열 초과는 여전히 오류), `'ignore'`. |

### 열 정의

```js
stringify(orders, {
  columns: [
    'id', // 키
    { key: 'customer', header: '고객명' }, // 키와 헤더
    { key: 'account', header: '계좌번호', type: 'text' }, // 키와 타입
    { header: '합계', value: (order) => order.price * order.quantity }, // 계산된 값
    { key: 0, header: '첫 열' }, // 배열 행은 인덱스
  ],
});
```

### 열 타입

| 타입       | 동작 |
| ---------- | ---- |
| `'auto'`   | 기본값. [동작 원리](#동작-원리)의 표대로 씁니다. |
| `'text'`   | 숫자와 날짜까지 모든 값을 보이는 그대로의 텍스트로 씁니다. 사번, 계좌번호, 우편번호, 사업자등록번호 등에 사용하세요. |
| `'number'` | `'auto'`와 같지만, 일반 십진 표기 문자열(`'1234.50'`, `'-7'`, `'1e3'`)은 숫자로 씁니다. 문자열로 오는 DB의 `DECIMAL` 열에 유용합니다. |
| `'raw'`    | 보호 없이 CSV 따옴표 처리만 합니다. **신뢰할 수 없는 데이터에는 위험합니다.** 직접 만든 수식에 사용하세요. |

```js
stringify([{ account: 12345, price: '1234.50', formula: '=SUM(B2:B9)' }], {
  columns: [
    { key: 'account', type: 'text' }, // ="12345"
    { key: 'price', type: 'number' }, // 1234.50
    { key: 'formula', type: 'raw' }, // =SUM(B2:B9)
  ],
});
```

헤더 셀은 항상 `'auto'` 문자열처럼 보호됩니다.

## 명령줄 도구

```sh
npx excel-csv fix export.csv -o export-for-excel.csv                 # 기존 CSV를 엑셀에서 안전하게 열리도록 변환
npx excel-csv from-json users.json -o users.csv                      # JSON 배열 → 엑셀용 CSV
npx excel-csv clean upload.csv --fallback-encoding cp949 > clean.csv  # 엑셀 CSV(CP949 등) → 일반 UTF-8 CSV
```

`fix`는 `42`, `-1.5`처럼 엑셀이 그대로 보여 주는 숫자는 숫자로 두고 나머지를 보호합니다. `--text`를
주면 숫자도 텍스트로 보호합니다. 전체 옵션(`--delimiter`, `--encoding utf-16le`, `--no-bom`,
`--protect`, `--formulas`, `--time-zone` 등)은 `npx excel-csv --help`로 확인하세요.

## 호환성

| 환경 | 지원 |
| ---- | ---- |
| Node.js | 18, 20, 22, 24 이상 (18, 20, 21, 22에서 테스트) |
| 브라우저 | 모든 최신 브라우저 (Chromium에서 테스트) |
| Deno, Bun | 지원 (Bun에서 테스트) |
| 엣지 런타임 | `TextDecoder`와 `ReadableStream`이 있는 Cloudflare Workers, Vercel Edge 등 |
| 모듈 | ESM과 CommonJS, 양쪽 모두 TypeScript 타입 선언 포함 |

보호된 셀(`="…"`)이 스프레드시트 프로그램에서 보이는 방식:

| 프로그램 | 결과 |
| -------- | ---- |
| Microsoft Excel (Windows, Mac, 웹) | 정확한 텍스트 |
| Google 스프레드시트 | 정확한 텍스트 |
| LibreOffice Calc | 기본 CSV 설정에서 정확한 텍스트(테스트에서 LibreOffice 24.2로 검증). 가져오기 대화 상자에서 "수식 계산"을 끄면 `="007"`로 보입니다. |
| CSV를 읽는 프로그램 | `="007"`. `parse()`나 `excel-csv clean`으로 `007`을 되찾거나, 스프레드시트용이 아니라면 `protect: 'tab'` / `'none'`을 쓰세요. |

## 자주 묻는 질문

**일부 셀에 작은 초록색 삼각형이 보여요.**
보호된 `007` 같은 값에 엑셀이 표시하는 "텍스트 형식으로 저장된 숫자" 안내입니다. 정상이며 무해합니다.
값은 내보낸 그대로입니다.

**수식 입력줄에 `="007"`이 보여요.**
네, 변환을 막기 위해 텍스트를 그렇게 담습니다. 셀 복사, 정렬, 필터는 모두 텍스트 `007`로 동작합니다.

**이 열은 진짜 숫자였으면 좋겠어요.**
문자열 대신 숫자를 넘기거나, 숫자 문자열 열에 `type: 'number'`를 지정하세요.

**그냥 `.xlsx`를 만들면 되지 않나요?**
가능하다면 그것도 좋습니다. 하지만 CSV는 의존성이 필요 없고, 일정한 메모리로 스트리밍할 수 있고,
모든 프로그램에서 열리며, 받는 사람이나 시스템이 CSV를 요구하는 경우도 많습니다. excel-csv는 CSV를
최대한 믿을 수 있게 만듭니다.

**보호가 다른 프로그램에서 읽을 때 데이터를 바꾸나요?**
보호된 셀만, 되돌릴 수 있는 방식으로 바뀝니다. `parse()`는 원래 텍스트를 돌려줍니다. 파일이 주로
프로그램용이라면 `protect: 'tab'`이나 `'none'`을 쓰세요.

**`formulas: 'allow'`는 안전한가요?**
직접 통제하는 데이터에서만 안전합니다. 신뢰할 수 없는 입력에서는 `=HYPERLINK(...)` 같은 셀이 실제
링크가 되어 데이터 유출이나 피싱에 악용될 수 있습니다. 기본값 `'neutralize'`는 항상 안전합니다.

## 테스트 방법

- **단위·통합 테스트 270개**, 라인·브랜치·함수·구문 커버리지 100%.
- **속성 기반 테스트**([fast-check](https://fast-check.dev)): 수만 개의 무작위 표로 구분자, 줄바꿈,
  BOM, 따옴표, `sep=`의 모든 조합에서 쓴 값이 그대로 읽히는지, 어떤 셀도 실행될 수 없는지, 파서가
  임의 입력에 예외를 던지지 않는지 검증합니다.
- **로캘 검증**: 60여 개 로캘에서 `Intl`로 서식화한 숫자, 통화, 날짜, 시간을 모두 감지해야 합니다.
- **실제 스프레드시트 엔진**: LibreOffice Calc가 수식 계산과 특수 숫자 감지를 켠 상태로 결과를 엽니다.
  까다로운 값과 무작위 값 수백 개가 글자 그대로 보여야 하고, 숫자와 날짜는 원래 타입이어야 하며,
  대조 실험으로 보호하지 않으면 같은 값이 망가진다는 것도 확인합니다.
- **CP949 기준 데이터**: 한글 디코더를 WHATWG 인덱스의 SHA-256, 그리고 무작위 바이트열에 대한 WHATWG
  준수 런타임의 결과와 비교합니다.
- **런타임**: Node.js 18, 20, 22(전체 테스트), 21과 Bun(스모크 테스트), Chromium(스모크 테스트),
  CommonJS/ESM 진입점, [publint](https://publint.dev),
  [Are the types wrong?](https://arethetypeswrong.github.io).

```sh
npm test                 # 단위, 속성, CLI, (LibreOffice가 있으면) 스프레드시트 테스트
npm run test:coverage    # 커버리지 100% 기준 포함
npm run check            # 타입 검사 + 커버리지 + 빌드 + 스모크 테스트 + 패키지 검사
```

## 라이선스

[MIT](./LICENSE)
