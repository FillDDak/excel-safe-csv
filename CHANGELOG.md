# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [1.0.0] - 2026-09-30

First release.

### Added

- `stringify`, `createWriter`, `stringifyAsync` and `stringifyStream` write CSV that Excel opens
  without changing any value: strings Excel would convert (leading zeros, long IDs, dates, gene
  names, scientific notation, booleans, error values, …) are kept as text, and formula-like values
  are neutralized against CSV injection.
- Native numbers, dates (with time zone support) and booleans; integers beyond Excel's 15-digit
  precision kept as text; Excel's cell, row and column limits enforced.
- Column selection, renaming, computed columns and per-column types (`auto`, `text`, `number`, `raw`).
- `parse` and `parseObjects` read CSV files produced by Excel: BOM and encoding detection (UTF-8,
  UTF-16, CP949 and other legacy code pages), `sep=` lines, delimiter detection, `="…"` cells.
- A WHATWG-conformant CP949 decoder, used when the runtime's `TextDecoder` lacks the CP949 extension
  (Node.js).
- `formatCell`, `wouldExcelConvert` and `isFormulaLike` for use with other CSV libraries.
- `encode` / `decode` helpers, including UTF-16LE output.
- The `excel-safe-csv` command line tool with `fix`, `from-json` and `clean` commands.

[1.0.0]: https://github.com/fillddak/module/releases/tag/v1.0.0
