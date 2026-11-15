import { AlertTriangle, BarChart3, Check, CircleX, Medal, Users } from 'lucide-react';
import { Fragment, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import { demoInterns, getInterns, mockMode, withDemoProgress } from './api';
import type { Intern, InternStatus } from './api';
import type { DemoState } from './model';
import { useResource } from './useResource';
import { FlagBadge, InternMetrics, TaskStepper } from './OnboardingDetails';
import type { StuckFlag } from './onboardingApi';

const statuses = {
  on_track: { label: 'По плану', icon: Check, style: 'onTrack' },
  at_risk: { label: 'Под риском', icon: AlertTriangle, style: 'atRisk' },
  blocked: { label: 'Есть блокеры', icon: CircleX, style: 'blocked' },
};

function matchesFlag(reason: string, flag: StuckFlag) {
  return reason === flag.reason || reason.replace(` ${flag.task_id} `, ' ') === flag.reason;
}

export default function MentorDashboard({ state, headingRef, approve, openChat, allFlags, hiddenFlags, flagError, retryFlags, onResolved, leaders, children, hidden }: {
  state: DemoState;
  headingRef: RefObject<HTMLHeadingElement | null>;
  approve: () => void;
  openChat: (intern: Intern) => void;
  allFlags?: StuckFlag[];
  hiddenFlags: string[];
  flagError: string;
  retryFlags: () => void;
  onResolved: (id: string) => void;
  leaders: Set<string>;
  children: ReactNode;
  hidden: boolean;
}) {
  const { items, error, retry } = useResource(getInterns, mockMode ? demoInterns : undefined);
  const [filter, setFilter] = useState<InternStatus | ''>('');
  const [sort, setSort] = useState('attention');
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const [selectedMetric, setSelectedMetric] = useState<string | null>(null);
  const [selectedTask, setSelectedTask] = useState<string | null>(null);
  const [resolvedTask, setResolvedTask] = useState('');
  const resolvedIntern = useRef<string | null>(null);
  const flagFilter = useRef<HTMLInputElement>(null);
  const statusFilter = useRef<HTMLSelectElement>(null);
  const localInterns = mockMode && items ? withDemoProgress(items, state) : items;
  const flags = allFlags?.filter(flag => !flag.resolved_at && !hiddenFlags.includes(flag.id));
  const interns = localInterns?.map(intern => {
    if (!flags || !allFlags?.some(flag => flag.intern_id === intern.intern_id && hiddenFlags.includes(flag.id))) return intern;
    const active = flags.filter(flag => flag.intern_id === intern.intern_id);
    const status = active.some(flag => flag.severity === 'high') ? 'blocked'
      : active.length || intern.progress_percent < 30 ? 'at_risk' : 'on_track';
    const resolved = allFlags.filter(flag => flag.intern_id === intern.intern_id && hiddenFlags.includes(flag.id));
    const blockers = intern.blockers.filter(reason => !resolved.some(flag => matchesFlag(reason, flag)));
    return { ...intern, status: blockers.some(reason => !active.some(flag => matchesFlag(reason, flag))) ? intern.status : status, blockers } satisfies Intern;
  });
  const visible = interns?.filter(intern => (!filter || intern.status === filter)
    && (!onlyFlagged || flags?.some(flag => flag.intern_id === intern.intern_id))).sort((a, b) => {
    if (sort === 'progress-asc') return a.progress_percent - b.progress_percent;
    if (sort === 'progress-desc') return b.progress_percent - a.progress_percent;
    if (sort === 'attention') {
      const priority = (intern: Intern) => flags?.some(flag => flag.intern_id === intern.intern_id && flag.severity === 'high') ? 3
        : flags?.some(flag => flag.intern_id === intern.intern_id) ? 2 : intern.blockers.length ? 1 : 0;
      const difference = priority(b) - priority(a);
      if (difference) return difference;
    }
    return a.name.localeCompare(b.name, 'ru');
  });
  useLayoutEffect(() => {
    if (!resolvedIntern.current) return;
    const rowButton = document.getElementById(`intern-${resolvedIntern.current}`);
    (rowButton ?? (onlyFlagged ? flagFilter.current : statusFilter.current))?.focus();
    resolvedIntern.current = null;
  }, [hiddenFlags, onlyFlagged]);

  return <section className="panel dashboard" id="mentor" aria-labelledby="dashboard-title" hidden={hidden}>
    <div className="module-title"><span><BarChart3 size={20}/></span><h2 id="dashboard-title" ref={headingRef} tabIndex={-1}>Дашборд наставника</h2>{mockMode && <small>Демо</small>}</div>
    {error ? <div className="resource-state" role="alert">{error} <button className="secondary-button" onClick={retry}>Повторить загрузку</button></div>
      : !interns ? <p className="resource-state" role="status">Загружаем стажёров…</p>
      : <div className="dashboard-content">
        <div className="metrics">
          <div><span><Users size={14}/>Стажёры</span><strong>{interns.length}</strong></div>
          {(Object.keys(statuses) as InternStatus[]).map(id => {
            const { label, icon: Icon, style } = statuses[id];
            return <div key={id}><span><Icon className={style} size={14}/>{label}</span><strong>{interns.filter(intern => intern.status === id).length}</strong></div>;
          })}
        </div>
        <div>
          <div className="dashboard-controls">
            <label>Статус<select ref={statusFilter} value={filter} onChange={event => setFilter(event.target.value as typeof filter)}>
              <option value="">Все</option>
              {(Object.keys(statuses) as InternStatus[]).map(id => <option key={id} value={id}>{statuses[id].label}</option>)}
            </select></label>
            <label>Сортировка<select value={sort} onChange={event => setSort(event.target.value)}>
              <option value="attention">Сначала с блокерами</option>
              <option value="name">По имени</option>
              <option value="progress-asc">Меньший прогресс</option>
              <option value="progress-desc">Больший прогресс</option>
            </select></label>
            <label className="flag-filter"><input ref={flagFilter} type="checkbox" checked={onlyFlagged} disabled={!flags} onChange={event => setOnlyFlagged(event.target.checked)}/>Только с флагами</label>
          </div>
          {resolvedTask && <p className="resource-state" role="status">Флаг задачи {resolvedTask} снят.</p>}
          {flagError && <p role="alert">{flagError} <button className="secondary-button" onClick={retryFlags}>Повторить загрузку флагов</button></p>}
          {!visible?.length ? <p className="resource-state" role="status">{!interns.length ? 'Список стажёров пуст.' : onlyFlagged ? 'Нет стажёров с активными флагами.' : 'Нет стажёров с таким статусом.'}</p>
            : <div className="table-wrap" role="region" aria-label="Прогресс стажёров">
              <table className="intern-table" role="table">
                <thead role="rowgroup"><tr role="row"><th scope="col">Стажёр</th><th scope="col">Прогресс</th><th scope="col">Статус</th><th scope="col">Блокеры</th></tr></thead>
                <tbody role="rowgroup">{visible.map(intern => {
                  const rowFlags = flags?.filter(flag => flag.intern_id === intern.intern_id) ?? [];
                  const blockers = intern.blockers.filter(reason => !rowFlags.some(flag => matchesFlag(reason, flag)));
                  return <Fragment key={intern.intern_id}><tr role="row">
                  <th scope="row" role="rowheader"><div className="intern-name">
                    <button id={`intern-${intern.intern_id}`} className="source-link" aria-label={`${mockMode ? 'Открыть чат' : 'Спросить Бадди о стажёре'} · ${intern.name}`} onClick={() => openChat(intern)}>{intern.name}</button>
                    {leaders.has(intern.intern_id) && <Medal className="profile-medal" size={17} role="img" aria-label="Входит в топ-5"/>}
                  </div>
                    {intern.intern_id !== 'demo_roman' && <button className="source-link intern-detail-button" aria-expanded={selectedMetric === intern.intern_id} onClick={() => setSelectedMetric(selectedMetric === intern.intern_id ? null : intern.intern_id)}>Среднее время</button>}</th>
                  <td role="cell"><div className="intern-progress"><span className="xp-track"><span style={{ width: `${intern.progress_percent}%` }}/></span>{intern.progress_percent}%</div></td>
                  <td role="cell"><span className={`status-pill ${statuses[intern.status].style}`}>{statuses[intern.status].label}</span></td>
                  <td role="cell">
                    {rowFlags.map(flag => <div key={flag.id} className="flag-row">
                      <div className="flag-controls">
                        <FlagBadge flag={flag} onResolved={id => {
                          resolvedIntern.current = intern.intern_id;
                          setResolvedTask(flag.task_id);
                          setSelectedTask(current => current === id ? null : current);
                          onResolved(id);
                        }}/>
                        <button className="source-link" aria-expanded={selectedTask === flag.id} onClick={() => setSelectedTask(selectedTask === flag.id ? null : flag.id)}>Этапы {flag.task_id}</button>
                      </div>
                      {selectedTask === flag.id && <TaskStepper id={flag.task_id}/>}
                    </div>)}
                    {blockers.length ? <ul className="blockers">{blockers.map((item, index) => <li key={index}>{item}</li>)}</ul> : !rowFlags.length && <span className="muted">Нет блокеров</span>}
                  </td>
                </tr>
                {selectedMetric === intern.intern_id && <tr className="metric-row" role="row"><td colSpan={4} role="cell">
                  <section aria-label={`Среднее время · ${intern.name}`}>
                    <h3>Среднее время</h3><p className="muted">За всё время</p>
                    <InternMetrics key={intern.intern_id} id={intern.intern_id}/>
                  </section>
                </td></tr>}</Fragment>;
                })}</tbody>
              </table>
            </div>}
        </div>
      </div>}
    {mockMode && state.ticket?.status === 'pending' && <div className="pending-review">
      <div><strong>{state.ticket.id} · Роман · Доступ к {state.ticket.resource}</strong><p>{state.ticket.reason}</p></div>
      <button className="primary-button" onClick={approve}><Check size={16}/>Согласовать в демо</button>
    </div>}
    {children}
  </section>;
}
