import { createHash } from 'node:crypto';

/**
 * JSON with object keys sorted at every depth, so equal values always hash
 * the same. Config and prompt versions are hashes of this (ADR 0002).
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

export function sha256(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

/** A short, stable version id for a config or prompt. */
export function versionOf(value: unknown): string {
  return sha256(stableStringify(value)).slice(0, 12);
}
