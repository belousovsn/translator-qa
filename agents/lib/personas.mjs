import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

// A persona file is Markdown with a small `key: value` front matter.
export function parsePersona(file) {
  const text = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const m = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error(`${file}: no front matter`);
  const meta = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (kv) meta[kv[1]] = kv[2].trim();
  }
  for (const key of ['id', 'name', 'device', 'locale', 'account']) {
    if (!meta[key]) throw new Error(`${file}: missing "${key}"`);
  }
  return { ...meta, body: m[2].trim(), file };
}

export function loadPersonas(dir) {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((f) => parsePersona(path.join(dir, f)));
}

/** Personas that need test accounts wait until accounts are provisioned (#747). */
export function isRunnable(persona) {
  return persona.account === 'guest';
}
