/**
 * A small RFC 4180 reader: quoted fields, doubled quotes, CRLF. Enough for
 * hand-filled templates and Google Trends exports, with no dependency.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Rows as objects keyed by a lowercased header; blank lines dropped. */
export function readTable(text: string): Record<string, string>[] {
  const rows = parseCsv(text).filter((r) => r.some((f) => f.trim() !== ''));
  const [header, ...body] = rows;
  if (!header) return [];
  const keys = header.map((h) => h.trim().toLowerCase());
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? '').trim()])));
}

export function toCsv(rows: (string | number)[][]): string {
  const cell = (v: string | number) => {
    const s = String(v);
    return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  return `${rows.map((r) => r.map(cell).join(',')).join('\n')}\n`;
}

/** "1,234", "$12.50", "48,000+ results", "1.2k" → a number; blank or junk → null. */
export function parseNumber(s: string | undefined): number | null {
  if (!s) return null;
  const m = s.replace(/[,$\s]/g, '').match(/(-?\d+(?:\.\d+)?)([km])?/i);
  if (!m) return null;
  const scale = { k: 1_000, m: 1_000_000 }[(m[2] ?? '').toLowerCase() as 'k' | 'm'] ?? 1;
  return Math.round(Number(m[1]) * scale * 100) / 100;
}

export function parseFlag(s: string | undefined): boolean {
  return /^(y|yes|true|1|x)$/i.test((s ?? '').trim());
}
