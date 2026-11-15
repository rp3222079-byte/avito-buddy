import type { ChatReply } from './api';

export type QuestId = 'team' | 'access' | 'guide';
export type TicketStatus = 'draft' | 'pending' | 'approved';
export type ArticleId = 'access' | 'team';
export interface Ticket { id: string; resource: string; reason: string; status: TicketStatus }
export interface Message {
  id: number;
  role: 'buddy' | 'user';
  text: string;
  kind?: 'request' | 'briefing' | 'dashboard';
  source?: ArticleId;
  sources?: ChatReply['sources'];
  actions?: ChatReply['actions'];
}
export interface DemoState { version: 1; completed: QuestId[]; ticket: Ticket | null; messages: Message[] }
export const STORAGE_KEY = 'avito-buddy-demo-v1';
export const quests: { id: QuestId; title: string; short: string; description: string; xp: number }[] = [
  { id: 'team', title: 'Познакомиться с командой', short: 'Знакомство с командой', description: 'Ты уже познакомился с наставником и командой. Первый шаг позади!', xp: 80 },
  { id: 'access', title: 'Получить доступ к Jira', short: 'Доступ к инструментам', description: 'Чтобы взять первую задачу, нужен доступ к рабочему пространству команды.', xp: 120 },
  { id: 'guide', title: 'Изучить инструкции команды', short: 'Знания команды', description: 'Узнай, как устроены задачи, встречи и помощь наставника.', xp: 100 }
];
export const articles = {
  access: { title: 'Как получить доступ к инструментам', label: 'Доступы', sections: [
    ['1. Выбери инструмент', 'В демокоманде Backend стажёр работает с Jira. Для этого нужен доступ к пространству команды.'],
    ['2. Подготовь заявку', 'Укажи инструмент и зачем нужен доступ. Проверь данные перед отправкой. Бадди создаст заявку только после твоего подтверждения.'],
    ['3. Дождись согласования', 'Созданная заявка ещё не означает выданный доступ. Пока наставник проверяет запрос, можно изучить инструкции команды.'],
    ['Как проверить демо', 'Переключись на роль наставника и нажми «Согласовать в демо» в дашборде. Это локальная имитация ответа сервиса — настоящие доступы не выдаются.']
  ] },
  team: { title: 'Как работает наша команда', label: 'Команда Backend', sections: [
    ['Знакомься: твой наставник — Анна', 'Если застрял с задачей, собери вопрос, что уже попробовал и какой результат получил. Обсуди это с Анной на встрече 1:1.'],
    ['Задачи живут в Jira', 'У каждой задачи есть описание, ожидаемый результат и ответственный. Перед началом уточни критерии готовности. Изменения кода проходят ревью.'],
    ['Будь на связи', 'В демокоманде короткая встреча проходит по будням в 10:30. Расскажи, что получилось, что планируешь и нужна ли помощь.'],
    ['Твой следующий шаг', 'После получения доступа открой первую задачу вместе с наставником. Она поможет выбрать подходящий объём и ответит на вопросы.']
  ] }
};
export function initialState(): DemoState {
  return { version: 1, completed: ['team'], ticket: null, messages: [
    { id: 1, role: 'buddy', text: 'Привет, Роман! Я Бадди, твой помощник в Авито.' },
    { id: 2, role: 'buddy', text: 'Могу показать утренний брифинг, помочь с доступом к Jira или подсказать, с чего начать.' }
  ] };
}
export function getXP(state: DemoState) { return 160 + quests.filter(q => state.completed.includes(q.id)).reduce((total, q) => total + q.xp, 0); }
export function getLevel(state: DemoState) { return Math.floor(getXP(state) / 200) + 1; }
export function questStatus(state: DemoState, id: QuestId) {
  if (state.completed.includes(id)) return 'done';
  if (id === 'access' && state.ticket?.status === 'pending') return 'pending';
  return 'available';
}
function append(state: DemoState, ...messages: Omit<Message, 'id'>[]): DemoState {
  const next = (state.messages.at(-1)?.id ?? 0) + 1;
  const all = [...state.messages, ...messages.map((m, i) => ({ ...m, id: next + i }))];
  const anchor = all.find(m => m.kind === 'request');
  const recent = all.slice(-60);
  // Keep the actionable ticket reachable even after a long conversation.
  return { ...state, messages: anchor && !recent.includes(anchor) ? [anchor, ...all.slice(-59)] : recent };
}
function buddy(state: DemoState, text: string, source?: ArticleId) { return append(state, { role: 'buddy', text, source }); }
export type Action =
  | { type: 'user'; text: string }
  | { type: 'reply'; text: string }
  | { type: 'answer'; message: Omit<Message, 'id' | 'role'> }
  | { type: 'edit'; reason: string; resource: string }
  | { type: 'submit'; fail?: boolean }
  | { type: 'cancel' }
  | { type: 'approve' }
  | { type: 'read' }
  | { type: 'reset' };
export function reducer(state: DemoState, action: Action): DemoState {
  switch (action.type) {
    case 'reset': return initialState();
    case 'user': return action.text.trim() ? append(state, { role: 'user', text: action.text.trim().slice(0, 500) }) : state;
    case 'answer': return append(state, { ...action.message, role: 'buddy' });
    case 'reply': {
      const text = action.text.toLowerCase();
      if (/парол|зарплат|чуж|финанс|персональн/.test(text)) return buddy(state, 'Эти сведения недоступны стажёру. Я могу помочь с твоими задачами, инструкциями и заявкой на доступ.');
      if (/брифинг|на сегодня|сегодня.*делать|делать.*сегодня/.test(text)) {
        return append(state, { role: 'buddy', text: 'Доброе утро, Роман! Вот твой план на первую неделю и текущий прогресс.', kind: 'briefing' });
      }
      if (/дашборд|сводк.*стаж|блокер.*стаж/.test(text)) return buddy(state, 'Сводка по стажёрам доступна наставнику. Могу показать твои задачи и прогресс.');
      if (/доступ|jira|джир|заявк/.test(text)) {
        if (state.ticket?.status === 'approved') return buddy(state, 'Доступ уже выдан в демосервисе. Квест завершён, +120 XP! Теперь можно изучить инструкции команды.', 'team');
        if (state.ticket?.status === 'pending') return buddy(state, `Заявка ${state.ticket.id} уже отправлена. Она ожидает согласования — повторная заявка не нужна. Пока можно изучить инструкции.`, 'access');
        if (state.ticket?.status === 'draft') return buddy(state, 'Черновик уже готов — проверь карточку заявки выше. Если нужно, измени описание перед отправкой.', 'access');
        const resource = /confluence|конфлюенс/.test(text) ? 'Confluence' : /figma|фигм/.test(text) ? 'Figma' : 'Jira';
        return append({ ...state, ticket: { id: 'REQ-042', resource, reason: 'Доступ к пространству Backend для первой рабочей задачи', status: 'draft' } },
          { role: 'buddy', text: 'Подготовил заявку на доступ. Проверь данные — отправлю её только после твоего подтверждения.', source: 'access', kind: 'request' });
      }
      if (/инструк|команд|встреч|настав|анн|ревью/.test(text)) return buddy(state, 'Твой наставник — Анна. Задачи ведём в Jira, изменения обсуждаем на ревью, а вопросы можно принести на 1:1. Собрал самое нужное в инструкции команды.', 'team');
      if (/дальше|план|начать|квест|делать|шаг/.test(text)) {
        if (state.completed.length === quests.length) return buddy(state, 'Все задачи первой недели выполнены! Следующий шаг — обсудить первую рабочую задачу с наставником.');
        return buddy(state, state.ticket?.status === 'pending' ? 'Пока ждём согласования доступа, открой инструкции команды. Этот квест можно пройти уже сейчас.' : state.completed.includes('access') ? 'Доступ получен! Открой инструкцию команды и отметь её прочитанной — это последний квест первой недели.' : 'Предлагаю получить доступ к Jira. Напиши «Нужен доступ к Jira», и мы вместе подготовим заявку.', 'team');
      }
      if (/привет|здравств|спасибо/.test(text)) return buddy(state, 'Я рядом, Роман! Давай двигаться в твоём темпе. Помогу с доступом, инструкциями или следующим шагом.');
      if (/экватор|босс/.test(text)) return buddy(state, 'Экватор — встреча о промежуточных результатах стажировки. Собери результаты, подготовь презентацию и проведи репетицию с наставником.');
      return buddy(state, 'В демобазе пока нет ответа на этот вопрос. Обсуди его с наставником Анной на 1:1. Здесь я могу показать запрос доступа, инструкции команды и план первой недели.');
    }
    case 'edit': return state.ticket?.status === 'draft' && action.reason.trim().length >= 5 && action.reason.trim().length <= 240 && action.resource === state.ticket.resource
      ? { ...state, ticket: { ...state.ticket, resource: action.resource, reason: action.reason.trim() } } : state;
    case 'cancel': return state.ticket?.status === 'draft'
      ? buddy({ ...state, ticket: null, messages: state.messages.map(message => message.kind === 'request' ? { ...message, kind: undefined } : message) }, 'Черновик отменён. Можешь запросить доступ снова.')
      : state;
    case 'submit': {
      if (state.ticket?.status !== 'draft') return state;
      if (action.fail) return buddy(state, 'Демосервис временно недоступен. Заявка не отправлена, данные сохранены. Нажми «Отправить заявку» ещё раз.');
      return append({ ...state, ticket: { ...state.ticket, status: 'pending' } }, {
        role: 'buddy',
        text: 'Заявка создана. Пока доступ согласовывают, можно изучить инструкцию команды.',
        source: 'team',
        actions: [{ type: 'card', kind: 'ticket', data: { ticket_id: state.ticket.id, status: 'created', sla_hours: 2 } }],
      });
    }
    case 'approve': {
      if (state.ticket?.status !== 'pending') return state;
      return buddy({ ...state, ticket: { ...state.ticket, status: 'approved' }, completed: [...new Set<QuestId>([...state.completed, 'access'])] }, `Есть! Демосервис подтвердил доступ к ${state.ticket.resource}. Квест завершён: +120 XP. Ты на шаг ближе к первой задаче!`);
    }
    case 'read': return state.completed.includes('guide') ? state : buddy({ ...state, completed: [...state.completed, 'guide'] }, 'Инструкция изучена — ещё +100 XP! Если что-то осталось непонятным, обсуди это с наставником.');
  }
}
export function loadState(storage: Pick<Storage, 'getItem'> = localStorage): DemoState {
  try {
    const data = JSON.parse(storage.getItem(STORAGE_KEY) || 'null');
    if (!data || data.version !== 1 || !Array.isArray(data.completed) || !Array.isArray(data.messages) || data.messages.length > 60) return initialState();
    if (!data.completed.every((q: unknown) => ['team', 'access', 'guide'].includes(String(q))) || new Set(data.completed).size !== data.completed.length) return initialState();
    if (!data.messages.every((m: Message) => Number.isFinite(m.id) && ['buddy', 'user'].includes(m.role) && typeof m.text === 'string' && m.text.length <= 2000 && (!m.source || ['team', 'access'].includes(m.source)) && (!m.kind || ['request', 'briefing'].includes(m.kind)))) return initialState();
    if (data.ticket && (data.ticket.id !== 'REQ-042' || !['Jira', 'Confluence', 'Figma'].includes(data.ticket.resource) || typeof data.ticket.reason !== 'string' || !['draft', 'pending', 'approved'].includes(data.ticket.status))) return initialState();
    if (data.completed.includes('access') !== (data.ticket?.status === 'approved')) return initialState();
    const messages = data.messages.map((message: Message) => ({
      ...message,
      sources: Array.isArray(message.sources) ? message.sources.filter(item => typeof item?.source === 'string') : undefined,
      actions: Array.isArray(message.actions) ? message.actions.filter(item =>
        (item?.type === 'button' && item.id === 'notify_mentor' && typeof item.label === 'string')
        || (item?.type === 'card' && item.kind === 'ticket' && typeof item.data?.ticket_id === 'string'
          && typeof item.data.sla_hours === 'number' && (item.data.status === undefined || typeof item.data.status === 'string'))) : undefined,
    }));
    return { ...data, messages };
  } catch { return initialState(); }
}
export function saveState(state: DemoState, storage: Pick<Storage, 'setItem'> = localStorage): boolean {
  try { storage.setItem(STORAGE_KEY, JSON.stringify(state)); return true; } catch { return false; }
}
