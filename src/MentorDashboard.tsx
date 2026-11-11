import { AlertTriangle, BarChart3, Check, CircleX, Users } from 'lucide-react';
import type { RefObject } from 'react';
import { quests } from './model';
import type { DemoState, Message } from './model';

const statuses = {
  onTrack: { label: 'On track', icon: Check },
  atRisk: { label: 'At risk', icon: AlertTriangle },
  blocked: { label: 'Blocked', icon: CircleX },
};
type Intern = { name: string; progress: number; status: keyof typeof statuses; blocker: string };
const demoInterns: Intern[] = [
  { name: 'Мария', progress: 45, status: 'atRisk', blocker: 'Ждёт доступ к Confluence' },
  { name: 'Иван', progress: 28, status: 'blocked', blocker: 'Нет доступа к GitLab' },
  { name: 'Лена', progress: 72, status: 'onTrack', blocker: '' },
];

function getInterns(state: DemoState): Intern[] {
  const pending = state.ticket?.status === 'pending';
  return [{
    name: 'Роман',
    progress: Math.round(state.completed.length / quests.length * 100),
    status: pending ? 'atRisk' : 'onTrack',
    blocker: pending ? 'Ждёт согласования доступа к Jira' : '',
  }, ...demoInterns];
}

export function mentorReply(text: string, state: DemoState): Pick<Message, 'text' | 'kind'> {
  const interns = getInterns(state);
  if (/блокер|помощ|риск|заявк|доступ/i.test(text)) {
    return {
      text: interns.filter(intern => intern.blocker).map(intern => `${intern.name}: ${intern.blocker.toLowerCase()}.`).join('\n'),
      kind: 'dashboard',
    };
  }
  if (/дашборд|стаж[её]р|сводк|прогресс|команд/i.test(text)) {
    const onTrack = interns.filter(intern => intern.status === 'onTrack').length;
    return { text: `Стажёров в команде: ${interns.length}. По плану идут ${onTrack}, нужна помощь ${interns.length - onTrack}. Прогресс Романа — ${interns[0].progress}%.`, kind: 'dashboard' };
  }
  return { text: 'Могу показать прогресс команды, перечислить блокеры и открыть дашборд стажёров.' };
}

export default function MentorDashboard({ state, headingRef, approve }: {
  state: DemoState;
  headingRef: RefObject<HTMLHeadingElement | null>;
  approve: () => void;
}) {
  const interns = getInterns(state);
  return <section className="panel dashboard" aria-labelledby="dashboard-title">
    <div className="module-title"><span><BarChart3 size={20}/></span><h2 id="dashboard-title" ref={headingRef} tabIndex={-1}>Дашборд наставника</h2><small>Демо</small></div>
    <div className="dashboard-content">
      <div className="metrics">
        <div><span><Users size={14}/>Стажёры</span><strong>{interns.length}</strong></div>
        {(Object.entries(statuses) as [keyof typeof statuses, typeof statuses.onTrack][]).map(([id, { label, icon: Icon }]) =>
          <div key={id}><span><Icon className={id} size={14}/>{label}</span><strong>{interns.filter(intern => intern.status === id).length}</strong></div>
        )}
      </div>
      <div className="table-wrap" tabIndex={0} role="region" aria-label="Прогресс стажёров">
        <table>
          <thead><tr><th scope="col">Стажёр</th><th scope="col">Прогресс</th><th scope="col">Статус</th><th scope="col">Блокеры</th></tr></thead>
          <tbody>{interns.map(intern => <tr key={intern.name}>
            <th scope="row">{intern.name}</th>
            <td><div className="intern-progress"><span className="xp-track"><span style={{ width: `${intern.progress}%` }}/></span>{intern.progress}%</div></td>
            <td><span className={`status-pill ${intern.status}`}>{statuses[intern.status].label}</span></td>
            <td>{intern.blocker || '—'}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </div>
    {state.ticket?.status === 'pending' && <div className="pending-review">
      <div><strong>{state.ticket.id} · Роман · Доступ к Jira</strong><p>{state.ticket.reason}</p></div>
      <button className="primary-button" onClick={approve}><Check size={16}/>Согласовать в демо</button>
    </div>}
  </section>;
}
