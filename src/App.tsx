import { useEffect, useReducer, useRef, useState } from 'react';
import { ArrowRight, BarChart3, Bell, BookOpen, Check, ChevronDown, ChevronRight, CircleHelp, Clock3, ExternalLink, KeyRound, ListChecks, LoaderCircle, Medal, MessageCircle, Pencil, RotateCcw, ShieldCheck, Sparkles, SquareCheck, Sun, Users, X } from 'lucide-react';
import { articles, getLevel, getXP, initialState, loadState, quests, reducer, saveState } from './model';
import type { ArticleId, Message } from './model';
import MentorDashboard from './MentorDashboard';
import Modal from './Modal';
import { closeSession, demoIdentities, demoNames, getTasks, mockMode, openSession, streamReply } from './api';
import type { Intern, Role } from './api';
import { ChatInput } from './ChatInput';
import { ActionButton, ChatMessage, MessageList, StreamingMessage } from './ChatMessage';
import { useResource } from './useResource';
import { FlagBadge, Scoreboard, TaskStepper } from './OnboardingDetails';
import { getFlags, getScoreboard, syncJira } from './onboardingApi';
import type { StuckFlag } from './onboardingApi';
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

function JiraTasks({ headingRef, flags }: { headingRef?: React.RefObject<HTMLHeadingElement | null>; flags?: StuckFlag[] }) {
  const { items, error, retry } = useResource(getTasks);
  const [expanded, setExpanded] = useState<string | null>(null);
  return <section className="panel module">
    <h2 ref={headingRef} tabIndex={-1}>Мои задачи</h2>
    {error ? <div role="alert">{error} <button className="secondary-button" onClick={retry}>Повторить загрузку</button></div>
      : !items ? <p role="status">Загружаем задачи…</p>
      : !items.length ? <p>У тебя нет активных задач.</p>
      : <ul className="task-list jira-list">{items.map(item => <li key={item.id}>
        <button type="button" aria-expanded={expanded === item.id} onClick={() => setExpanded(expanded === item.id ? null : item.id)}>
          <span><strong>{item.id}</strong> · {item.title}<small>{item.status}</small></span><ChevronDown size={16} aria-hidden="true"/>
        </button>
        {flags?.filter(flag => flag.task_id === item.id).map(flag => <FlagBadge key={flag.id} flag={flag}/>)}
        {expanded === item.id && <TaskStepper id={item.id}/>}
      </li>)}</ul>}
  </section>;
}

export default function App() {
  const [state, dispatch] = useReducer(reducer, undefined, () => mockMode ? loadState() : { ...initialState(), messages: [], completed: [] });
  const [role, setRole] = useState<Role>('intern');
  const [sessionAttempt, setSessionAttempt] = useState(0);
  const [sessionReady, setSessionReady] = useState(false);
  const [sessionError, setSessionError] = useState('');
  const currentSession = useRef<Role | null>(null);
  const scoreboard = useResource(getScoreboard);
  const flags = useResource(getFlags);
  const [hiddenFlags, setHiddenFlags] = useState<string[]>([]);
  const [showJira, setShowJira] = useState(false);
  const [mentorMessages, setMentorMessages] = useState<Message[]>(mockMode ? [firstMentorMessage] : []);
  const [threads, setThreads] = useState<Record<string, Message[]>>({});
  const [selectedIntern, setSelectedIntern] = useState<Intern | null>(null);
  const [route, setRoute] = useState(() => window.location.hash);
  const [partial, setPartial] = useState('');
  const [chatError, setChatError] = useState<{ message: string; text: string; id: string } | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [article, setArticle] = useState<ArticleId | null>(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState<'reply' | 'submit' | null>(null);
  const [failNext, setFailNext] = useState(false);
  const [disconnect, setDisconnect] = useState(false);
  const [sendError, setSendError] = useState(false);
  const [reason, setReason] = useState('');
  const [toast, setToast] = useState('');
  const [saveError, setSaveError] = useState(false);
  const chatRef = useRef<HTMLDivElement>(null);
  const chatHeading = useRef<HTMLHeadingElement>(null);
  const tasksRef = useRef<HTMLHeadingElement>(null);
  const dashboardRef = useRef<HTMLHeadingElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopReply = useRef<(() => void) | null>(null);
  const locked = useRef(false);
  const previousXP = useRef(getXP(state));
  const xp = getXP(state), level = getLevel(state);
  const ticket = state.ticket;
  const isIntern = role === 'intern';
  const messages = selectedIntern ? threads[selectedIntern.intern_id] ?? [] : isIntern ? state.messages : mentorMessages;
  const pendingTasks = quests.length - state.completed.length;
  const activeFlags = flags.items?.filter(flag => !flag.resolved_at && !hiddenFlags.includes(flag.id));
  const leaders = new Set(scoreboard.items?.entries.filter(entry => entry.is_top5).map(entry => entry.intern_id));

  useEffect(() => { if (mockMode) setSaveError(!saveState(state)); }, [state]);
  useEffect(() => {
    if (mockMode) return;
    const controller = new AbortController();
    async function connect() {
      if (currentSession.current) {
        await closeSession().catch(() => undefined);
        currentSession.current = null;
      }
      if (controller.signal.aborted) return;
      await openSession(role, controller.signal);
      if (controller.signal.aborted) return;
      currentSession.current = role;
      setSessionReady(true);
    }
    connect().catch((error: Error) => {
      if (!controller.signal.aborted) setSessionError(error.message);
    });
    return () => controller.abort();
  }, [role, sessionAttempt]);
  useEffect(() => { chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight }); }, [messages, busy, partial, role]);
  useEffect(() => {
    function updateRoute() { setRoute(window.location.hash); }
    window.addEventListener('hashchange', updateRoute);
    return () => window.removeEventListener('hashchange', updateRoute);
  }, []);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
    stopReply.current?.();
  }, []);
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

  function send(value: string, sender: Role = role, retryId?: string) {
    const text = value.trim();
    if (!text || locked.current) return;
    const recipient = sender === 'mentor' ? selectedIntern : null;
    function appendMessage(message: Omit<Message, 'id'>) {
      function append(history: Message[]) {
        return [...history.slice(-59), { ...message, id: (history.at(-1)?.id ?? 0) + 1 }];
      }
      if (recipient) setThreads(current => ({ ...current, [recipient.intern_id]: append(current[recipient.intern_id] ?? []) }));
      else setMentorMessages(append);
    }
    function finish() {
      stopReply.current = null;
      locked.current = false;
      setPartial('');
      setBusy(null);
    }
    setInput('');
    setChatError(null);
    if (mockMode && sender === 'intern' && ticket?.status === 'draft' && /^да[.!]?$/i.test(text)) {
      dispatch({ type: 'user', text });
      submit();
      return;
    }
    locked.current = true;
    if (!retryId) {
      if (sender === 'intern') dispatch({ type: 'user', text });
      else appendMessage({ role: 'user', text });
    }
    setBusy('reply');
    setDisconnect(false);
    const id = retryId ?? crypto.randomUUID();
    stopReply.current = streamReply(
      { text, role: sender, state, intern: recipient ?? undefined, disconnect, id },
      setPartial,
      message => {
        if (sender === 'mentor') appendMessage({ ...message, role: 'buddy' });
        else if (message.kind === 'request') dispatch({ type: 'reply', text });
        else dispatch({ type: 'answer', message });
        finish();
      },
      message => { setChatError({ message, text, id }); finish(); },
    );
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
    stopReply.current?.();
    stopReply.current = null;
    locked.current = false;
    dispatch({ type: 'reset' });
    setMentorMessages([firstMentorMessage]);
    setThreads({});
    setHiddenFlags([]);
    setShowJira(false);
    setSelectedIntern(null);
    setPartial('');
    setChatError(null);
    setRole('intern');
    navigate('#chat');
    setBusy(null);
    setDialog(null);
    setArticle(null);
    setFailNext(false);
    setDisconnect(false);
    setSendError(false);
    setInput('');
    setToast('Демо начато заново');
  }

  function openArticle(id: ArticleId) { setDialog(null); setArticle(id); }
  function navigate(hash: string) {
    if (window.location.hash !== hash) window.history.pushState(null, '', hash);
    setRoute(hash);
  }

  function showDashboard() {
    navigate('#mentor');
    dashboardRef.current?.focus();
  }

  function openChat(intern: Intern | null) {
    if (locked.current) return;
    setSelectedIntern(intern);
    setChatError(null);
    setInput('');
    navigate('#chat');
    chatHeading.current?.focus();
  }

  function changeRole(next: Role) {
    if (next === role) return;
    if (stopReply.current) {
      stopReply.current();
      stopReply.current = null;
      locked.current = false;
      setPartial('');
      setBusy(null);
    }
    setRole(next);
    setSessionReady(false);
    setSessionError('');
    setSelectedIntern(null);
    setChatError(null);
    setInput('');
    navigate(next === 'mentor' ? '#mentor' : '#chat');
  }

  function renewSession() {
    stopReply.current?.();
    stopReply.current = null;
    locked.current = false;
    setPartial('');
    setBusy(null);
    setSessionReady(false);
    setSessionError('');
    setSessionAttempt(attempt => attempt + 1);
  }

  if (!mockMode && !sessionReady) return <main className="panel resource-state session-state">
    <h1>Avito Start</h1>
    {sessionError
      ? <><p role="alert">{sessionError}</p><button className="primary-button" onClick={renewSession}>Повторить вход</button></>
      : <p role="status">Открываем демосессию…</p>}
  </main>;

  const profileName = mockMode ? (isIntern ? 'Роман' : 'Анна') : demoNames[role];
  const avatar = isIntern && mockMode ? <img src="/assets/roman-avatar.png" alt=""/> : <span className="initial-avatar">{profileName[0]}</span>;

  return <div className="app-shell">
    <header className="topbar">
      <a className="brand" href="#chat" onClick={e => { e.preventDefault(); openChat(null); }}>
        <span className="brand-lockup"><img src="/assets/avito-logo.svg" alt="Avito"/> <b>Start</b></span>
        <span className="brand-divider"/><strong>Бадди</strong>
      </a>
      <div className="role-switch" role="group" aria-label="Роль в демо">
        <button type="button" aria-pressed={isIntern} onClick={() => changeRole('intern')}><Users size={17}/>Стажёр</button>
        <button type="button" aria-pressed={!isIntern} onClick={() => changeRole('mentor')}><Users size={17}/>Наставник</button>
      </div>
      <div className="header-actions">
        {mockMode && !selectedIntern && <button className="icon-button notification" aria-label={isIntern ? 'Утренний брифинг в чате' : 'Сводка по стажёрам в чате'} disabled={!!busy} onClick={() => { send(isIntern ? internPrompts[0].text : mentorPrompts[0].text); chatHeading.current?.focus(); }}><Bell size={22}/></button>}
        <details className="profile">
          <summary aria-label={mockMode ? (isIntern ? 'Меню профиля Романа' : 'Меню профиля Анны') : `Меню профиля · ${profileName}`}>{avatar}<span className="profile-copy"><strong>{profileName}</strong>
            {isIntern && mockMode ? <><small>Уровень {level} · <span>{xp} / {level * 200} XP</span></small><span className="xp-track"><span style={{ width: `${xp / (level * 2)}%` }}/></span></> : <small>{isIntern ? 'Стажёр' : 'Наставник'}</small>}
          </span>{isIntern && !mockMode && leaders.has(demoIdentities.intern) && <Medal size={18} className="profile-medal" role="img" aria-label="Входит в топ-5"/>}<ChevronDown size={16}/></summary>
          {mockMode && <div className="profile-menu"><button onClick={() => setDialog('reset')}><RotateCcw size={16}/>Начать демо заново</button></div>}
          {!mockMode && <div className="profile-menu"><button onClick={renewSession}><RotateCcw size={16}/>Обновить демосессию</button></div>}
        </details>
      </div>
    </header>

    <aside className="sidebar">
      <nav aria-label="Разделы">
        <button className="nav-primary" onClick={() => openChat(null)}><MessageCircle size={21}/>Чат с Бадди</button>
        {isIntern
          ? <button onClick={() => tasksRef.current?.focus()}><SquareCheck size={20}/>Мои задачи</button>
          : <button onClick={showDashboard}><BarChart3 size={20}/>Стажёры</button>}
        {mockMode && <button onClick={() => setDialog('library')}><BookOpen size={20}/>База знаний</button>}
      </nav>
      <div className="buddy-intro">
        <BuddyArt pose="wave"/>
        <div className="panel"><strong>Бадди</strong><p>Твой AI-наставник в Авито. Помогаю с задачами, доступами и отвечаю на вопросы.</p></div>
      </div>
      {mockMode && <button className="help-button" onClick={() => setDialog('demo')}><CircleHelp size={20}/>Помощь</button>}
      <div className="brand-shapes" aria-hidden="true"><i/><i/><i/></div>
    </aside>

    <main className={isIntern ? 'workspace intern' : 'workspace mentor'}>
      <section id="chat" className="chat-panel panel" aria-label="Чат с Бадди">
        <div className="chat-header">
          <span className="buddy-avatar"><BuddyArt pose="avatar"/></span>
          <div><h1 ref={chatHeading} tabIndex={-1}>{selectedIntern ? (mockMode ? selectedIntern.name : `Бадди · ${selectedIntern.name}`) : 'Бадди'}</h1>
            {mockMode && <p>{selectedIntern ? 'Демопереписка' : <><span className="online-dot"/>Онлайн</>}</p>}
          </div>
        </div>
        <MessageList scrollRef={chatRef}>
          {messages.map(m => <ChatMessage key={`${selectedIntern?.intern_id ?? role}:${m.id}`} message={m} avatar={m.role === 'buddy' ? <BuddyArt pose="avatar"/> : avatar}>
              {m.source && <button className="source-link" onClick={() => openArticle(m.source!)}><ExternalLink size={14}/>{articles[m.source].label} · тестовая инструкция</button>}
              {m.kind === 'briefing' && <div className="ticket-card briefing">
                <h3><Sun size={18}/>Утренний брифинг</h3>
                <button className="secondary-button" onClick={() => tasksRef.current?.focus()}>Открыть задачи<ArrowRight size={15}/></button>
              </div>}
              {m.kind === 'dashboard' && !isIntern && <button className="source-link" onClick={showDashboard}><BarChart3 size={16}/>Открыть дашборд</button>}
            {m.kind === 'request' && ticket && <div className={`ticket-card ${ticket.status}`}>
              <div className="ticket-card-top"><span className="ticket-icon"><KeyRound size={18}/></span><div><small>{ticket.status === 'draft' ? 'ЧЕРНОВИК ЗАЯВКИ' : ticket.id}</small><h3>Доступ к {ticket.resource}</h3></div><span className="ticket-status-icon">{ticket.status === 'approved' ? <Check size={18}/> : ticket.status === 'pending' ? <Clock3 size={16}/> : <Pencil size={15}/>}</span></div>
              <dl><div><dt>Кому</dt><dd>Роман · Backend</dd></div><div><dt>Зачем</dt><dd>{ticket.reason}</dd></div></dl>
              {ticket.status === 'draft' ? <><p className="ticket-note">Проверь данные перед отправкой.</p>{sendError && <p className="error-note" role="alert">Сервис недоступен. Попробуй ещё раз — данные сохранены.</p>}<button className="primary-button ticket-submit" onClick={submit} disabled={!!busy}>{busy === 'submit' ? <><LoaderCircle className="spin" size={16}/>Отправляем…</> : <>Отправить заявку<ArrowRight size={15}/></>}</button><button className="edit-button" disabled={!!busy} onClick={() => { setReason(ticket.reason); setDialog('edit'); }}><Pencil size={12}/>Изменить данные</button></> : <><div className={`status-label ${ticket.status}`}>{ticket.status === 'pending' ? <><Clock3 size={13}/>Ожидает согласования</> : <><ShieldCheck size={14}/>Доступ выдан · +120 XP</>}</div></>}
            </div>}
          </ChatMessage>)}
          {busy === 'reply' && <StreamingMessage text={partial}/>}
          {chatError && <div className="resource-state" role="alert">{chatError.message} <button className="secondary-button" onClick={() => send(chatError.text, role, chatError.id)}>Повторить отправку</button></div>}
        </MessageList>
        <div className="chat-composer">
          {!selectedIntern && <div className="quick-replies">{(isIntern ? (mockMode ? internPrompts : internPrompts.slice(0, 2)) : mentorPrompts).map(({ label, text, icon: Icon }) =>
            <button key={label} disabled={!!busy} onClick={() => send(text)}><Icon size={14}/>{label}</button>)}</div>}
          <ChatInput input={input} busy={!!busy} onChange={setInput} onSend={() => send(input)}/>
          {!mockMode && isIntern && <ActionButton action={{ type: 'button', id: 'create_access_ticket', label: 'Подготовить заявку', data: { system: 'jira' } }}/>}
        </div>
      </section>

      {isIntern && route === '#mentor' && <p className="panel resource-state" role="alert">403 · Дашборд доступен наставнику.</p>}
      {isIntern ? mockMode ? <aside className="modules" aria-label="Дополнительные разделы">
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
        <section className="panel module">
          <button className="secondary-button" aria-expanded={showJira} onClick={() => setShowJira(!showJira)}>Задачи Jira<ChevronDown size={16}/></button>
          {showJira && <JiraTasks flags={activeFlags}/>}
        </section>
      </aside> : <JiraTasks headingRef={tasksRef} flags={activeFlags}/> : <MentorDashboard
        state={state} headingRef={dashboardRef} approve={() => dispatch({ type: 'approve' })} openChat={openChat}
        allFlags={flags.items} hiddenFlags={hiddenFlags} flagError={flags.error} retryFlags={flags.retry} leaders={leaders}
        onResolved={id => {
          // The MVP endpoint acknowledges the action without mutating the fixture.
          setHiddenFlags(current => [...current, id]);
        }}>
        <Scoreboard value={scoreboard.items} error={scoreboard.error} retry={scoreboard.retry} sync={async signal => {
          const result = await syncJira(signal);
          if (!signal.aborted) scoreboard.replace(result);
        }}/>
      </MentorDashboard>}
    </main>

    {saveError && <p className="save-warning" role="status">Прогресс не сохранён: хранилище недоступно.</p>}
    {toast && <div className="toast" role="status"><Sparkles size={18}/><span>{toast}</span><button aria-label="Скрыть уведомление" onClick={() => setToast('')}><X size={16}/></button></div>}

    {article && <Modal title={articles[article].title} onClose={() => setArticle(null)}><p className="modal-tag"><BookOpen size={14}/>Тестовая инструкция · не регламент Авито</p><div className="article-content">{articles[article].sections.map(([title, text]) => <section key={title}><h3>{title}</h3><p>{text}</p></section>)}</div>{article === 'team' && <button className="primary-button modal-primary" disabled={state.completed.includes('guide')} onClick={() => { dispatch({ type: 'read' }); setArticle(null); }}>{state.completed.includes('guide') ? 'Уже прочитано' : 'Прочитал, всё понятно · +100 XP'}<Check size={16}/></button>}</Modal>}
    {dialog === 'library' && <Modal title="Библиотека знаний" onClose={() => setDialog(null)}><p className="modal-description">Самое нужное для первых дней. Материалы вымышлены для демонстрации.</p>{(['access','team'] as ArticleId[]).map(id => <button className="library-item" key={id} onClick={() => openArticle(id)}><BookOpen size={24}/><span><strong>{articles[id].title}</strong><small>Тестовая инструкция · 2 минуты</small></span><ArrowRight size={17}/></button>)}</Modal>}
    {dialog === 'team' && <Modal title="Твоя команда — Backend" onClose={() => setDialog(null)}><div className="team-intro"><span className="mentor-avatar large">А</span><div><h3>Анна Соколова</h3><p>Твой наставник в демомире</p></div></div><p className="modal-description">Ты уже познакомился с командой — этот квест выполнен. Следующие шаги: получить доступ и изучить инструкции. Если нужна помощь с рабочим вопросом, обсуди его с Анной на 1:1.</p><div className="info-note"><Users size={18}/><span>Все имена, процессы и расписание здесь вымышлены. Реальные сообщения наставнику не отправляются.</span></div><button className="primary-button modal-primary" onClick={() => openArticle('team')}>Открыть инструкцию команды<ArrowRight size={16}/></button></Modal>}
    {dialog === 'demo' && <Modal title="Попробуй пройти один квест" onClose={() => setDialog(null)}><p className="modal-description">Это локальный прототип: ответы подготовлены заранее, заявки и согласования происходят только в браузере.</p><ol className="demo-steps"><li><span>01</span><div><strong>Попроси доступ к Jira</strong><p>Бадди предложит проверить черновик.</p></div></li><li><span>02</span><div><strong>Отправь заявку</strong><p>Появится номер REQ-042 и статус ожидания.</p></div></li><li><span>03</span><div><strong>В режиме наставника нажми «Согласовать в демо»</strong><p>Квест завершится и принесёт 120 XP.</p></div></li><li><span>04</span><div><strong>Изучи инструкцию команды</strong><p>Ещё 100 XP — и новый уровень!</p></div></li></ol><label className="switch-row"><span><strong>Проверить ошибку отправки</strong><small>Следующая попытка не пройдёт; повторная сработает.</small></span><input type="checkbox" checked={failNext} onChange={e => setFailNext(e.target.checked)}/></label><label className="switch-row"><span><strong>Прервать следующий ответ</strong><small>Ответ остановится после первых фрагментов.</small></span><input type="checkbox" checked={disconnect} onChange={e => setDisconnect(e.target.checked)}/></label><button className="primary-button modal-primary" onClick={() => { setDialog(null); changeRole('intern'); send('Нужен доступ к Jira', 'intern'); }} disabled={!!busy}>Начать демосценарий<ArrowRight size={16}/></button></Modal>}
    {dialog === 'reset' && <Modal title="Начать приключение заново?" onClose={() => setDialog(null)}><p className="modal-description">Переписка, заявка и прогресс этого демо будут сброшены. Знакомство с командой останется выполненным, как в начале.</p><div className="modal-actions"><button className="secondary-button" onClick={() => setDialog(null)}>Продолжить приключение</button><button className="primary-button" onClick={reset}><RotateCcw size={15}/>Начать заново</button></div></Modal>}
    {dialog === 'edit' && ticket && <Modal title="Проверим данные заявки" onClose={() => setDialog(null)}><form className="edit-form" onSubmit={e => { e.preventDefault(); if (reason.trim().length < 5) return; dispatch({ type: 'edit', resource: ticket.resource, reason }); setDialog(null); }}><label>Инструмент<input value={ticket.resource} readOnly/></label><label>Команда<input value="Backend" readOnly/></label><label>Зачем нужен доступ<textarea rows={3} value={reason} maxLength={240} minLength={5} onChange={e => setReason(e.target.value)} required/></label><small className={reason.trim().length < 5 ? 'invalid-hint' : 'muted'}>От 5 до 240 символов · {reason.length}/240</small><button className="primary-button modal-primary" disabled={reason.trim().length < 5}>Сохранить изменения<Check size={16}/></button></form></Modal>}
  </div>;
}
