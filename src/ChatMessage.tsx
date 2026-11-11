import { useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import { Bell, KeyRound, LoaderCircle } from 'lucide-react';
import Markdown from 'react-markdown';
import { createAccessTicket, mockMode, notifyMentor } from './api';
import type { ChatAction } from './api';
import type { Message } from './model';

type ButtonAction = Extract<ChatAction, { type: 'button' }>;
type TicketAction = Extract<ChatAction, { type: 'card' }>;

export function ActionButton({ action }: { action: ButtonAction }) {
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [ticket, setTicket] = useState<TicketAction['data']>();
  const [error, setError] = useState('');
  const id = useRef<string | null>(null);
  const running = useRef(false);
  const isTicket = action.id === 'create_access_ticket';
  async function run() {
    if (running.current || sent) return;
    running.current = true;
    setPending(true);
    setError('');
    try {
      id.current ??= crypto.randomUUID();
      if (action.id === 'create_access_ticket') setTicket(await createAccessTicket(action.data.system, id.current));
      else await notifyMentor(action.data?.message ?? 'Пожалуйста, проверь мои задачи по онбордингу.', id.current);
      setSent(true);
    } catch (failure) {
      const detail = failure instanceof Error ? failure.message : '';
      setError(`${isTicket ? 'Не удалось создать заявку.' : 'Не удалось отправить напоминание.'} ${detail}`.trim());
    } finally {
      running.current = false;
      setPending(false);
    }
  }
  if (ticket) return <div role="status"><TicketCard data={ticket}/></div>;
  return <div>
    <button className="secondary-button" disabled={pending || sent} onClick={run}>
      {isTicket ? <KeyRound size={15}/> : <Bell size={15}/>}
      {pending ? 'Отправляем…' : isTicket ? `${action.label} · ${action.data.system}` : action.label}
    </button>
    {sent && <p role="status">{mockMode ? 'Демо · напоминание отмечено как отправленное.' : 'Напоминание отправлено.'}</p>}
    {error && <p className="error-note" role="alert">{error}</p>}
  </div>;
}

export function TicketCard({ data }: { data: TicketAction['data'] }) {
  return <section className="ticket-card">
    <h3><KeyRound size={16}/>Заявка {data.ticket_id}</h3>
    {data.status && <p>Статус {data.status}</p>}
    <p>Срок обработки · {data.sla_hours} ч</p>
  </section>;
}

export function StreamingMessage({ text }: { text: string }) {
  return <>
    <div className="typing" role="status"><LoaderCircle className="spin" size={15}/>{text ? 'Бадди отвечает' : 'Бадди думает'}</div>
    {text && <div className="message buddy" aria-hidden="true"><div className="message-bubble"><Markdown skipHtml allowedElements={['p', 'strong', 'em', 'ul', 'ol', 'li', 'code', 'pre']} unwrapDisallowed>{text}</Markdown></div></div>}
  </>;
}

export function MessageList({ scrollRef, children }: { scrollRef: RefObject<HTMLDivElement | null>; children: ReactNode }) {
  return <div className="chat-scroll" ref={scrollRef} role="log" aria-label="Переписка">{children}</div>;
}

export function ChatMessage({ message, avatar, children }: { message: Message; avatar: ReactNode; children?: ReactNode }) {
  return <div className={`message ${message.role}`}>
    <span className="message-avatar" aria-hidden="true">{avatar}</span>
    <div className="message-content">
      <div className="message-bubble">
        <span className="sr-only">{message.role === 'buddy' ? 'Бадди: ' : 'Вы: '}</span>
        {message.role === 'buddy' ? <Markdown skipHtml>{message.text}</Markdown> : message.text}
      </div>
      {message.sources?.map(({ source }) => <small className="muted" key={source}>Источник · {source}</small>)}
      {message.actions?.map((action, index) => action.type === 'button'
        ? <ActionButton key={index} action={action}/>
        : <TicketCard key={index} data={action.data}/>)}
      {children}
    </div>
  </div>;
}
