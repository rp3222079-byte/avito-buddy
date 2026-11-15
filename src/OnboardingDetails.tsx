import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, ChevronDown, Crown, Medal, RefreshCw } from 'lucide-react';
import { getMetrics, getTaskStage, resolveFlag, stageLabels } from './onboardingApi';
import type { getScoreboard, StuckFlag } from './onboardingApi';
import { useResource } from './useResource';

export function Scoreboard({ value, error, retry, sync }: {
  value?: Awaited<ReturnType<typeof getScoreboard>>;
  error: string;
  retry: () => void;
  sync: (signal: AbortSignal) => Promise<number | undefined>;
}) {
  const active = useRef<AbortController | null>(null);
  const [updating, setUpdating] = useState(false);
  const [updated, setUpdated] = useState('');
  const [syncError, setSyncError] = useState('');
  useEffect(() => () => active.current?.abort(), []);

  async function refresh() {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setUpdating(true);
    setUpdated('');
    setSyncError('');
    try {
      const count = await sync(controller.signal);
      if (!controller.signal.aborted) setUpdated(count === undefined
        ? 'Рейтинг демо-недели обновлён.'
        : `Рейтинг обновлён. Задач обработано при демо-синхронизации: ${count}.`);
    } catch (error) {
      if (!controller.signal.aborted) setSyncError(error instanceof Error ? error.message : 'Не удалось обновить рейтинг.');
    } finally {
      active.current = null;
      if (!controller.signal.aborted) setUpdating(false);
    }
  }

  const entries = value ? [...value.entries].sort((a, b) => a.place - b.place) : [];
  return <section className="onboarding-panel" aria-label="Рейтинг стажёров">
    <div className="scoreboard-header">
      <div className="module-title">
        <span><Medal size={19}/></span><div><h3>Рейтинг недели</h3>{value && <p className="muted">Демо-неделя · {value.week}</p>}</div>
      </div>
      <button className="secondary-button" onClick={refresh} disabled={updating || !value || !!error}>
        <RefreshCw size={16} className={updating ? 'spin' : ''} aria-hidden="true"/>{updating ? 'Обновляем…' : 'Обновить из Jira'}
      </button>
    </div>
    <p className="sync-status" role="status">{updating ? 'Обновляем данные Jira и рейтинг…' : updated}</p>
    {syncError && <p className="error-note" role="alert">Рейтинг не обновился. {syncError}</p>}
    {error ? <p role="alert">{error} <button className="secondary-button" onClick={retry}>Повторить загрузку рейтинга</button></p>
      : !value ? <p role="status">Загружаем рейтинг…</p>
      : !entries.length ? <p>Рейтинг пока пуст.</p>
      : <>
        <h4>Стажёр недели</h4>
        <ol className="score-leaders">{entries.filter(entry => entry.is_top5).slice(0, 5).map(entry => (
          <li key={entry.intern_id}>{entry.place === 1 && <Crown size={16} aria-label="Первое место"/>}{entry.name}</li>
        ))}</ol>
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Места и очки">
          <table><thead><tr><th scope="col">Место</th><th scope="col">Стажёр</th><th scope="col">Очки</th></tr></thead>
            <tbody>{entries.map(entry => <tr key={entry.intern_id}>
              <td><span className={`score-place place-${entry.place}`}>{entry.place}</span></td><th scope="row">{entry.name}</th><td>{entry.points}</td>
            </tr>)}</tbody>
          </table>
        </div>
      </>}
  </section>;
}

export function TaskStepper({ id }: { id: string }) {
  const load = useCallback((signal: AbortSignal) => getTaskStage(id, signal), [id]);
  const { items: stage, error, retry } = useResource(load);
  if (error) return <p role="alert">{error} <button className="secondary-button" onClick={retry}>Повторить загрузку этапов</button></p>;
  if (!stage) return <p role="status">Загружаем этапы…</p>;
  const steps = Object.entries(stageLabels);
  const current = steps.findIndex(([key]) => key === stage);
  return <ol className="task-stepper" aria-label="Этапы задачи">{steps.map(([key, label], index) => (
    <li key={key} data-complete={index < current} aria-current={index === current ? 'step' : undefined}>
      {index < current && <><Check size={14} aria-hidden="true"/><span className="sr-only">Пройдено · </span></>}{label}
    </li>
  ))}</ol>;
}

export function InternMetrics({ id }: { id: string }) {
  const load = useCallback((signal: AbortSignal) => getMetrics(id, signal), [id]);
  const { items, error, retry } = useResource(load);
  if (error) return <p role="alert">{error} <button className="secondary-button" onClick={retry}>Повторить загрузку метрик</button></p>;
  if (!items) return <p role="status">Загружаем метрики…</p>;
  if (!items.length) return <p>Метрик пока нет.</p>;
  return <div className="table-wrap" tabIndex={0} role="region" aria-label="Среднее время по этапам">
    <table><thead><tr><th scope="col">Этап</th><th scope="col">Среднее</th><th scope="col">Норма</th><th scope="col">Отклонение</th></tr></thead>
      <tbody>{items.map(item => <tr key={item.stage}>
        <th scope="row">{stageLabels[item.stage]}</th><td>{item.avg_hours} ч</td><td>{item.baseline_hours} ч</td>
        <td className={item.deviation_percent > 0 ? 'deviation-over' : item.deviation_percent < 0 ? 'deviation-under' : undefined}>
          {item.deviation_percent > 0 ? '+' : ''}{item.deviation_percent}%
        </td>
      </tr>)}</tbody>
    </table>
  </div>;
}

export function FlagBadge({ flag, onResolved }: { flag: StuckFlag; onResolved?: (id: string) => void }) {
  const running = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function resolve() {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError('');
    try {
      await resolveFlag(flag.id);
      onResolved?.(flag.id);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Не удалось снять флаг.');
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  return <details className="flag-details">
    <summary className="status-pill blocked"><AlertTriangle size={14} aria-hidden="true"/>Застрял · {flag.task_id}<ChevronDown size={15} aria-hidden="true"/></summary>
    <p>{flag.reason}</p>
    {onResolved && <button className="secondary-button" onClick={resolve} disabled={busy}>{busy ? 'Снимаем флаг…' : 'Пометить решённым'}</button>}
    {error && <p className="error-note" role="alert">{error}</p>}
  </details>;
}
