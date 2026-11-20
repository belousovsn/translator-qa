// Telegram summary of a run, through the digest bot. Silent when the bot is not configured.
export async function sendTelegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (process.env.DRY_RUN || !token || !chatId) {
    console.log(`--- Telegram${token ? ' (dry run)' : ' (not configured)'} ---\n${text}\n---`);
    return;
  }
  for (const part of splitMessage(text)) {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: part, disable_web_page_preview: true }),
    });
    // The token is part of the URL, so only the status and Telegram's answer are printed.
    if (!res.ok) console.error(`Telegram answered ${res.status}: ${await res.text()}`);
  }
}

// Telegram takes at most 4096 characters per message, so a long summary goes in parts, cut at line ends.
export function splitMessage(text, limit = 4000) {
  const parts = [];
  let cur = '';
  for (const line of text.split('\n')) {
    for (let l = line; ; l = l.slice(limit)) {
      const piece = l.slice(0, limit);
      if (cur && cur.length + 1 + piece.length > limit) parts.push(cur), (cur = '');
      cur = cur ? `${cur}\n${piece}` : piece;
      if (l.length <= limit) break;
    }
  }
  if (cur) parts.push(cur);
  return parts;
}

import { anchor } from './site.mjs';
import { describeTriage } from './triage.mjs';
import { isShown, mergeFindings } from './verify.mjs';

const SEVERITY = { high: 'серьёзно', medium: 'средне', low: 'мелочь' };
const ORDER = { high: 0, medium: 1, low: 2 };

/**
 * One block per persona: goals, then only the findings that survived the
 * verifier, worst first, each with where it happened and a link to it on the page.
 */
export function summarize(runs, { pageUrl, decision, deploy, triage, pending }) {
  const page = pageUrl?.replace(/\/?$/, '/');
  const lines = [`QA-агенты: ${runs.length} ${runs.length === 1 ? 'персонаж' : 'персонажа'}`];
  if (deploy) lines.push(deploy.summary ? `${deploy.head}: ${deploy.summary}` : deploy.head);
  if (decision?.waitedMin) lines.push(`ждали сброса лимита ${decision.waitedMin} мин`);
  for (const run of runs) {
    const r = run.report;
    if (!r) {
      lines.push('', `${run.persona.name}: отчёта нет (${run.meta.status}${run.meta.error ? `: ${run.meta.error}` : ''})`);
      continue;
    }
    const goals = r.goals ?? [];
    const reached = goals.filter((g) => g.reached).length;
    const all = mergeFindings(r, run.verify);
    const shown = all.filter(isShown).sort((a, b) => (ORDER[a.severity] ?? 3) - (ORDER[b.severity] ?? 3));
    const dropped = all.length - shown.length;
    const check = run.verify?.error ? ', проверка не прошла' : !run.verify ? ', не проверено' : dropped ? `, отсеяно ${dropped}` : '';
    lines.push('', `${run.persona.name}: цели ${reached}/${goals.length}, находок ${shown.length}${check}`);
    for (const f of shown.slice(0, 6)) {
      const where = f.where?.screen ? `${f.where.screen}: ` : '';
      const link = page && run.rel ? `\n  ${page}#${anchor(run, f.id)}` : '';
      lines.push(`• ${SEVERITY[f.severity] ?? f.severity} · ${where}${f.observed}${link}`);
    }
    if (shown.length > 6) lines.push(`…и ещё ${shown.length - 6}`);
  }
  lines.push(...describeTriage(triage));
  if (pending) lines.push('', `Ждут твоего решения: ${pending}${page ? `\n  ${page}#pending` : ''}`);
  else if (page) lines.push('', page);
  return lines.join('\n');
}
