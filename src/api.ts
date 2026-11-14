import mentorData from '../data/mock_mentor.json';
import jiraData from '../data/mock_jira.json';
import { quests, reducer } from './model';
import type { DemoState, Message } from './model';
import { readEvents } from './sse';

export type Role = 'intern' | 'mentor';
export type InternStatus = 'blocked' | 'at_risk' | 'on_track';
export interface Intern {
  intern_id: string;
  name: string;
  progress_percent: number;
  status: InternStatus;
  blockers: string[];
}
export interface JiraTask { id: string; title: string; status: string; priority: string }
export interface TicketData { ticket_id: string; status?: string; sla_hours: number }
export type ChatAction =
  | { type: 'button'; id: 'notify_mentor'; label: string; data?: { message: string } }
  | { type: 'button'; id: 'create_access_ticket'; label: string; data: { system: string } }
  | { type: 'card'; kind: 'ticket'; data: TicketData };
export interface ChatReply {
  reply: string;
  sources: { source: string }[];
  tools_used: string[];
  actions: ChatAction[];
}

export const mockMode = import.meta.env.VITE_API_MODE !== 'real';
const chatPath = import.meta.env.VITE_CHAT_PATH || '/api/chat';
export const demoTasks = jiraData.tasks.filter(task => task.assignee === 'intern_ivan');
export const demoInterns = mentorData.interns as Intern[];

export function withDemoProgress(interns: Intern[], state: DemoState): Intern[] {
  const pending = state.ticket?.status === 'pending';
  return [{
    intern_id: 'demo_roman',
    name: 'Роман',
    progress_percent: Math.round(state.completed.length / quests.length * 100),
    status: pending ? 'at_risk' : 'on_track',
    blockers: pending ? ['Ждёт согласования доступа к Jira'] : [],
  }, ...interns];
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function isTicket(value: unknown): value is TicketData {
  return record(value) && typeof value.ticket_id === 'string' && !!value.ticket_id.trim()
    && typeof value.sla_hours === 'number' && Number.isFinite(value.sla_hours) && value.sla_hours >= 0
    && (value.status === undefined || typeof value.status === 'string');
}

function isAction(value: unknown): value is ChatAction {
  if (!record(value)) return false;
  if (value.type === 'card') return value.kind === 'ticket' && isTicket(value.data);
  if (value.type !== 'button' || typeof value.label !== 'string' || !value.label.trim()) return false;
  if (value.id === 'notify_mentor') {
    return value.data === undefined || (record(value.data) && typeof value.data.message === 'string' && !!value.data.message.trim());
  }
  return value.id === 'create_access_ticket' && record(value.data)
    && typeof value.data.system === 'string' && !!value.data.system.trim();
}

function isIntern(value: unknown): value is Intern {
  return record(value) && typeof value.intern_id === 'string' && typeof value.name === 'string'
    && typeof value.progress_percent === 'number' && value.progress_percent >= 0 && value.progress_percent <= 100
    && (value.status === 'blocked' || value.status === 'at_risk' || value.status === 'on_track')
    && Array.isArray(value.blockers) && value.blockers.every(item => typeof item === 'string');
}

function isTask(value: unknown): value is JiraTask {
  return record(value) && typeof value.id === 'string' && typeof value.title === 'string'
    && typeof value.status === 'string' && typeof value.priority === 'string';
}

function httpError(response: Response): Error {
  if (response.status === 401) return new Error('Сессия закончилась. Войди заново.');
  if (response.status === 403) return new Error('403 · Доступ запрещён.');
  return new Error('Сервис временно недоступен.');
}

function requestError(error: unknown, timeout: AbortSignal): Error {
  if (timeout.aborted) return new Error('Сервис не ответил вовремя.');
  if (!navigator.onLine) return new Error('Нет подключения к интернету.');
  if (error instanceof TypeError) return new Error('Связь с сервером прервалась.');
  if (error instanceof SyntaxError) return new Error('Сервис вернул некорректный ответ.');
  return error instanceof Error ? error : new Error('Сервис временно недоступен.');
}

async function request(path: string, signal?: AbortSignal, post?: { body: object; id: string }): Promise<unknown> {
  const timeout = AbortSignal.timeout(10000);
  try {
    const response = await fetch(path, {
      credentials: 'same-origin',
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      ...(post && {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': post.id },
        body: JSON.stringify(post.body),
      }),
    });
    if (!response.ok) throw httpError(response);
    if (response.status === 204) return;
    return await response.json();
  } catch (error) {
    throw requestError(error, timeout);
  }
}

export async function getInterns(signal: AbortSignal): Promise<Intern[]> {
  if (mockMode) return demoInterns;
  const data = await request('/api/mentor/interns', signal);
  if (record(data) && Array.isArray(data.interns) && data.interns.every(isIntern)) return data.interns;
  throw new Error('Сервис вернул некорректный список стажёров.');
}

export async function getTasks(signal: AbortSignal): Promise<JiraTask[]> {
  if (mockMode) return demoTasks;
  const data = await request('/api/jira/tasks', signal);
  if (record(data) && Array.isArray(data.tasks) && data.tasks.every(isTask)) return data.tasks;
  throw new Error('Сервис вернул некорректный список задач.');
}

function demoReply(text: string, role: Role, state: DemoState, intern?: Intern): Omit<Message, 'id' | 'role'> {
  if (intern) return { text: 'Это демочат. Сообщение сохранено в этой переписке.' };
  if (role === 'mentor') {
    const interns = withDemoProgress(demoInterns, state);
    if (/блокер|помощ|риск|застрял/i.test(text)) {
      return {
        text: interns.filter(item => item.blockers.length).map(item => `- **${item.name}** — ${item.blockers.join('; ')}`).join('\n'),
        kind: 'dashboard',
      };
    }
    const onTrack = interns.filter(item => item.status === 'on_track').length;
    return {
      text: `Стажёров в команде: ${interns.length}. По плану идут ${onTrack}, нужна помощь ${interns.length - onTrack}.`,
      kind: 'dashboard',
    };
  }
  if (/брифинг|на сегодня|сегодня.*делать|делать.*сегодня/i.test(text)) {
    const day = new Intl.DateTimeFormat('ru', { weekday: 'long' }).format(new Date());
    const active = demoTasks.filter(task => task.status !== 'Done');
    const tasks = active.map(task => `- **${task.id}** — ${task.title}`).join('\n');
    return {
      text: `Доброе утро, Роман! Сегодня ${day}.\n\n${tasks || 'У тебя нет активных задач.'}`,
      kind: 'briefing',
      actions: active.length ? [{ type: 'button', id: 'notify_mentor', label: 'Отправить напоминание' }] : [],
    };
  }
  if (/релиз|четверг.*14/i.test(text)) {
    return { text: 'В четверг в **14:00 по Москве** проходит релиз. Для встречи выбери время до 13:00 или после 15:00.', sources: [{ source: 'team_rules.md' }] };
  }
  const { text: reply, kind, source } = reducer(state, { type: 'reply', text }).messages.at(-1)!;
  return { text: reply, kind, source };
}

type ReplyRequest = { text: string; role: Role; state: DemoState; intern?: Intern; disconnect: boolean; id: string };
type Reply = Omit<Message, 'id' | 'role'>;

async function networkReply(request: ReplyRequest, signal: AbortSignal, onChunk: (text: string) => void): Promise<Reply> {
  const timeout = AbortSignal.timeout(60_000);
  try {
    const response = await fetch(chatPath, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { Accept: 'text/event-stream', 'Content-Type': 'application/json', 'Idempotency-Key': request.id },
      body: JSON.stringify({ message: request.text, ...(request.intern && { intern_id: request.intern.intern_id }) }),
      signal: AbortSignal.any([signal, timeout]),
    });
    if (!response.ok) throw httpError(response);
    const contentType = response.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase();
    if (contentType !== 'text/event-stream' || !response.body) throw new Error('Сервер не вернул поток SSE.');
    let text = '';
    for await (const { event, data } of readEvents(response.body)) {
      if (signal.aborted) throw signal.reason;
      if (event !== 'delta' && event !== 'done' && event !== 'error') continue;
      const payload: unknown = JSON.parse(data);
      if (!record(payload)) throw new Error('Сервис вернул некорректное событие чата.');
      if (event === 'error') throw new Error(typeof payload.message === 'string' && payload.message.trim() ? payload.message : 'Не удалось получить ответ Бадди.');
      if (event === 'delta' && typeof payload.text === 'string') {
        text += payload.text;
        onChunk(text);
      } else if (event === 'done') {
        if (typeof payload.reply === 'string') text = payload.reply;
        const actions = Array.isArray(payload.actions) ? payload.actions.filter(isAction) : [];
        const sources = Array.isArray(payload.sources) ? payload.sources.filter(
          (item): item is { source: string } => record(item) && typeof item.source === 'string',
        ) : [];
        if (text.trim() || actions.length) return { text, sources, actions };
        throw new Error('Бадди вернул пустой ответ.');
      } else {
        throw new Error('Сервис вернул некорректный фрагмент чата.');
      }
    }
    throw new Error('Поток ответа прервался. Повтори отправку сообщения.');
  } catch (error) {
    throw requestError(error, timeout);
  }
}

export function streamReply(
  request: ReplyRequest,
  onChunk: (text: string) => void,
  onComplete: (message: Omit<Message, 'id' | 'role'>) => void,
  onError: (message: string) => void,
): () => void {
  if (!mockMode) {
    const controller = new AbortController();
    networkReply(request, controller.signal, onChunk).then(
      reply => { if (!controller.signal.aborted) onComplete(reply); },
      (error: Error) => { if (!controller.signal.aborted) onError(error.message); },
    );
    return () => controller.abort();
  }
  const reply = demoReply(request.text, request.role, request.state, request.intern);
  let length = 0;
  let chunks = 0;
  let timer: ReturnType<typeof setTimeout>;
  const next = () => {
    if (request.disconnect && chunks === 2) {
      onError('Поток ответа прервался. Повтори отправку сообщения.');
      return;
    }
    chunks += 1;
    length += Math.max(1, Math.ceil(reply.text.length / 12));
    if (length >= reply.text.length) onComplete(reply);
    else {
      onChunk(reply.text.slice(0, length));
      timer = setTimeout(next, 50);
    }
  };
  timer = setTimeout(next, 100);
  return () => clearTimeout(timer);
}

export async function notifyMentor(message: string, id: string): Promise<void> {
  if (!mockMode) await request('/api/notify-mentor', undefined, { body: { message }, id });
}

export async function createAccessTicket(system: string, id: string): Promise<TicketData> {
  if (mockMode) return { ticket_id: 'REQ-042', status: 'Создана', sla_hours: 2 };
  const data = await request('/api/jira/ticket', undefined, { body: { system }, id });
  if (!isTicket(data)) throw new Error('Сервис вернул некорректные данные заявки.');
  return data;
}
