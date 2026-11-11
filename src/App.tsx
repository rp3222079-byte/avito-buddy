import { useEffect, useReducer, useRef, useState } from 'react';
import { ArrowRight, BarChart3, Bell, BookOpen, Check, ChevronDown, ChevronRight, CircleHelp, Clock3, ExternalLink, KeyRound, ListChecks, LoaderCircle, MessageCircle, Pencil, RotateCcw, Send, ShieldCheck, Sparkles, SquareCheck, Sun, Users, X } from 'lucide-react';
import { articles, getLevel, getXP, loadState, quests, reducer, saveState } from './model';
import type { ArticleId, Message } from './model';
import MentorDashboard, { mentorReply } from './MentorDashboard';
import Modal from './Modal';

type Role = 'intern' | 'mentor';
type Dialog = 'library' | 'demo' | 'reset' | 'edit' | 'team' | null;
const internPrompts = [
  { label: 'Утренний брифинг', text: 'Покажи утренний брифинг', icon: Sun },
  { label: 'Доступ к Jira', text: 'Как получить доступ к Jira?', icon: KeyRound },
  { label: 'Что дальше?', text: 'Что делать дальше?', icon: ListChecks },
];
const mentorPrompts = [
  { label: 'Сводка по стажёрам', text: 'Покажи сводку по стажёрам', icon: BarChart3 },
  { label: 'Кому нужна помощь?', text: 'У кого есть блокеры?', icon: Users },
];
const firstMentorMessage: Message = {
  id: 1, role: 'buddy', text: 'Привет, Анна! Я помогу проверить прогресс стажёров, найти блокеры и посмотреть заявки на доступ.',
};

function BuddyArt({ pose }: { pose: 'wave' | 'avatar' | 'laptop' }) {
  return <span className={`buddy-art buddy-art-${pose}`} aria-hidden="true">
    <img src={`/assets/fox-${pose}.png`} alt=""/>
  </span>;
}

export default function App() {
  const [state, dispatch] = useReducer(reducer, undefined, () => loadState());
  const [role, setRole] = useState<Role>('intern');
  const [mentorMessages, setMentorMessages] = useState<Message[]>([firstMentorMessage]);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [article, setArticle] = useState<ArticleId | null>(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState<'reply' | 'submit' | null>(null);
  const [failNext, setFailNext] = useState(false);
  const [sendError, setSendError] = useState(false);
  const [reason, setReason] = useState('');
  const [toast, setToast] = useState('');
  const [saveError, setSaveError] = useState(false);
  const chatRef = useRef<HTMLDivElement>(null);
  const chatHeading = useRef<HTMLHeadingElement>(null);
  const tasksRef = useRef<HTMLHeadingElement>(null);
  const dashboardRef = useRef<HTMLHeadingElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const locked = useRef(false);
  const previousXP = useRef(getXP(state));
  const xp = getXP(state), level = getLevel(state);
  const ticket = state.ticket;
  const isIntern = role === 'intern';
  const messages = isIntern ? state.messages : mentorMessages;
  const pendingTasks = quests.length - state.completed.length;

  useEffect(() => { setSaveError(!saveState(state)); }, [state]);
  useEffect(() => { chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight }); }, [messages, busy, role]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(''), 4500);
    return () => clearTimeout(id);
  }, [toast]);
  useEffect(() => {
    if (xp > previousXP.current) {
      setToast(Math.floor(xp / 200) > Math.floor(previousXP.current / 200)
        ? `Новый уровень ${level}! Отличная работа, Роман.`
        : `Задача выполнена! +${xp - previousXP.current} XP`);
    }
    previousXP.current = xp;
  }, [xp, level]);

  function send(value: string, sender: Role = role) {
    const text = value.trim();
    if (!text || locked.current) return;
    setInput('');
    if (sender === 'intern') {
      locked.current = true;
      dispatch({ type: 'user', text });
      setBusy('reply');
      timer.current = setTimeout(() => {
        dispatch({ type: 'reply', text });
        setBusy(null);
        locked.current = false;
      }, 650);
    } else {
      setMentorMessages(history => {
        const id = history.at(-1)!.id + 1;
        return [...history.slice(-58), { id, role: 'user', text }, { id: id + 1, role: 'buddy', ...mentorReply(text, state) }];
      });
    }
  }

  function submit() {
    if (locked.current || state.ticket?.status !== 'draft') return;
    locked.current = true;
    setBusy('submit');
    setSendError(false);
    timer.current = setTimeout(() => {
      dispatch({ type: 'submit', fail: failNext });
      setSendError(failNext);
      setFailNext(false);
      setBusy(null);
      locked.current = false;
    }, 900);
  }

  function reset() {
    if (timer.current) clearTimeout(timer.current);
    locked.current = false;
    dispatch({ type: 'reset' });
    setMentorMessages([firstMentorMessage]);
    setRole('intern');
    setBusy(null);
    setDialog(null);
    setArticle(null);
    setFailNext(false);
    setSendError(false);
    setInput('');
    setToast('Демо начато заново');
  }

  function openArticle(id: ArticleId) { setDialog(null); setArticle(id); }
  function changeRole(next: Role) {
    if (next === role) return;
    setRole(next);
    setInput('');
  }

  const avatar = isIntern ? <img src="/assets/roman-avatar.png" alt=""/> : <span className="initial-avatar">А</span>;

  return <div className="app-shell">
    <header className="topbar">
      <a className="brand" href="#chat" onClick={e => { e.preventDefault(); chatHeading.current?.focus(); }}>
        <span className="brand-lockup"><img src="/assets/avito-logo.svg" alt="Avito"/> <b>Start</b></span>
        <span className="brand-divider"/><strong>Бадди</strong>
      </a>
      <div className="role-switch" role="group" aria-label="Роль в демо">
        <button type="button" aria-pressed={isIntern} onClick={() => changeRole('intern')}><Users size={17}/>Стажёр</button>
        <button type="button" aria-pressed={!isIntern} onClick={() => changeRole('mentor')}><Users size={17}/>Наставник</button>
      </div>
      <div className="header-actions">
        <button className="icon-button notification" aria-label={isIntern ? 'Утренний брифинг в чате' : 'Сводка по стажёрам в чате'} disabled={!!busy} onClick={() => { send(isIntern ? internPrompts[0].text : mentorPrompts[0].text); chatHeading.current?.focus(); }}><Bell size={22}/></button>
        <details className="profile">
          <summary aria-label={isIntern ? 'Меню профиля Романа' : 'Меню профиля Анны'}>{avatar}<span className="profile-copy"><strong>{isIntern ? 'Роман' : 'Анна'}</strong>
            {isIntern ? <><small>Уровень {level} · <span>{xp} / {level * 200} XP</span></small><span className="xp-track"><span style={{ width: `${xp / (level * 2)}%` }}/></span></> : <small>Наставник · Backend</small>}
          </span><ChevronDown size={16}/></summary>
          <div className="profile-menu"><button onClick={() => setDialog('reset')}><RotateCcw size={16}/>Начать демо заново</button></div>
        </details>
      </div>
    </header>

    <aside className="sidebar">
      <nav aria-label="Разделы">
        <button className="nav-primary" onClick={() => chatHeading.current?.focus()}><MessageCircle size={21}/>Чат с Бадди</button>
        {isIntern
          ? <button onClick={() => tasksRef.current?.focus()}><SquareCheck size={20}/>Мои задачи</button>
          : <button onClick={() => dashboardRef.current?.focus()}><BarChart3 size={20}/>Стажёры</button>}
        <button onClick={() => setDialog('library')}><BookOpen size={20}/>База знаний</button>
      </nav>
      <div className="buddy-intro">
        <BuddyArt pose="wave"/>
        <div className="panel"><strong>Бадди</strong><p>Твой AI-наставник в Авито. Помогаю с задачами, доступами и отвечаю на вопросы.</p></div>
      </div>
      <button className="help-button" onClick={() => setDialog('demo')}><CircleHelp size={20}/>Помощь</button>
      <div className="brand-shapes" aria-hidden="true"><i/><i/><i/></div>
    </aside>

    <main className={isIntern ? 'workspace intern' : 'workspace mentor'}>
      <section id="chat" className="chat-panel panel" aria-label="Чат с Бадди">
        <div className="chat-header">
          <span className="buddy-avatar"><BuddyArt pose="avatar"/></span>
          <div><h1 ref={chatHeading} tabIndex={-1}>Бадди</h1><p><span className="online-dot"/>Онлайн</p></div>
        </div>
        <div className="chat-scroll" ref={chatRef} role="log" aria-label="Переписка">
          {messages.map(m => <div key={m.id} className={`message ${m.role}`}>
            <span className="message-avatar" aria-hidden="true">{m.role === 'buddy' ? <BuddyArt pose="avatar"/> : avatar}</span>
            <div className="message-content">
              <div className="message-bubble"><span className="sr-only">{m.role === 'buddy' ? 'Бадди: ' : 'Вы: '}</span>{m.text}</div>
              {m.source && <button className="source-link" onClick={() => openArticle(m.source!)}><ExternalLink size={14}/>{articles[m.source].label} · тестовая инструкция</button>}
              {m.kind === 'briefing' && <div className="ticket-card briefing">
                <h3><Sun size={18}/>Утренний брифинг</h3>
                <ul>{quests.map(q => <li key={q.id}>{state.completed.includes(q.id) ? <Check size={15}/> : <Clock3 size={15}/>} {q.title}</li>)}</ul>
                <button className="secondary-button" onClick={() => tasksRef.current?.focus()}>Открыть задачи<ArrowRight size={15}/></button>
              </div>}
              {m.kind === 'dashboard' && !isIntern && <button className="source-link" onClick={() => dashboardRef.current?.focus()}><BarChart3 size={16}/>Открыть дашборд</button>}
            {m.kind === 'request' && ticket && <div className={`ticket-card ${ticket.status}`}>
              <div className="ticket-card-top"><span className="ticket-icon"><KeyRound size={18}/></span><div><small>{ticket.status === 'draft' ? 'ЧЕРНОВИК ЗАЯВКИ' : ticket.id}</small><h3>Доступ к {ticket.resource}</h3></div><span className="ticket-status-icon">{ticket.status === 'approved' ? <Check size={18}/> : ticket.status === 'pending' ? <Clock3 size={16}/> : <Pencil size={15}/>}</span></div>
              <dl><div><dt>Кому</dt><dd>Роман · Backend</dd></div><div><dt>Зачем</dt><dd>{ticket.reason}</dd></div></dl>
              {ticket.status === 'draft' ? <><p className="ticket-note">Проверь данные перед отправкой.</p>{sendError && <p className="error-note" role="alert">Сервис недоступен. Попробуй ещё раз — данные сохранены.</p>}<button className="primary-button ticket-submit" onClick={submit} disabled={!!busy}>{busy === 'submit' ? <><LoaderCircle className="spin" size={16}/>Отправляем…</> : <>Отправить заявку<ArrowRight size={15}/></>}</button><button className="edit-button" disabled={!!busy} onClick={() => { setReason(ticket.reason); setDialog('edit'); }}><Pencil size={12}/>Изменить данные</button></> : <><div className={`status-label ${ticket.status}`}>{ticket.status === 'pending' ? <><Clock3 size={13}/>Ожидает согласования</> : <><ShieldCheck size={14}/>Доступ выдан · +120 XP</>}</div></>}
            </div>}
            </div>
          </div>)}
          {busy === 'reply' && isIntern && <div className="typing" role="status"><LoaderCircle className="spin" size={15}/>Бадди думает</div>}
        </div>
        <div className="chat-composer">
          <div className="quick-replies">{(isIntern ? internPrompts : mentorPrompts).map(({ label, text, icon: Icon }) =>
            <button key={label} disabled={!!busy} onClick={() => send(text)}><Icon size={14}/>{label}</button>)}</div>
          <form onSubmit={e => { e.preventDefault(); send(input); }}>
            <label className="sr-only" htmlFor="chat-input">Сообщение Бадди</label>
            <MessageCircle size={17} aria-hidden="true"/>
            <textarea id="chat-input" rows={1} value={input} maxLength={500} onChange={e => setInput(e.target.value)} placeholder="Напиши Бадди…" onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(input); }
            }}/>
            <button className="send-button" aria-label="Отправить сообщение" disabled={!input.trim() || !!busy}><Send size={17}/></button>
          </form>
        </div>
      </section>

      {isIntern ? <aside className="modules" aria-label="Дополнительные разделы">
        <section className="panel module">
          <div className="module-title"><span><SquareCheck size={20}/></span><h2 tabIndex={-1} ref={tasksRef}>Мои задачи</h2><small>Активных: {pendingTasks}</small></div>
          <ul className="task-list">{quests.map(q => <li key={q.id}><button disabled={q.id === 'access' && !!busy} onClick={() => {
            if (q.id === 'team') setDialog('team');
            else if (q.id === 'guide') openArticle('team');
            else { send(ticket ? 'Какой статус заявки?' : internPrompts[1].text); chatHeading.current?.focus(); }
          }}>
            {state.completed.includes(q.id) ? <Check className="task-done" size={17} aria-label="Выполнено"/> : <span className="task-open" aria-label="В работе"/>}
            {q.title}<ChevronRight size={15}/>
          </button></li>)}</ul>
        </section>
        <section className="panel module week">
          <div className="module-title"><span><ListChecks size={20}/></span><h2>Первая неделя</h2><small>{state.completed.length} из {quests.length}</small></div>
          <div className="xp-track" role="progressbar" aria-label="Задачи первой недели" aria-valuenow={state.completed.length} aria-valuemax={quests.length}>
            <span style={{ width: `${state.completed.length / quests.length * 100}%` }}/>
          </div>
          <ul>{quests.map(q => <li key={q.id}>{state.completed.includes(q.id) ? <Check className="task-done" size={17} aria-label="Выполнено"/> : <span className="task-open" aria-label="В работе"/>}{q.short}</li>)}</ul>
          <BuddyArt pose="laptop"/>
        </section>
        <section className="panel module knowledge">
          <div className="module-title"><span><BookOpen size={20}/></span><h2>База знаний</h2><small>{Object.keys(articles).length} статьи</small></div>
          <div><button onClick={() => openArticle('access')}>Доступы</button><button onClick={() => openArticle('team')}>Процессы</button><button onClick={() => setDialog('library')}>Все статьи</button></div>
        </section>
      </aside> : <MentorDashboard state={state} headingRef={dashboardRef} approve={() => dispatch({ type: 'approve' })} />}
    </main>

    {saveError && <p className="save-warning" role="status">Прогресс не сохранён: хранилище недоступно.</p>}
    {toast && <div className="toast" role="status"><Sparkles size={18}/><span>{toast}</span><button aria-label="Скрыть уведомление" onClick={() => setToast('')}><X size={16}/></button></div>}

    {article && <Modal title={articles[article].title} onClose={() => setArticle(null)}><p className="modal-tag"><BookOpen size={14}/>Тестовая инструкция · не регламент Авито</p><div className="article-content">{articles[article].sections.map(([title, text]) => <section key={title}><h3>{title}</h3><p>{text}</p></section>)}</div>{article === 'team' && <button className="primary-button modal-primary" disabled={state.completed.includes('guide')} onClick={() => { dispatch({ type: 'read' }); setArticle(null); }}>{state.completed.includes('guide') ? 'Уже прочитано' : 'Прочитал, всё понятно · +100 XP'}<Check size={16}/></button>}</Modal>}
    {dialog === 'library' && <Modal title="Библиотека знаний" onClose={() => setDialog(null)}><p className="modal-description">Самое нужное для первых дней. Материалы вымышлены для демонстрации.</p>{(['access','team'] as ArticleId[]).map(id => <button className="library-item" key={id} onClick={() => openArticle(id)}><BookOpen size={24}/><span><strong>{articles[id].title}</strong><small>Тестовая инструкция · 2 минуты</small></span><ArrowRight size={17}/></button>)}</Modal>}
    {dialog === 'team' && <Modal title="Твоя команда — Backend" onClose={() => setDialog(null)}><div className="team-intro"><span className="mentor-avatar large">А</span><div><h3>Анна Соколова</h3><p>Твой наставник в демомире</p></div></div><p className="modal-description">Ты уже познакомился с командой — этот квест выполнен. Следующие шаги: получить доступ и изучить инструкции. Если нужна помощь с рабочим вопросом, обсуди его с Анной на 1:1.</p><div className="info-note"><Users size={18}/><span>Все имена, процессы и расписание здесь вымышлены. Реальные сообщения наставнику не отправляются.</span></div><button className="primary-button modal-primary" onClick={() => openArticle('team')}>Открыть инструкцию команды<ArrowRight size={16}/></button></Modal>}
    {dialog === 'demo' && <Modal title="Попробуй пройти один квест" onClose={() => setDialog(null)}><p className="modal-description">Это локальный прототип: ответы подготовлены заранее, заявки и согласования происходят только в браузере.</p><ol className="demo-steps"><li><span>01</span><div><strong>Попроси доступ к Jira</strong><p>Бадди предложит проверить черновик.</p></div></li><li><span>02</span><div><strong>Отправь заявку</strong><p>Появится номер REQ-042 и статус ожидания.</p></div></li><li><span>03</span><div><strong>В режиме наставника нажми «Согласовать в демо»</strong><p>Квест завершится и принесёт 120 XP.</p></div></li><li><span>04</span><div><strong>Изучи инструкцию команды</strong><p>Ещё 100 XP — и новый уровень!</p></div></li></ol><label className="switch-row"><span><strong>Проверить ошибку отправки</strong><small>Следующая попытка не пройдёт; повторная сработает.</small></span><input type="checkbox" checked={failNext} onChange={e => setFailNext(e.target.checked)}/></label><button className="primary-button modal-primary" onClick={() => { setDialog(null); changeRole('intern'); send('Нужен доступ к Jira', 'intern'); }} disabled={!!busy}>Начать демосценарий<ArrowRight size={16}/></button></Modal>}
    {dialog === 'reset' && <Modal title="Начать приключение заново?" onClose={() => setDialog(null)}><p className="modal-description">Переписка, заявка и прогресс этого демо будут сброшены. Знакомство с командой останется выполненным, как в начале.</p><div className="modal-actions"><button className="secondary-button" onClick={() => setDialog(null)}>Продолжить приключение</button><button className="primary-button" onClick={reset}><RotateCcw size={15}/>Начать заново</button></div></Modal>}
    {dialog === 'edit' && <Modal title="Проверим данные заявки" onClose={() => setDialog(null)}><form className="edit-form" onSubmit={e => { e.preventDefault(); if (reason.trim().length < 5) return; dispatch({ type: 'edit', resource: 'Jira', reason }); setDialog(null); }}><label>Инструмент<input value="Jira" readOnly/></label><label>Команда<input value="Backend" readOnly/></label><label>Зачем нужен доступ<textarea rows={3} value={reason} maxLength={240} minLength={5} onChange={e => setReason(e.target.value)} required/></label><small className={reason.trim().length < 5 ? 'invalid-hint' : 'muted'}>От 5 до 240 символов · {reason.length}/240</small><button className="primary-button modal-primary" disabled={reason.trim().length < 5}>Сохранить изменения<Check size={16}/></button></form></Modal>}
  </div>;
}
