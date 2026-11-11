import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

it('loads server tasks, displays a server 403 and retries the mentor list', async () => {
  vi.stubEnv('VITE_API_MODE', 'real');
  const request = vi.fn()
    .mockResolvedValueOnce(Response.json({ tasks: [{ id: 'AVT-1', title: 'Подготовить релиз', status: 'To Do', priority: 'High' }] }))
    .mockResolvedValueOnce(new Response(null, { status: 403 }))
    .mockResolvedValueOnce(Response.json({ interns: [] }));
  vi.stubGlobal('fetch', request);
  const { default: App } = await import('./App');
  render(<App/>);
  expect(await screen.findByText(/AVT-1/)).toBeInTheDocument();
  expect(request).toHaveBeenCalledWith('/api/jira/tasks', expect.objectContaining({ credentials: 'same-origin' }));
  fireEvent.click(screen.getByRole('button', { name: 'Наставник' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('403');
  fireEvent.click(screen.getByRole('button', { name: 'Повторить загрузку' }));
  expect(await screen.findByText('Список стажёров пуст.')).toBeInTheDocument();
  expect(request).toHaveBeenLastCalledWith('/api/mentor/interns', expect.objectContaining({ credentials: 'same-origin' }));
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
  const request = vi.fn()
    .mockResolvedValueOnce(Response.json({ tasks: [] }))
    .mockResolvedValueOnce(sse(['event: delta\ndata: {"text":"Нужен "}\n\n']))
    .mockResolvedValueOnce(sse([
      ': heartbeat\r\n\r\n',
      'event: delta\r\ndata: {"text":"Проверим "}\r\n\r\n',
      'event: delta\ndata: {"text":"доступ."}\n\n',
      `event: done\ndata: {"sources": [{"source":"access_guide.md"}],\ndata: "actions": ${JSON.stringify(actions)}}\n\n`,
    ]))
    .mockResolvedValueOnce(new Response(null, { status: 503 }))
    .mockResolvedValueOnce(new Response(null, { status: 204 }))
    .mockResolvedValueOnce(Response.json({ ticket_id: 'IT-123', status: 'created', sla_hours: 2 }, { status: 201 }));
  vi.stubGlobal('fetch', request);
  const { default: App } = await import('./App');
  render(<App/>);
  await screen.findByText('У тебя нет активных задач.');
  fireEvent.change(screen.getByLabelText('Сообщение Бадди'), { target: { value: 'Нужен доступ к Confluence' } });
  fireEvent.click(screen.getByRole('button', { name: 'Отправить сообщение' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Поток ответа прервался');
  fireEvent.click(screen.getByRole('button', { name: 'Повторить отправку' }));
  expect(await screen.findByText('Проверим доступ.')).toBeInTheDocument();
  expect(screen.getAllByText('Нужен доступ к Confluence')).toHaveLength(1);
  expect(screen.getByText('Источник · access_guide.md')).toBeInTheDocument();
  expect(request.mock.calls[1][0]).toBe('/api/test-chat');
  expect(request.mock.calls[1][1]).toMatchObject({
    method: 'POST', headers: { Accept: 'text/event-stream' }, body: '{"message":"Нужен доступ к Confluence"}',
  });
  expect(request.mock.calls[1][1].headers['Idempotency-Key']).toBe(request.mock.calls[2][1].headers['Idempotency-Key']);

  fireEvent.click(screen.getByRole('button', { name: 'Напомнить' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось отправить напоминание');
  expect(screen.queryByText('Напоминание отправлено.')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Напомнить' }));
  expect(await screen.findByText('Напоминание отправлено.')).toBeInTheDocument();
  expect(request.mock.calls[4][0]).toBe('/api/notify-mentor');
  expect(request.mock.calls[4][1]).toMatchObject({ method: 'POST', body: '{"message":"Проверь задачу AVT-1"}' });
  expect(request.mock.calls[3][1].headers['Idempotency-Key']).toBe(request.mock.calls[4][1].headers['Idempotency-Key']);

  fireEvent.click(screen.getByRole('button', { name: 'Создать заявку · Confluence' }));
  expect(await screen.findByRole('heading', { name: 'Заявка IT-123' })).toBeInTheDocument();
  expect(screen.getByText('Срок обработки · 2 ч')).toBeInTheDocument();
  expect(request).toHaveBeenLastCalledWith('/api/jira/ticket', expect.objectContaining({
    method: 'POST', body: '{"system":"Confluence"}',
  }));
});
