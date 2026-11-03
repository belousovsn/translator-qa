import { describePlan } from './events.mjs';

export const REPORT_START = '<<<REPORT';
export const REPORT_END = 'REPORT>>>';

// Builds the task for one persona run. The persona plays a user, performs the
// planned environment events, judges what it sees by the shared rules, and ends
// with one JSON report that the runner parses.
export function buildPrompt({ persona, baseUrl, rules, accepted, plan, maxActions, focus = '' }) {
  return `Ты тестировщик, который играет роль пользователя приложения MemDecks на тестовом стенде ${baseUrl}. У тебя есть браузер через инструменты browser_*. Других инструментов нет и не нужно.

# Твоя роль

${persona.name}. Устройство: ${persona.device}. Язык браузера: ${persona.locale}. Тема: ${persona.colorScheme ?? 'light'}. ${persona.account === 'guest' ? 'Аккаунта нет, ты гость.' : ''}

${persona.body}

Веди себя как этот человек: выбирай путь сам, ошибайся так, как ошибался бы он, бросай то, что ему надоело бы. Ты не проверяешь заранее заданный список. Ты живёшь в приложении и замечаешь, что не так.

# События среды

${describePlan(plan)}
${focus ? `
${focus}
` : ''}
# Как судить

Нарушение любого правила ниже записывается как находка со ссылкой на номер правила. Если увиденное совпадает с записью из списка принятых находок, записывай его в "known", а не в "findings".

${rules}

${accepted}

# Порядок работы

1. Первым действием вызови browser_start_tracing. Последним действием перед отчётом вызови browser_stop_tracing.
2. Открой ${baseUrl} и иди к своим целям.
3. Ориентируйся по browser_snapshot. Скриншот (browser_take_screenshot) делай, когда что-то выглядит странно, и обязательно на каждую находку. Имя файла давай вида finding-F1.png.
3a. Снимок с именем файла тебе не показывается. Поэтому перед тем как записать находку, сделай обычный снимок без имени и посмотри на него. Если на нём проблемы уже нет, находка звучит иначе: например, «экран X держался 8 секунд без подсказки», а не «X завис». Пиши в observed только то, что видно на последнем снимке или в консоли и сети.
3b. Игры открываются во фрейме. Кнопки внутри него ищи через browser_snapshot или page.frameLocator('iframe'). Нажатие на сам фрейм по центру не проверяет игру.
4. После каждого заметного действия смотри browser_console_messages с level "error" и browser_network_requests, если что-то пошло не так.
5. Лимит: около ${maxActions} действий с браузером. Если цели достигнуты раньше, заканчивай.
6. Не уходи на чужие сайты, кроме тех, что названы в событиях среды. Не вводи настоящие личные данные, не отправляй сообщения в поддержку, не оплачивай ничего.

# Отчёт

В конце выведи ровно один JSON между строками ${REPORT_START} и ${REPORT_END}, без пояснений вокруг. Все тексты по-русски, коротко.

${REPORT_START}
{
  "summary": "одно-два предложения: что делал и чем кончилось",
  "goals": [{ "goal": "цель из роли", "reached": true, "note": "если не достигнута, почему" }],
  "steps": [
    { "n": 1, "action": "открыл главную", "result": "видит заголовок и три игры", "ok": true },
    { "n": 5, "action": "пропал интернет", "result": "приложение показало ошибку и продолжило", "ok": true, "event": "offline" }
  ],
  "findings": [
    { "id": "F1", "step": 7, "severity": "high", "rule": "R4", "where": { "screen": "Игры → WordBase Quiz, экран вопроса", "url": "${baseUrl}/?view=games", "element": "карточки вариантов ответа" }, "expected": "Games видит 12 карточек", "observed": "Games пишет, что карточек нет", "screenshot": "finding-F1.png" }
  ],
  "known": [{ "accepted": "A1", "step": 3, "note": "или: известное, но экран изменился" }]
}
${REPORT_END}

Поле "where" обязательно у каждой находки. "screen" — путь по интерфейсу словами, как его назвал бы пользователь: вкладка, экран, окно, игра. "url" — адрес страницы из последнего ответа браузера. "element" — что именно на экране: кнопка, подпись, карточка, подвал.

Поле "action" пиши глаголом в прошедшем времени, как в журнале: "открыл Decks", "нажал «Добавить»". Шаги нумеруй подряд. severity: "high" если пользователь не может продолжить или теряет данные, "medium" если путь обходной или запутанный, "low" если косметика.`;
}

/** Pulls the JSON report out of the agent's final text. */
export function extractReport(text) {
  const start = text.lastIndexOf(REPORT_START);
  const end = text.lastIndexOf(REPORT_END);
  if (start < 0 || end < start) return null;
  const raw = text.slice(start + REPORT_START.length, end).trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
