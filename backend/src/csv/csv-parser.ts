/**
 * Tiny RFC-4180 CSV parser. Bundled rather than pulling in
 * `papaparse` / `csv-parse` — admin imports are small (≤ 10k rows),
 * latency doesn't matter, and the zero-dep posture matches the rest
 * of the backend.
 *
 * Handles:
 *   - quoted fields containing commas / newlines / escaped quotes
 *     (`""` → `"`)
 *   - bare fields with optional trailing whitespace trimmed
 *   - CRLF, LF, and CR line terminators
 *   - empty trailing line (common from Excel exports)
 *
 * Doesn't handle: header inference (the caller passes the expected
 * header list), schema validation (per-importer job), encoding
 * detection (assume UTF-8; reject BOM only by stripping).
 *
 * Returns { headers, rows } where rows is `string[][]`. Empty cells
 * are empty strings, not undefined.
 */

export interface ParsedCsv {
  headers: string[];
  rows: string[][];
}

export function parseCsv(input: string): ParsedCsv {
  if (input.length === 0) return { headers: [], rows: [] };

  // Strip a leading UTF-8 BOM if present.
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;

  const records: string[][] = [];
  let field = '';
  let record: string[] = [];
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          // Escaped quote → literal "
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }

    // Outside quotes.
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ',') {
      record.push(field);
      field = '';
      i += 1;
      continue;
    }
    if (ch === '\n' || ch === '\r') {
      record.push(field);
      records.push(record);
      record = [];
      field = '';
      // Treat CRLF as one terminator.
      if (ch === '\r' && text[i + 1] === '\n') i += 2;
      else i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }

  // Flush the trailing field/record if the file didn't end with a terminator.
  if (field.length > 0 || record.length > 0) {
    record.push(field);
    records.push(record);
  }

  if (records.length === 0) return { headers: [], rows: [] };

  const headers = records[0].map((h) => h.trim());
  const rows = records.slice(1).filter((r) => {
    // Skip blank trailing lines.
    return !(r.length === 1 && r[0] === '');
  });
  return { headers, rows };
}
