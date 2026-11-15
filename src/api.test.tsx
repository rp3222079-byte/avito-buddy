import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

function browserRequests(handle: (path: string, options: RequestInit) => Response | Promise<Response> | undefined) {
  return vi.fn(async (path: string, options: RequestInit) => {
    const result = await handle(path, options);
    if (result) return result;
    if (path === '/api/session') {
      return options.method === 'DELETE' ? new Response(null, { status: 204 })
        : Response.json(JSON.parse(String(options.body)), { status: 201 });
    }
    if (path === '/scoreboard') return Response.json({ week: '2026-W46', entries: [] });
    if (path.startsWith('/flags?')) return Response.json({ flags: [] });
    throw new Error(`Unexpected path ${path}`);
  });
}

it('loads server tasks, displays a server 403 and retries the mentor list', async () => {
  vi.stubEnv('VITE_API_MODE', 'real');
  let mentorCalls = 0;
  const request = browserRequests(path => {
    if (path === '/api/jira/tasks') return Response.json({ tasks: [{ id: 'AVT-1', title: 'Подготовить релиз', status: 'To Do', priority: 'High' }] });
    if (path === '/api/mentor/interns') return mentorCalls++ ? Response.json({ interns: [] }) : new Response(null, { status: 403 });
  });
  vi.stubGlobal('fetch', request);
  const { default: App } = await import('./App');
  render(<App/>);
  fireEvent.click(await screen.findByRole('button', { name: 'Мои задачи' }));
  expect(await screen.findByText(/AVT-1/)).toBeInTheDocument();
  expect(request).toHaveBeenCalledWith('/api/jira/tasks', expect.objectContaining({ credentials: 'same-origin' }));
  const internSession = request.mock.calls.findIndex(([path]) => path === '/api/session');
  const taskRequest = request.mock.calls.findIndex(([path]) => path === '/api/jira/tasks');
  expect(internSession).toBeLessThan(taskRequest);
  expect(JSON.parse(String(request.mock.calls[internSession][1].body))).toEqual({ role: 'intern', user_id: 'intern_ivan' });
  fireEvent.click(screen.getByRole('button', { name: 'Наставник' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('403');
  fireEvent.click(screen.getByRole('button', { name: 'Повторить загрузку' }));
  expect(await screen.findByText('Список стажёров пуст.')).toBeInTheDocument();
  expect(request).toHaveBeenLastCalledWith('/api/mentor/interns', expect.objectContaining({ credentials: 'same-origin' }));
  expect(request).toHaveBeenCalledWith('/api/session', expect.objectContaining({ method: 'DELETE' }));
  expect(request).toHaveBeenCalledWith('/api/session', expect.objectContaining({ body: '{"role":"mentor","user_id":"mentor_smith"}' }));
});

function sse(chunks: string[]) {
  const bytes = new TextEncoder().encode(chunks.join(''));
  // Split inside UTF-8 characters, CRLF pairs and JSON tokens.
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      for (let index = 0; index < bytes.length; index += 3) controller.enqueue(bytes.slice(index, index + 3));
      controller.close();
    },
  }), { headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } });
}

it('reads SSE over POST and confirms actions only after backend success', async () => {
  vi.resetModules();
  vi.stubEnv('VITE_API_MODE', 'real');
  vi.stubEnv('VITE_CHAT_PATH', '/api/test-chat');
  const actions = [
    { type: 'button', id: 'notify_mentor', label: 'Напомнить', data: { message: 'Проверь задачу AVT-1' } },
    { type: 'button', id: 'create_access_ticket', label: 'Создать заявку', data: { system: 'Confluence' } },
  ];
  let chatCalls = 0;
  let notificationCalls = 0;
  const request = browserRequests((path, options) => {
    if (path === '/api/jira/tasks') return Response.json({ tasks: [] });
    if (path === '/api/test-chat') return !chatCalls++ ? sse(['event: token\ndata: {"text":"Нужен "}\n\n']) : sse([
      ': heartbeat\r\n\r\n',
      'event: token\r\ndata: {"text":"Проверим "}\r\n\r\n',
      'event: token\ndata: {"text":"доступ."}\n\n',
      `event: done\ndata: {"sources": [{"source":"access_guide.md"}],\ndata: "actions": ${JSON.stringify(actions)}}\n\n`,
    ]);
    if (!path.startsWith('/api/pending-action')) return;
    const body = JSON.parse(String(options.body));
    if (path === '/api/pending-action') return Response.json({ status: 'pending', pending_id: body.action }, { status: 201 });
    if (path === '/api/pending-action/confirm' && body.pending_id === 'notify_mentor') {
      return notificationCalls++ ? Response.json({ status: 'sent' }) : new Response(null, { status: 503 });
    }
    if (path === '/api/pending-action/confirm') return Response.json({ request_id: 'IT-123', status: 'created', sla_hours: 2 }, { status: 201 });
    throw new Error(`Unexpected path ${path}`);
  });
  vi.stubGlobal('fetch', request);
  const { default: App } = await import('./App');
  render(<App/>);
  await screen.findByRole('button', { name: 'Утренний брифинг' });
  fireEvent.change(screen.getByLabelText('Сообщение Бадди'), { target: { value: 'Нужен доступ к Confluence' } });
  fireEvent.click(screen.getByRole('button', { name: 'Отправить сообщение' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Поток ответа прервался');
  fireEvent.click(screen.getByRole('button', { name: 'Повторить отправку' }));
  expect(await screen.findByText('Проверим доступ.')).toBeInTheDocument();
  expect(screen.getAllByText('Нужен доступ к Confluence')).toHaveLength(1);
  expect(screen.getByText('Источник · access_guide.md')).toBeInTheDocument();
  const chatRequests = request.mock.calls.filter(([path]) => path === '/api/test-chat');
  expect(chatRequests[0][1]).toMatchObject({
    method: 'POST', headers: { Accept: 'text/event-stream' }, body: '{"message":"Нужен доступ к Confluence"}',
  });
  expect(new Headers(chatRequests[0][1].headers).get('Idempotency-Key')).toBe(new Headers(chatRequests[1][1].headers).get('Idempotency-Key'));

  fireEvent.click(screen.getByRole('button', { name: 'Напомнить' }));
  expect(await screen.findByText('Проверь задачу AVT-1')).toBeInTheDocument();
  expect(notificationCalls).toBe(0);
  fireEvent.click(screen.getByRole('button', { name: 'Подтвердить' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось отправить напоминание');
  expect(screen.queryByText('Напоминание отправлено.')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Подтвердить' }));
  expect(await screen.findByText('Напоминание отправлено.')).toBeInTheDocument();
  expect(request).toHaveBeenCalledWith('/api/pending-action', expect.objectContaining({
    method: 'POST', body: '{"action":"notify_mentor","payload":{"message":"Проверь задачу AVT-1"}}',
  }));

  fireEvent.click(screen.getByRole('button', { name: 'Создать заявку · Confluence' }));
  await screen.findByRole('heading', { name: 'Черновик · доступ к Confluence' });
  expect(screen.queryByRole('heading', { name: 'Заявка IT-123' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Подтвердить' }));
  expect(await screen.findByRole('heading', { name: 'Заявка IT-123' })).toBeInTheDocument();
  expect(screen.getByText('Статус · Заявка создана')).toBeVisible();
  expect(screen.getByText('Срок обработки · 2 ч')).toBeInTheDocument();
  expect(request).toHaveBeenLastCalledWith('/api/pending-action/confirm', expect.objectContaining({
    method: 'POST', body: '{"pending_id":"create_access_ticket"}',
  }));
});

it('retries a failed session and cancels an existing pending action without confirming it', async () => {
  vi.resetModules();
  vi.stubEnv('VITE_API_MODE', 'real');
  let attempts = 0;
  const request = browserRequests((path, options) => {
    if (path === '/api/session' && !attempts++) return new Response(null, { status: 503 });
    if (path === '/api/jira/tasks') return Response.json({ tasks: [] });
    if (path === '/api/chat/stream') return sse([
      'event: done\ndata: {"actions":[{"type":"pending_action","data":{"pending_id":"existing","action":"create_access_ticket","payload":{"system":"jira"}}}]}\n\n',
    ]);
    if (path === '/api/pending-action/cancel') {
      expect(options.body).toBe('{"pending_id":"existing"}');
      return new Response(null, { status: 204 });
    }
    if (path === '/api/pending-action') return Response.json({ pending_id: 'new-draft', status: 'pending' }, { status: 201 });
  });
  vi.stubGlobal('fetch', request);
  const { default: App } = await import('./App');
  render(<App/>);
  expect(await screen.findByRole('alert')).toHaveTextContent('Сервис временно недоступен');
  expect(request.mock.calls.some(([path]) => path === '/api/jira/tasks')).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Повторить вход' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Утренний брифинг' }));
  await screen.findByRole('heading', { name: 'Черновик · доступ к Jira' });
  fireEvent.click(screen.getByRole('button', { name: 'Отменить' }));
  expect(await screen.findByText('Черновик отменён.')).toBeInTheDocument();
  expect(request.mock.calls.filter(([path]) => path.startsWith('/api/pending-action')).map(([path]) => path))
    .toEqual(['/api/pending-action/cancel']);
  const prepare = screen.getByRole('button', { name: 'Подготовить новый черновик' });
  expect(prepare).toHaveFocus();
  fireEvent.click(prepare);
  expect(await screen.findByRole('heading', { name: 'Черновик · доступ к Jira' })).toBeVisible();
});

it('refreshes the scoreboard, opens stages and metrics, and resolves STUCK locally', async () => {
  vi.resetModules();
  vi.stubEnv('VITE_API_MODE', 'real');
  let finishSync!: (response: Response) => void;
  const sync = new Promise<Response>(resolve => { finishSync = resolve; });
  const scoreEntry = { place: 1, name: 'Иван Иванов', intern_id: 'intern_ivan', is_top5: true };
  const flag = { id: 'f-001', intern_id: 'intern_ivan', task_id: 'AVT-555', severity: 'high', resolved_at: null, reason: 'Задача без движения' };
  let scores = 0;
  let syncCalls = 0;
  let resolveCalls = 0;
  const request = browserRequests(path => {
    if (path === '/scoreboard') return Response.json({ week: '2026-W46', entries: [{ ...scoreEntry, points: ++scores * 10 }] });
    if (path === '/sync/jira') return syncCalls++ ? sync : new Response(null, { status: 503 });
    if (path.startsWith('/flags?')) return Response.json({ flags: [flag] });
    if (path === '/flags/f-001/resolve') return resolveCalls++ ? Response.json({ status: 'success' }) : new Response(null, { status: 503 });
    if (path === '/api/jira/tasks') return Response.json({ tasks: [{ id: 'AVT-555', title: 'Задача', priority: 'Blocker', status: 'In Progress' }] });
    if (path === '/tasks/AVT-555/stages') return Response.json({ current_stage: 'IN_PROGRESS' });
    if (path === '/api/mentor/interns') return Response.json({ interns: [{ name: 'Иван Иванов', intern_id: 'intern_ivan', progress_percent: 50, status: 'blocked', blockers: [flag.reason] }] });
    if (path === '/interns/intern_ivan/metrics') return Response.json({ stages: [
      { stage: 'IN_PROGRESS', avg_hours: 2.5, baseline_hours: 2, deviation_percent: 25 },
      { stage: 'ALMOST_DONE', avg_hours: 1, baseline_hours: 2, deviation_percent: -50 },
    ] });
  });
  vi.stubGlobal('fetch', request);
  const { default: App } = await import('./App');
  render(<App/>);
  expect(await screen.findByRole('img', { name: 'Входит в топ-5' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Мои задачи' }));
  await screen.findByText('Застрял · AVT-555');
  fireEvent.click(screen.getByRole('button', { name: /AVT-555.*Задача/ }));
  expect(await screen.findByText('В работе', { selector: 'li' })).toHaveAttribute('aria-current', 'step');
  fireEvent.click(screen.getByRole('button', { name: 'Наставник' }));
  const scoreboard = within(await screen.findByRole('region', { name: 'Рейтинг стажёров' }));
  const filter = await screen.findByRole('checkbox', { name: 'Только с флагами' });
  fireEvent.click(filter);
  expect(scoreboard.getByText('10')).toBeInTheDocument();
  fireEvent.click(scoreboard.getByRole('button', { name: 'Обновить из Jira' }));
  expect(await scoreboard.findByRole('alert')).toHaveTextContent('Рейтинг не обновился');
  expect(scoreboard.getByText('10')).toBeVisible();
  fireEvent.click(scoreboard.getByRole('button', { name: 'Обновить из Jira' }));
  expect(scoreboard.getByRole('button', { name: 'Обновляем…' })).toBeDisabled();
  finishSync(Response.json({ status: 'success', updated: 4 }));
  expect(await scoreboard.findByText(/Задач обработано при демо-синхронизации: 4/)).toBeInTheDocument();
  expect(filter).toBeChecked();
  expect(scoreboard.getByText('20')).toBeInTheDocument();

  const metrics = await screen.findByRole('button', { name: 'Среднее время' });
  fireEvent.click(metrics);
  expect(metrics.closest('tr')?.nextElementSibling).toHaveTextContent('За всё время');
  expect(screen.getByText('За всё время')).toBeVisible();
  expect(await screen.findByText('+25%')).toHaveClass('deviation-over');
  expect(screen.getByText('-50%')).toHaveClass('deviation-under');
  const stages = screen.getByRole('button', { name: 'Этапы AVT-555' });
  fireEvent.click(stages);
  expect(await within(stages.closest('td')!).findByText('В работе')).toHaveAttribute('aria-current', 'step');
  fireEvent.click(screen.getByText('Застрял · AVT-555'));
  expect(screen.getByText(flag.reason)).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Пометить решённым' }));
  expect(await screen.findByRole('alert')).toBeInTheDocument();
  expect(screen.getByText('Застрял · AVT-555')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Пометить решённым' }));
  expect(await screen.findByText('Нет стажёров с активными флагами.')).toBeInTheDocument();
  expect(filter).toHaveFocus();
  expect(request).toHaveBeenCalledWith('/flags/f-001/resolve', expect.objectContaining({ method: 'PATCH' }));
});
