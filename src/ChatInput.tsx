import { MessageCircle, Send } from 'lucide-react';

export function ChatInput({ input, busy, onChange, onSend }: {
  input: string;
  busy: boolean;
  onChange: (text: string) => void;
  onSend: () => void;
}) {
  return <form onSubmit={event => { event.preventDefault(); onSend(); }}>
    <label className="sr-only" htmlFor="chat-input">Сообщение Бадди</label>
    <MessageCircle size={17} aria-hidden="true"/>
    <textarea id="chat-input" rows={1} value={input} maxLength={500} onChange={event => onChange(event.target.value)} placeholder="Напиши сообщение…" onKeyDown={event => {
      if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
        event.preventDefault();
        onSend();
      }
    }}/>
    <button className="send-button" aria-label="Отправить сообщение" disabled={!input.trim() || busy}><Send size={17}/></button>
  </form>;
}
