# Security policy

## Scope

excel-safe-csv's main security property is that **untrusted values can never become live spreadsheet
formulas** ("CSV injection" or "formula injection", see
[OWASP](https://owasp.org/www-community/attacks/CSV_Injection)) unless you explicitly opt out with
`formulas: 'allow'` or `type: 'raw'`.

A value that, written with the default options, is evaluated as a formula by Microsoft Excel,
Google Sheets or LibreOffice Calc is a security bug. So is a value that makes the parser hang.

## Reporting a vulnerability

Please report vulnerabilities privately through
[GitHub security advisories](https://github.com/FillDDak/excel-safe-csv/security/advisories/new) rather than
in a public issue. Include the value(s), the options used and the spreadsheet application and
version. You will receive a response within a few days.

## Supported versions

Security fixes are released for the latest major version.
