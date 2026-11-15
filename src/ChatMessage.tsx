import { useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import { Bell, KeyRound, LoaderCircle } from 'lucide-react';
import Markdown from 'react-markdown';
import { finishAction, mockMode, prepareAction } from './api';
import type { ChatAction } from './api';
import type { Message } from './model';

type ButtonAction = Extract<ChatAction, { type: 'button' }>;
type TicketAction = Extract<ChatAction, { type: 'card' }>;

export function ActionButton({ action, initialPendingId }: { action: ButtonAction; initialPendingId?: string }) {
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const [pendingId, setPendingId] = useState(initialPendingId);
  const [ticket, setTicket] = useState<TicketAction['data']>();
  const [error, setError] = useState('');
  const id = useRef<string | null>(null);
  const running = useRef(false);
  const isTicket = action.id === 'create_access_ticket';
  async function run(operation: 'prepare' | 'confirm' | 'cancel') {
    if (running.current || sent || cancelled) return;
    running.current = true;
    setPending(true);
    setError('');
    try {
      if (mockMode) {
        setSent(true);
      } else if (operation === 'prepare') {
        id.current ??= crypto.randomUUID();
        setPendingId(await prepareAction(action, id.current));
      } else if (pendingId) {
        setTicket(await finishAction(action, pendingId, operation === 'cancel'));
        setCancelled(operation === 'cancel');
        setSent(operation === 'confirm');
      }
    } catch (failure) {
      const detail = failure instanceof Error ? failure.message : '';
      const summary = operation === 'cancel' ? 'Не удалось отменить черновик.'
        : operation === 'prepare' ? 'Не удалось подготовить черновик.'
        : isTicket ? 'Не удалось создать заявку.' : 'Не удалось отправить напоминание.';
      setError(`${summary} ${detail}`.trim());
    } finally {
      running.current = false;
      setPending(false);
    }
  }
  if (ticket) return <div role="status"><TicketCard data={ticket}/></div>;
  if (cancelled) return <p role="status">Черновик отменён.</p>;
  if (sent) return <p role="status">{mockMode ? 'Демо · напоминание отмечено как отправленное.' : 'Напоминание отправлено.'}</p>;
  if (pendingId) return <section className="ticket-card">
    <h3>{isTicket ? `Черновик · доступ к ${action.data.system}` : 'Черновик напоминания'}</h3>
    <p>{isTicket ? action.data.reason : action.data?.message ?? 'Пожалуйста, проверь мои задачи по онбордингу.'}</p>
    <div className="action-controls">
      <button className="primary-button" disabled={pending} onClick={() => run('confirm')}>Подтвердить</button>
      <button className="secondary-button" disabled={pending} onClick={() => run('cancel')}>Отменить</button>
    </div>
    {pending && <p role="status">Обрабатываем действие…</p>}
    {error && <p className="error-note" role="alert">{error}</p>}
  </section>;
  return <div>
    <button className="secondary-button" disabled={pending} onClick={() => run('prepare')}>
      {isTicket ? <KeyRound size={15}/> : <Bell size={15}/>}
      {pending ? 'Готовим черновик…' : isTicket ? `${action.label} · ${action.data.system}` : action.label}
    </button>
    {error && <p className="error-note" role="alert">{error}</p>}
  </div>;
}

export function TicketCard({ data }: { data: TicketAction['data'] }) {
  return <section className="ticket-card">
    <h3><KeyRound size={16}/>Заявка {data.ticket_id}</h3>
    {data.status && <p>Статус · {data.status === 'pending' ? 'Ожидает согласования' : data.status}</p>}
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
      {message.actions?.map((action, index) => action.type === 'card'
        ? <TicketCard key={index} data={action.data}/>
        : action.type === 'pending_action'
          ? <ActionButton key={action.pendingId} action={action.action} initialPendingId={action.pendingId}/>
          : <ActionButton key={index} action={action}/>)}
      {children}
    </div>
  </div>;
}
