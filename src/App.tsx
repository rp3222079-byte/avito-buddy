import { useEffect, useReducer, useRef, useState } from 'react';
import { ArrowDown, ArrowRight, BookOpen, Check, ChevronRight, CircleHelp, Clock3, Compass, Crown, ExternalLink, Flag, KeyRound, Leaf, ListChecks, LoaderCircle, LockKeyhole, Map, MessageCircle, Pencil, RotateCcw, Send, ShieldCheck, Sparkles, Users, X } from 'lucide-react';
import { articles, getLevel, getXP, loadState, questStatus, quests, reducer, saveState } from './model';
import type { ArticleId, QuestId } from './model';
import Modal from './Modal';

type Dialog = 'library' | 'boss' | 'demo' | 'reset' | 'edit' | 'team' | null;
export default function App() {
  const [state, dispatch] = useReducer(reducer, undefined, () => loadState());
  const [selected, setSelected] = useState<QuestId>('access');
  const [dialog, setDialog] = useState<Dialog>(null);
  const [article, setArticle] = useState<ArticleId | null>(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState<'reply' | 'submit' | null>(null);
  const [failNext, setFailNext] = useState(false);
  const [sendError, setSendError] = useState(false);
  const [reason, setReason] = useState('');
  const [toast, setToast] = useState('');
  const [saveError, setSaveError] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<'room' | 'quests' | 'chat'>('room');
  const [rewards, setRewards] = useState(false);
  const chatRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const locked = useRef(false);
  const previousXP = useRef(getXP(state));
  const xp = getXP(state), level = getLevel(state);
  const activeQuest = quests.find(q => q.id === selected)!;
  const done = state.completed.length;

  useEffect(() => { setSaveError(!saveState(state)); }, [state]);
  useEffect(() => { chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: 'smooth' }); }, [state.messages, busy, mobilePanel]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => { setToast(''); setRewards(false); }, 4500);
    return () => clearTimeout(id);
  }, [toast]);
  useEffect(() => {
    if (xp > previousXP.current) {
      const leveled = Math.floor(xp / 200) > Math.floor(previousXP.current / 200);
      setToast(leveled ? `Новый уровень ${level}! Отличная работа, Роман.` : `Квест выполнен! +${xp - previousXP.current} XP`);
      setRewards(true);
    }
    previousXP.current = xp;
  }, [xp, level]);

  function send(text: string) {
    if (!text.trim() || locked.current) return;
    locked.current = true;
    dispatch({ type: 'user', text }); setInput(''); setBusy('reply'); setMobilePanel('chat');
    timer.current = setTimeout(() => { dispatch({ type: 'reply', text }); setBusy(null); locked.current = false; }, 650);
  }
  function submit() {
    if (locked.current || state.ticket?.status !== 'draft') return;
    locked.current = true; setBusy('submit'); setSendError(false);
    timer.current = setTimeout(() => {
      dispatch({ type: 'submit', fail: failNext }); setSendError(failNext); setFailNext(false); setBusy(null); locked.current = false;
    }, 900);
  }
  function reset() {
    if (timer.current) clearTimeout(timer.current);
    locked.current = false; setBusy(null); dispatch({ type: 'reset' }); setDialog(null); setArticle(null);
    setSelected('access'); setFailNext(false); setSendError(false); setInput(''); setMobilePanel('room'); setToast('Демо начато заново'); setRewards(false);
  }
  function selectQuest(id: QuestId) { setSelected(id); setMobilePanel('room'); }
  function openArticle(id: ArticleId) { setDialog(null); setArticle(id); }
  function startQuest() {
    if (selected === 'team') setDialog('team');
    else if (selected === 'guide') openArticle('team');
    else send(state.ticket ? 'Какой статус заявки?' : 'Нужен доступ к Jira');
  }
  const ticket = state.ticket;
  const status = questStatus(state, selected);

  return <div className="app-shell">
    <header className="topbar">
      <a className="brand" href="#" aria-label="Avito Start — комната Бадди" onClick={e => { e.preventDefault(); setMobilePanel('room'); setSelected('access'); }}>
        <span className="brand-dots" aria-hidden="true"><i/><i/><i/><i/></span><span>Avito <b>Start</b></span>
      </a>
      <span className="brand-divider"/><div className="product-name">БАДДИ<span>твоё приключение начинается</span></div>
      <div className="header-actions"><button className="demo-badge" onClick={() => setDialog('demo')}><span/>Демо-мир<CircleHelp size={13}/></button>
        <button className="icon-button reset-button" title="Начать заново" aria-label="Начать демо заново" onClick={() => setDialog('reset')}><RotateCcw size={18}/></button>
        <div className="profile"><span className="roman-avatar" aria-hidden="true">Р</span><div><strong>Роман</strong><span>Backend · стажёр</span></div><span className="level-chip">LVL {level}</span></div>
      </div>
    </header>

    <nav className="mobile-nav" aria-label="Разделы"><button className={mobilePanel === 'quests' ? 'active' : ''} onClick={() => setMobilePanel('quests')}><ListChecks size={16}/>Квесты</button><button className={mobilePanel === 'room' ? 'active' : ''} onClick={() => setMobilePanel('room')}><Compass size={16}/>Комната</button><button className={mobilePanel === 'chat' ? 'active' : ''} onClick={() => setMobilePanel('chat')}><MessageCircle size={16}/>Бадди</button></nav>

    <main className={`workspace mobile-${mobilePanel}`}>
      <aside className="quest-panel panel" aria-label="План адаптации">
        <div className="panel-kicker"><Map size={15}/><span>ТВОЙ ПУТЬ</span><span className="chapter-number">01</span></div>
        <h1>Первая неделя</h1><p className="muted intro">Большое приключение<br/>начинается с маленьких шагов.</p>
        <div className="quest-progress"><div><span>Пройдено квестов</span><strong>{done}<span> / 3</span></strong></div><div className="segmented-progress" aria-label={`Пройдено ${done} из 3 квестов`}>{[1,2,3].map(n => <i className={done >= n ? 'filled' : ''} key={n}/>)}</div></div>
        <div className="quest-list">{quests.map((q, index) => {
          const qs = questStatus(state, q.id);
          return <button key={q.id} className={`quest-item ${selected === q.id ? 'selected' : ''} ${qs}`} onClick={() => selectQuest(q.id)} aria-pressed={selected === q.id}>
            <span className="quest-icon">{qs === 'done' ? <Check size={18}/> : qs === 'pending' ? <Clock3 size={18}/> : q.id === 'access' ? <KeyRound size={18}/> : <BookOpen size={18}/>}</span>
            <span className="quest-copy"><span className="quest-order">КВЕСТ 0{index + 1}</span><strong>{q.short}</strong><span className="quest-state">{qs === 'done' ? 'Выполнено' : qs === 'pending' ? 'Ждём согласования' : 'Можно начать'}</span></span><ChevronRight size={15} className="quest-arrow"/>
          </button>;
        })}</div>
        <button className="next-chapter" onClick={() => setDialog('boss')}><span className="mini-crown"><Crown size={24}/></span><span><small>ВПЕРЕДИ</small><strong>Босс: Экватор</strong><em>Контрольная встреча</em></span><LockKeyhole size={14}/></button>
        <div className="sidebar-bottom"><div className="mentor-card"><span className="mentor-avatar">А</span><div><strong>Анна · твой наставник</strong><span>Вместе разберётесь со сложным</span></div><span className="online-dot"/></div><button className="subtle-link" onClick={() => setDialog('team')}>О нашей демокоманде <ArrowRight size={14}/></button></div>
      </aside>

      <section className="room-column" aria-label="Комната Бадди">
        <div className="room-heading"><div><span className="eyebrow">ГЛАВА I · НАЧАЛО ПУТИ</span><h2>Заходи, здесь свои<span className="heading-star">✦</span></h2></div><span className="room-tag"><span/>Комната Бадди</span></div>
        <div className="scene panel">
          <div className="scene-topline"><span><Leaf size={12}/> Твоя точка опоры</span><span className="scene-location">AVITO · BACKEND</span></div>
          <div className="room-art-wrap"><img className="room-art" src="/assets/buddy-room.png" alt="Уютная пиксельная комната: Бадди-проводник помогает Роману за столом; рядом библиотека и портал к Экватору"/>
            <button className="hotspot hotspot-library" onClick={() => setDialog('library')}><BookOpen size={15}/>Библиотека<span>↗</span></button>
            <button className="hotspot hotspot-boss" onClick={() => setDialog('boss')}><Crown size={15}/>Экватор<LockKeyhole size={12}/></button>
            <button className="hotspot hotspot-quests" onClick={() => { setMobilePanel('quests'); setSelected('access'); setToast('Выбери квест в списке слева'); }}><ListChecks size={15}/>Мои квесты<span>↗</span></button>
            <span className="pixel-spark spark-a"/><span className="pixel-spark spark-b"/><span className="pixel-spark spark-c"/>
          </div>
          <div className="scene-caption"><span className="tiny-diamond"/>Нажимай на предметы — в комнате есть подсказки</div>
        </div>

        <section className={`current-quest panel ${status}`} aria-labelledby="current-quest-title"><div className="current-icon">{status === 'done' ? <ShieldCheck/> : selected === 'access' ? <KeyRound/> : <BookOpen/>}</div><div className="current-content"><div className="current-eyebrow"><span>{status === 'done' ? 'КВЕСТ ПРОЙДЕН' : status === 'pending' ? 'КВЕСТ В ПРОЦЕССЕ' : 'СЛЕДУЮЩИЙ ШАГ'}</span><span className="xp-reward">+{activeQuest.xp} XP</span></div><h3 id="current-quest-title">{activeQuest.title}</h3><p>{status === 'pending' ? 'Заявка отправлена. Пока ждём — можно изучить инструкции.' : status === 'done' ? 'Отличная работа! Выбери следующий квест в своём плане.' : activeQuest.description}</p><button className="primary-button" onClick={startQuest} disabled={!!busy}>{selected === 'team' ? 'Открыть команду' : selected === 'guide' ? 'Читать инструкцию' : ticket ? 'Посмотреть заявку' : 'Попросить Бадди помочь'}<ArrowRight size={16}/></button></div></section>
        <div className="level-progress"><span className="level-shield"><Sparkles size={15}/>{level}</span><div><div className="level-label"><strong>Каждый шаг — новый опыт</strong><span>{xp} / {(level)*200} XP</span></div><div className="xp-track" role="progressbar" aria-label="Опыт до следующего уровня" aria-valuenow={xp % 200} aria-valuemin={0} aria-valuemax={200}><span style={{width: `${(xp % 200) / 2}%`}}/></div></div><span className="next-level">LVL {level+1}</span></div>
      </section>

      <section className="chat-panel panel" aria-label="Чат с Бадди">
        <div className="chat-header"><div className="buddy-avatar"><img src="/assets/buddy-guide.png" alt="Бадди-проводник"/><i/></div><div><h2>Бадди рядом <span>✦</span></h2><p>Твой мудрый проводник</p></div><button className="icon-button" aria-label="Как работает демо" onClick={() => setDialog('demo')}><CircleHelp size={18}/></button></div>
        <div className="chat-safety"><ShieldCheck size={13}/>Безопасный демомир · тестовые данные</div>
        <div className="chat-scroll" ref={chatRef} role="log" aria-label="Переписка" aria-live="polite" aria-relevant="additions text"><div className="chat-date"><span/>НАЧАЛО ПРИКЛЮЧЕНИЯ<span/></div>
          {state.messages.map(m => <div key={m.id} className={`message ${m.role}`}><span className="message-author">{m.role === 'buddy' ? 'БАДДИ' : 'ТЫ'}</span><div className="message-bubble">{m.text}</div>{m.source && <button className="source-link" onClick={() => openArticle(m.source!)}><BookOpen size={12}/>{articles[m.source].label} · тестовая инструкция<ExternalLink size={11}/></button>}
            {m.kind === 'request' && ticket && <div className={`ticket-card ${ticket.status}`}>
              <div className="ticket-card-top"><span className="ticket-icon"><KeyRound size={18}/></span><div><small>{ticket.status === 'draft' ? 'ЧЕРНОВИК ЗАЯВКИ' : ticket.id}</small><h3>Доступ к {ticket.resource}</h3></div><span className="ticket-status-icon">{ticket.status === 'approved' ? <Check size={18}/> : ticket.status === 'pending' ? <Clock3 size={16}/> : <Pencil size={15}/>}</span></div>
              <dl><div><dt>Кому</dt><dd>Роман · Backend</dd></div><div><dt>Зачем</dt><dd>{ticket.reason}</dd></div></dl>
              {ticket.status === 'draft' ? <><p className="ticket-note">Проверь данные перед отправкой.</p>{sendError && <p className="error-note" role="alert">Сервис недоступен. Попробуй ещё раз — данные сохранены.</p>}<button className="primary-button ticket-submit" onClick={submit} disabled={!!busy}>{busy === 'submit' ? <><LoaderCircle className="spin" size={16}/>Отправляем…</> : <>Отправить заявку<ArrowRight size={15}/></>}</button><button className="edit-button" disabled={!!busy} onClick={() => { setReason(ticket.reason); setDialog('edit'); }}><Pencil size={12}/>Изменить данные</button></> : <><div className={`status-label ${ticket.status}`}>{ticket.status === 'pending' ? <><Clock3 size={13}/>Ожидает согласования</> : <><ShieldCheck size={14}/>Доступ выдан · +120 XP</>}</div>{ticket.status === 'pending' && <button className="demo-approve" disabled={!!busy} onClick={() => dispatch({ type: 'approve' })}>Согласовать в демо <Check size={13}/></button>}</>}
            </div>}
          </div>)}
          {busy === 'reply' && <div className="typing" role="status"><i/><i/><i/><span>Бадди думает</span></div>}
        </div>
        <div className="chat-composer"><div className="quick-replies"><button disabled={!!busy} onClick={() => send('Нужен доступ к Jira')}><KeyRound size={12}/>Доступ к Jira</button><button disabled={!!busy} onClick={() => send('Что делать дальше?')}>Что дальше?<ArrowDown size={11}/></button></div><form onSubmit={e => { e.preventDefault(); send(input); }}><label className="sr-only" htmlFor="chat-input">Сообщение Бадди</label><textarea id="chat-input" ref={inputRef} rows={1} value={input} maxLength={500} onChange={e => setInput(e.target.value)} placeholder="Спроси Бадди…" onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); } }}/><button className="send-button" aria-label="Отправить сообщение" disabled={!input.trim() || !!busy}><Send size={17}/></button></form><div className="composer-hint"><span>Enter — отправить</span><span>Демоответы · без LLM</span></div></div>
      </section>
    </main>
    <footer className="app-footer"><span><span className="online-dot"/>Твой прогресс {saveError ? 'не сохранён: хранилище недоступно' : 'сохраняется в этом браузере'}</span><span>Сделано для первых шагов в Авито <Leaf size={12}/></span></footer>

    {toast && <div className={`toast ${rewards ? 'reward-toast' : ''}`} role="status">{rewards ? <Sparkles size={18}/> : <Check size={18}/>}<span>{toast}</span><button aria-label="Скрыть уведомление" onClick={() => { setToast(''); setRewards(false); }}><X size={14}/></button></div>}

    {article && <Modal title={articles[article].title} onClose={() => setArticle(null)}><p className="modal-tag"><BookOpen size={14}/>Тестовая инструкция · не регламент Авито</p><div className="article-content">{articles[article].sections.map(([title, text]) => <section key={title}><h3>{title}</h3><p>{text}</p></section>)}</div>{article === 'team' && <button className="primary-button modal-primary" disabled={state.completed.includes('guide')} onClick={() => { dispatch({ type: 'read' }); setArticle(null); setSelected('guide'); }}>{state.completed.includes('guide') ? 'Уже прочитано' : 'Прочитал, всё понятно · +100 XP'}<Check size={16}/></button>}</Modal>}
    {dialog === 'library' && <Modal title="Библиотека знаний" onClose={() => setDialog(null)}><p className="modal-description">Самое нужное для первых дней. Материалы вымышлены для демонстрации.</p>{(['access','team'] as ArticleId[]).map(id => <button className="library-item" key={id} onClick={() => openArticle(id)}><BookOpen size={24}/><span><strong>{articles[id].title}</strong><small>Тестовая инструкция · 2 минуты</small></span><ArrowRight size={17}/></button>)}</Modal>}
    {dialog === 'boss' && <Modal title="Босс: Экватор" onClose={() => setDialog(null)}><div className="boss-hero"><Crown size={48}/><span>КОНТРОЛЬНЫЙ ЭТАП</span></div><p className="modal-description">Встреча, на которой ты расскажешь о промежуточных результатах. Бадди поможет подготовиться шаг за шагом.</p><ol className="boss-steps"><li><Flag/><span><strong>Собрать результаты</strong>Какие задачи решил и чему научился</span></li><li><BookOpen/><span><strong>Подготовить презентацию</strong>Обсудить структуру с наставником</span></li><li><Users/><span><strong>Провести репетицию</strong>Потренироваться и получить обратную связь</span></li></ol><div className="info-note"><LockKeyhole size={18}/><span>Сейчас проходим первую неделю. Экватор — будущий этап; в этом демо показана подготовка, прохождение босса не реализовано.</span></div></Modal>}
    {dialog === 'team' && <Modal title="Твоя команда — Backend" onClose={() => setDialog(null)}><div className="team-intro"><span className="mentor-avatar large">А</span><div><h3>Анна Соколова</h3><p>Твой наставник в демомире</p></div></div><p className="modal-description">Ты уже познакомился с командой — этот квест выполнен. Следующие шаги: получить доступ и изучить инструкции. Если нужна помощь с рабочим вопросом, обсуди его с Анной на 1:1.</p><div className="info-note"><Users size={18}/><span>Все имена, процессы и расписание здесь вымышлены. Реальные сообщения наставнику не отправляются.</span></div><button className="primary-button modal-primary" onClick={() => openArticle('team')}>Открыть инструкцию команды<ArrowRight size={16}/></button></Modal>}
    {dialog === 'demo' && <Modal title="Попробуй пройти один квест" onClose={() => setDialog(null)}><p className="modal-description">Это локальный прототип: ответы подготовлены заранее, заявки и согласования происходят только в браузере.</p><ol className="demo-steps"><li><span>01</span><div><strong>Попроси доступ к Jira</strong><p>Бадди предложит проверить черновик.</p></div></li><li><span>02</span><div><strong>Отправь заявку</strong><p>Появится номер REQ-042 и статус ожидания.</p></div></li><li><span>03</span><div><strong>Нажми «Согласовать в демо»</strong><p>Квест завершится и принесёт 120 XP.</p></div></li><li><span>04</span><div><strong>Изучи инструкцию команды</strong><p>Ещё 100 XP — и новый уровень!</p></div></li></ol><label className="switch-row"><span><strong>Проверить ошибку отправки</strong><small>Следующая попытка не пройдёт; повторная сработает.</small></span><input type="checkbox" checked={failNext} onChange={e => setFailNext(e.target.checked)}/></label><button className="primary-button modal-primary" onClick={() => { setDialog(null); send('Нужен доступ к Jira'); }} disabled={!!busy}>Начать демосценарий<ArrowRight size={16}/></button></Modal>}
    {dialog === 'reset' && <Modal title="Начать приключение заново?" onClose={() => setDialog(null)}><p className="modal-description">Переписка, заявка и прогресс этого демо будут сброшены. Знакомство с командой останется выполненным, как в начале.</p><div className="modal-actions"><button className="secondary-button" onClick={() => setDialog(null)}>Продолжить приключение</button><button className="primary-button" onClick={reset}><RotateCcw size={15}/>Начать заново</button></div></Modal>}
    {dialog === 'edit' && <Modal title="Проверим данные заявки" onClose={() => setDialog(null)}><form className="edit-form" onSubmit={e => { e.preventDefault(); if (reason.trim().length < 5) return; dispatch({ type: 'edit', resource: 'Jira', reason }); setDialog(null); }}><label>Инструмент<input value="Jira" readOnly/></label><label>Команда<input value="Backend" readOnly/></label><label>Зачем нужен доступ<textarea rows={3} value={reason} maxLength={240} minLength={5} onChange={e => setReason(e.target.value)} required/></label><small className={reason.trim().length < 5 ? 'invalid-hint' : 'muted'}>От 5 до 240 символов · {reason.length}/240</small><button className="primary-button modal-primary" disabled={reason.trim().length < 5}>Сохранить изменения<Check size={16}/></button></form></Modal>}
  </div>;
}
