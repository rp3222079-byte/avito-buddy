import { AlertTriangle, BarChart3, Check, CircleX, Medal, Users } from 'lucide-react';
import { useState } from 'react';
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

export default function MentorDashboard({ state, headingRef, approve, openChat, allFlags, hiddenFlags, flagError, retryFlags, onResolved, leaders, children }: {
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
}) {
  const { items, error, retry } = useResource(getInterns, mockMode ? demoInterns : undefined);
  const [filter, setFilter] = useState<InternStatus | ''>('');
  const [sort, setSort] = useState('name');
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const [selectedMetric, setSelectedMetric] = useState<string | null>(null);
  const [selectedTask, setSelectedTask] = useState<string | null>(null);
  const localInterns = mockMode && items ? withDemoProgress(items, state) : items;
  const flags = allFlags?.filter(flag => !flag.resolved_at && !hiddenFlags.includes(flag.id));
  const interns = localInterns?.map(intern => {
    if (!flags || !allFlags?.some(flag => flag.intern_id === intern.intern_id && hiddenFlags.includes(flag.id))) return intern;
    const active = flags.filter(flag => flag.intern_id === intern.intern_id);
    const status = active.some(flag => flag.severity === 'high') ? 'blocked'
      : active.length || intern.progress_percent < 30 ? 'at_risk' : 'on_track';
    return { ...intern, status, blockers: active.map(flag => flag.reason) } satisfies Intern;
  });
  const visible = interns?.filter(intern => (!filter || intern.status === filter)
    && (!onlyFlagged || flags?.some(flag => flag.intern_id === intern.intern_id))).sort((a, b) => {
    if (sort === 'progress-asc') return a.progress_percent - b.progress_percent;
    if (sort === 'progress-desc') return b.progress_percent - a.progress_percent;
    return a.name.localeCompare(b.name, 'ru');
  });
  return <section className="panel dashboard" id="mentor" aria-labelledby="dashboard-title">
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
            <label>Статус<select value={filter} onChange={event => setFilter(event.target.value as typeof filter)}>
              <option value="">Все</option>
              {(Object.keys(statuses) as InternStatus[]).map(id => <option key={id} value={id}>{statuses[id].label}</option>)}
            </select></label>
            <label>Сортировка<select value={sort} onChange={event => setSort(event.target.value)}>
              <option value="name">По имени</option>
              <option value="progress-asc">Прогресс по возрастанию</option>
              <option value="progress-desc">Прогресс по убыванию</option>
            </select></label>
            <label className="flag-filter"><input type="checkbox" checked={onlyFlagged} disabled={!flags} onChange={event => setOnlyFlagged(event.target.checked)}/>Только с флагами</label>
          </div>
          {flagError && <p role="alert">{flagError} <button className="secondary-button" onClick={retryFlags}>Повторить загрузку флагов</button></p>}
          {!visible?.length ? <p className="resource-state" role="status">{!interns.length ? 'Список стажёров пуст.' : onlyFlagged ? 'Нет стажёров с активными флагами.' : 'Нет стажёров с таким статусом.'}</p>
            : <div className="table-wrap" tabIndex={0} role="region" aria-label="Прогресс стажёров">
              <table className="intern-table" role="table">
                <thead role="rowgroup"><tr role="row"><th scope="col">Стажёр</th><th scope="col">Прогресс</th><th scope="col">Статус</th><th scope="col">Блокеры</th></tr></thead>
                <tbody role="rowgroup">{visible.map(intern => <tr key={intern.intern_id} role="row">
                  <th scope="row" role="rowheader"><button className="source-link" aria-label={`${mockMode ? 'Открыть чат' : 'Спросить Бадди о стажёре'} · ${intern.name}`} onClick={() => openChat(intern)}>{intern.name}</button>{leaders.has(intern.intern_id) && <Medal className="profile-medal" size={17} role="img" aria-label="Входит в топ-5"/>}
                    {intern.intern_id !== 'demo_roman' && <button className="source-link intern-detail-button" aria-expanded={selectedMetric === intern.intern_id} onClick={() => setSelectedMetric(selectedMetric === intern.intern_id ? null : intern.intern_id)}>Среднее время</button>}</th>
                  <td role="cell"><div className="intern-progress"><span className="xp-track"><span style={{ width: `${intern.progress_percent}%` }}/></span>{intern.progress_percent}%</div></td>
                  <td role="cell"><span className={`status-pill ${statuses[intern.status].style}`}>{statuses[intern.status].label}</span></td>
                  <td role="cell">{flags?.some(flag => flag.intern_id === intern.intern_id)
                    ? flags.filter(flag => flag.intern_id === intern.intern_id).map(flag => <div key={flag.id} className="flag-row">
                      <FlagBadge flag={flag} onResolved={onResolved}/>
                      <button className="source-link" aria-expanded={selectedTask === flag.task_id} onClick={() => setSelectedTask(selectedTask === flag.task_id ? null : flag.task_id)}>Этапы {flag.task_id}</button>
                    </div>)
                    : intern.blockers.length ? <ul className="blockers">{intern.blockers.map((item, index) => <li key={index}>{item}</li>)}</ul> : '—'}</td>
                </tr>)}</tbody>
              </table>
            </div>}
          {selectedMetric && visible?.some(intern => intern.intern_id === selectedMetric) && <section className="onboarding-panel">
            <h3>Среднее время · {visible.find(intern => intern.intern_id === selectedMetric)?.name}</h3><InternMetrics key={selectedMetric} id={selectedMetric}/>
          </section>}
          {selectedTask && flags?.some(flag => flag.task_id === selectedTask && visible?.some(intern => intern.intern_id === flag.intern_id)) && <section className="onboarding-panel">
            <h3>Этапы · {selectedTask}</h3><TaskStepper key={selectedTask} id={selectedTask}/>
          </section>}
        </div>
      </div>}
    {mockMode && state.ticket?.status === 'pending' && <div className="pending-review">
      <div><strong>{state.ticket.id} · Роман · Доступ к {state.ticket.resource}</strong><p>{state.ticket.reason}</p></div>
      <button className="primary-button" onClick={approve}><Check size={16}/>Согласовать в демо</button>
    </div>}
    {children}
  </section>;
}
