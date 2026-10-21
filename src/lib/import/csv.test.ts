import { describe, expect, it } from "vitest";
import { MAX_CSV_ROWS, parseCsv } from "./csv";

const ok = (text: string) => {
  const r = parseCsv(text);
  if (!r.ok) throw new Error(r.error);
  return r;
};

describe("parseCsv", () => {
  it("parses headers and rows with line numbers", () => {
    const r = ok("a,b\n1,2\n3,4\n");
    expect(r.headers).toEqual(["a", "b"]);
    expect(r.rows).toEqual([
      { line: 2, cells: ["1", "2"] },
      { line: 3, cells: ["3", "4"] },
    ]);
  });

  it("lower-cases and trims headers, trims cells, strips a BOM", () => {
    const r = ok("﻿ Name , LAT \n  x  , 1 \n");
    expect(r.headers).toEqual(["name", "lat"]);
    expect(r.rows[0].cells).toEqual(["x", "1"]);
  });

  it("handles CRLF and skips blank lines without losing line numbers", () => {
    const r = ok("a\r\n\r\n1\r\n\r\n2\r\n");
    expect(r.rows.map((x) => [x.line, x.cells[0]])).toEqual([[3, "1"], [5, "2"]]);
  });

  it("handles quotes, commas, doubled quotes and embedded newlines", () => {
    const r = ok('a,b\n"x, y","say ""hi"""\n"line1\nline2",z\nlast,row\n');
    expect(r.rows[0].cells).toEqual(["x, y", 'say "hi"']);
    expect(r.rows[1].cells).toEqual(["line1\nline2", "z"]);
    expect(r.rows[2].line).toBe(5); // the embedded newline counts
  });

  it("keeps empty cells", () => {
    expect(ok("a,b,c\n1,,3\n").rows[0].cells).toEqual(["1", "", "3"]);
  });

  it("handles a file without a trailing newline", () => {
    expect(ok("a\n1").rows).toHaveLength(1);
  });

  it("reports an unterminated quote", () => {
    expect(parseCsv('a\n"oops\n')).toEqual({ ok: false, error: "A quoted field is never closed." });
  });

  it("reports an empty file", () => {
    expect(parseCsv("  \n \n")).toMatchObject({ ok: false });
  });

  it("rejects too many rows and too-large files", () => {
    const many = "a\n" + "1\n".repeat(MAX_CSV_ROWS + 1);
    expect(parseCsv(many)).toMatchObject({ ok: false });
    expect(parseCsv("a\n" + "x".repeat(2_000_001))).toMatchObject({ ok: false });
  });
});
