// Telegram summary of a run, through the digest bot. Silent when the bot is not configured.
export async function sendTelegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (process.env.DRY_RUN || !token || !chatId) {
    console.log(`--- Telegram${token ? ' (dry run)' : ' (not configured)'} ---\n${text}\n---`);
    return;
  }
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
  });
  // The token is part of the URL, so only the status and Telegram's answer are printed.
  if (!res.ok) console.error(`Telegram answered ${res.status}: ${await res.text()}`);
}

const SEVERITY = { high: 'серьёзно', medium: 'средне', low: 'мелочь' };

export function summarize(runs, { pageUrl, decision }) {
  const lines = [`QA-агенты: ${runs.length} ${runs.length === 1 ? 'персонаж' : 'персонажа'}`];
  if (decision?.waitedMin) lines.push(`ждали сброса лимита ${decision.waitedMin} мин`);
  for (const run of runs) {
    const r = run.report;
    if (!r) {
      lines.push('', `${run.persona.name}: отчёта нет (${run.meta.status}${run.meta.error ? `: ${run.meta.error}` : ''})`);
      continue;
    }
    const goals = r.goals ?? [];
    const reached = goals.filter((g) => g.reached).length;
    const findings = r.findings ?? [];
    lines.push('', `${run.persona.name}: шагов ${r.steps?.length ?? 0}, цели ${reached}/${goals.length}, находок ${findings.length}${r.known?.length ? `, известных ${r.known.length}` : ''}`);
    for (const f of findings.slice(0, 5)) {
      lines.push(`• ${f.id} [${SEVERITY[f.severity] ?? f.severity}] ${f.observed}`);
    }
    if (findings.length > 5) lines.push(`…и ещё ${findings.length - 5}`);
  }
  if (pageUrl) lines.push('', pageUrl);
  return lines.join('\n');
}
