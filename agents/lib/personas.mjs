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

// Which test accounts a persona signs in with: names of QA_<KEY>_EMAIL and
// QA_<KEY>_PASSWORD in the secrets file. The persona types these names; the
// browser tool puts in the real values, so the model never sees a password.
export const ACCOUNTS = {
  guest: [],
  veteran: ['VETERAN'],
  signin: ['SIGNIN'],
  pair: ['PAIR_A', 'PAIR_B'],
};

export const SECRETS_FILE = process.env.QA_AGENTS_SECRETS ?? '/var/lib/qa-agents/secrets.env';

function secretNames() {
  try {
    return new Set(readFileSync(SECRETS_FILE, 'utf8').split('\n').map((l) => l.slice(0, l.indexOf('='))).filter(Boolean));
  } catch {
    return new Set();
  }
}

/** A persona runs when it is a guest or every account it needs is in the secrets file. */
export function isRunnable(persona) {
  const keys = ACCOUNTS[persona.account];
  if (!keys) return false;
  const names = secretNames();
  return keys.every((k) => names.has(`QA_${k}_EMAIL`) && names.has(`QA_${k}_PASSWORD`));
}
