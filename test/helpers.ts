/**
 * True if a spreadsheet may evaluate `cell` as a formula: a formula character
 * after optional whitespace and invisible characters. (Unlike isFormulaLike,
 * a leading tab or CR followed by ordinary text is not executable.)
 */
export const executable = (cell: string): boolean =>
  /^[\s\p{Cc}\p{Cf}\u{ad}\u{180e}\u{2028}-\u{202f}]*[=+\-@−﹢﹣﹦＋－＝＠]/u.test(cell);
