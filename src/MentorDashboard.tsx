import { AlertTriangle, BarChart3, Check, CircleX, Users } from 'lucide-react';
import { useState } from 'react';
import type { RefObject } from 'react';
import { demoInterns, getInterns, mockMode, withDemoProgress } from './api';
import type { Intern, InternStatus } from './api';
import type { DemoState } from './model';
import { useResource } from './useResource';

const statuses = {
  on_track: { label: 'По плану', icon: Check, style: 'onTrack' },
  at_risk: { label: 'Под риском', icon: AlertTriangle, style: 'atRisk' },
  blocked: { label: 'Есть блокеры', icon: CircleX, style: 'blocked' },
};

export default function MentorDashboard({ state, headingRef, approve, openChat }: {
  state: DemoState;
  headingRef: RefObject<HTMLHeadingElement | null>;
  approve: () => void;
  openChat: (intern: Intern) => void;
}) {
  const { items, error, retry } = useResource(getInterns, mockMode ? demoInterns : undefined);
  const [filter, setFilter] = useState<InternStatus | ''>('');
  const [sort, setSort] = useState('name');
  const interns = mockMode && items ? withDemoProgress(items, state) : items;
  const visible = interns?.filter(intern => !filter || intern.status === filter).sort((a, b) => {
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
          </div>
          {!visible?.length ? <p className="resource-state" role="status">{interns.length ? 'Нет стажёров с таким статусом.' : 'Список стажёров пуст.'}</p>
            : <div className="table-wrap" tabIndex={0} role="region" aria-label="Прогресс стажёров">
              <table>
                <thead><tr><th scope="col">Стажёр</th><th scope="col">Прогресс</th><th scope="col">Статус</th><th scope="col">Блокеры</th></tr></thead>
                <tbody>{visible.map(intern => <tr key={intern.intern_id}>
                  <th scope="row"><button className="source-link" aria-label={`Открыть чат · ${intern.name}`} onClick={() => openChat(intern)}>{intern.name}</button></th>
                  <td><div className="intern-progress"><span className="xp-track"><span style={{ width: `${intern.progress_percent}%` }}/></span>{intern.progress_percent}%</div></td>
                  <td><span className={`status-pill ${statuses[intern.status].style}`}>{statuses[intern.status].label}</span></td>
                  <td>{intern.blockers.length ? <ul className="blockers">{intern.blockers.map((item, index) => <li key={index}>{item}</li>)}</ul> : '—'}</td>
                </tr>)}</tbody>
              </table>
            </div>}
        </div>
      </div>}
    {mockMode && state.ticket?.status === 'pending' && <div className="pending-review">
      <div><strong>{state.ticket.id} · Роман · Доступ к {state.ticket.resource}</strong><p>{state.ticket.reason}</p></div>
      <button className="primary-button" onClick={approve}><Check size={16}/>Согласовать в демо</button>
    </div>}
  </section>;
}
