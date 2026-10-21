export type CsvRow = {
  /** Line in the file where the record starts (the header is line 1). */
  line: number;
  cells: string[];
};

export type ParsedCsv =
  | { ok: true; headers: string[]; rows: CsvRow[] }
  | { ok: false; error: string };

export const MAX_CSV_BYTES = 2_000_000;
export const MAX_CSV_ROWS = 5000;

/**
 * Minimal RFC 4180 parser: quoted fields, doubled quotes, embedded newlines,
 * CRLF/LF, optional UTF-8 BOM. Blank lines are skipped. Headers are trimmed
 * and lower-cased; cells are trimmed.
 */
export function parseCsv(input: string): ParsedCsv {
  if (input.length > MAX_CSV_BYTES) {
    return { ok: false, error: `The file is larger than ${MAX_CSV_BYTES / 1_000_000} MB.` };
  }
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;

  const records: CsvRow[] = [];
  let cells: string[] = [];
  let cell = "";
  let inQuotes = false;
  let wasQuoted = false;
  let line = 1;
  let recordLine = 1;
  let started = false;

  const endCell = () => {
    cells.push(wasQuoted ? cell : cell.trim());
    cell = "";
    wasQuoted = false;
  };
  const endRecord = () => {
    endCell();
    if (cells.some((c) => c !== "")) records.push({ line: recordLine, cells });
    cells = [];
    started = false;
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (!started) {
      recordLine = line;
      started = true;
    }
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        if (ch === "\n") line++;
        cell += ch;
      }
      continue;
    }
    if (ch === '"' && cell.trim() === "") {
      inQuotes = true;
      wasQuoted = true;
      cell = "";
    } else if (ch === ",") {
      endCell();
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      endRecord();
      line++;
    } else {
      cell += ch;
    }
  }
  if (inQuotes) return { ok: false, error: "A quoted field is never closed." };
  if (started) endRecord();

  if (records.length === 0) return { ok: false, error: "The file is empty." };
  const [head, ...rows] = records;
  if (rows.length > MAX_CSV_ROWS) {
    return { ok: false, error: `The file has more than ${MAX_CSV_ROWS} rows. Split it into smaller files.` };
  }
  return {
    ok: true,
    headers: head.cells.map((h) => h.trim().toLowerCase()),
    rows,
  };
}
