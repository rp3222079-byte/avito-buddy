import scoreboard from '../data/mock_scoreboard.json';
import flags from '../data/mock_flags.json';
import jira from '../data/mock_jira.json';
import metrics from '../data/mock_ai_metrics_response.json';
import { demoIdentities, mockMode, request } from './api';

export const stageLabels = {
  NOT_STARTED: 'Не начато',
  IN_PROGRESS: 'В работе',
  ALMOST_DONE: 'Почти готово',
  DONE: 'Готово',
};
export type Stage = keyof typeof stageLabels;
export function isStage(value: unknown): value is Stage {
  return typeof value === 'string' && Object.hasOwn(stageLabels, value);
}

type Scoreboard = typeof scoreboard;
export type StuckFlag = Pick<(typeof flags.flags)[number], 'id' | 'intern_id' | 'task_id' | 'reason' | 'severity'> & { resolved_at: string | null };
export type StageMetric = (typeof metrics.stages)[number] & { stage: Stage };

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object';
}

function isScoreEntry(value: unknown): value is Scoreboard['entries'][number] {
  return object(value) && typeof value.intern_id === 'string' && typeof value.name === 'string'
    && Number.isFinite(value.place) && Number.isFinite(value.points) && typeof value.is_top5 === 'boolean';
}

function isFlag(value: unknown): value is StuckFlag {
  return object(value) && typeof value.id === 'string' && typeof value.intern_id === 'string'
    && typeof value.task_id === 'string' && typeof value.reason === 'string'
    && (value.severity === 'high' || value.severity === 'medium')
    && (value.resolved_at === null || typeof value.resolved_at === 'string');
}

function isMetric(value: unknown): value is StageMetric {
  return object(value) && isStage(value.stage) && Number.isFinite(value.avg_hours)
    && Number.isFinite(value.baseline_hours) && Number.isFinite(value.deviation_percent);
}

export async function getScoreboard(signal: AbortSignal): Promise<Scoreboard> {
  if (mockMode) return scoreboard;
  const result = await request('/scoreboard', signal);
  if (object(result) && typeof result.week === 'string' && Array.isArray(result.entries) && result.entries.every(isScoreEntry)) {
    return { week: result.week, entries: result.entries };
  }
  throw new Error('Сервис вернул некорректный рейтинг.');
}

export async function syncJira(signal: AbortSignal) {
  let updated: number | undefined;
  if (!mockMode) {
    const response = await request('/sync/jira', signal, { method: 'POST' });
    if (!object(response) || response.status !== 'success' || typeof response.updated !== 'number') throw new Error('Не удалось обновить данные Jira.');
    updated = response.updated;
  }
  return { scoreboard: await getScoreboard(signal), updated };
}

export async function getFlags(signal: AbortSignal): Promise<StuckFlag[]> {
  if (mockMode) return flags.flags;
  const result = await request(`/flags?mentor_id=${encodeURIComponent(demoIdentities.mentor)}`, signal);
  if (object(result) && Array.isArray(result.flags) && result.flags.every(isFlag)) return result.flags;
  throw new Error('Сервис вернул некорректные флаги.');
}

export async function resolveFlag(id: string) {
  if (!mockMode) {
    const result = await request(`/flags/${encodeURIComponent(id)}/resolve`, undefined, { method: 'PATCH' });
    if (!object(result) || result.status !== 'success') throw new Error('Не удалось снять флаг.');
  }
}

export async function getTaskStage(id: string, signal: AbortSignal): Promise<Stage> {
  const stage = mockMode
    ? jira.tasks.find(task => task.id === id)?.transitions.at(-1)?.stage
    : await request(`/tasks/${encodeURIComponent(id)}/stages`, signal).then(result => object(result) ? result.current_stage : undefined);
  if (isStage(stage)) return stage;
  throw new Error('Текущий этап задачи недоступен.');
}

export async function getMetrics(id: string, signal: AbortSignal): Promise<StageMetric[]> {
  const result = mockMode ? metrics : await request(`/interns/${encodeURIComponent(id)}/metrics`, signal);
  if (object(result) && Array.isArray(result.stages) && result.stages.every(isMetric)) return result.stages;
  throw new Error('Сервис вернул некорректные метрики.');
}
