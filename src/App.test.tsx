import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { STORAGE_KEY, initialState, reducer } from './model';

beforeEach(() => vi.useFakeTimers());
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));
const tick = async (ms = 1000) => { await act(async () => { vi.advanceTimersByTime(ms); }); };
async function requestAccess() { click('Доступ к Jira'); await tick(); }
function close() { click('Закрыть окно'); }
describe('interactive demo', () => {
  it('runs request, edit, confirmation, approval, knowledge and level-up end to end', async () => {
    const mounted = render(<App/>);
    expect(screen.getByRole('heading', {name:'Первая неделя'})).toBeInTheDocument();
    expect(screen.getByRole('button', {name:'Отправить сообщение'})).toBeDisabled();
    click('Попросить Бадди помочь');
    expect(screen.getByText('Бадди думает')).toBeInTheDocument();
    await tick();
    click('Изменить данные');
    fireEvent.change(screen.getByLabelText('Зачем нужен доступ'), {target:{value:'  '}});
    expect(screen.getByRole('button', {name:/Сохранить изменения/})).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Зачем нужен доступ'), {target:{value:'Первая задача DEMO-8'}});
    click(/Сохранить изменения/);
    expect(screen.getByText('Первая задача DEMO-8')).toBeInTheDocument();
    click('Отправить заявку');
    expect(screen.getByRole('button',{name:'Отправляем…'})).toBeDisabled();
    await tick();
    expect(screen.getByText('REQ-042')).toBeInTheDocument();
    expect(screen.getByText('Ожидает согласования')).toBeInTheDocument();
    expect(screen.getByText('240 / 400 XP')).toBeInTheDocument();
    click('Посмотреть заявку'); await tick();
    expect(screen.getByText(/повторная заявка не нужна/)).toBeInTheDocument();
    click('Согласовать в демо');
    expect(screen.getByText('Доступ выдан · +120 XP')).toBeInTheDocument();
    expect(screen.getByText('360 / 400 XP')).toBeInTheDocument();
    mounted.unmount(); render(<App/>);
    expect(screen.getByText('Доступ выдан · +120 XP')).toBeInTheDocument();
    click(/КВЕСТ 03 Знания команды/); click('Читать инструкцию');
    click('Прочитал, всё понятно · +100 XP');
    expect(screen.getByText('460 / 600 XP')).toBeInTheDocument();
    expect(screen.getByText('Новый уровень 3! Отличная работа, Роман.')).toBeInTheDocument();
    click('Читать инструкцию'); expect(screen.getByRole('button',{name:'Уже прочитано'})).toBeDisabled(); close();
    await tick(4500); expect(screen.queryByText('Новый уровень 3! Отличная работа, Роман.')).not.toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).completed).toEqual(['team','access','guide']);
  });
  it('can simulate a failure without losing data and then retry', async () => {
    render(<App/>); click('Демо-мир');
    fireEvent.click(screen.getByRole('checkbox'));
    click('Начать демосценарий'); await tick();
    click('Отправить заявку'); await tick();
    expect(screen.getByRole('alert')).toHaveTextContent('Сервис недоступен');
    expect(screen.queryByText('REQ-042')).not.toBeInTheDocument();
    click('Отправить заявку'); await tick();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('REQ-042')).toBeInTheDocument();
  });
  it('handles typed messages, sources, no-answer and restricted requests', async () => {
    render(<App/>);
    const input = screen.getByLabelText('Сообщение Бадди');
    fireEvent.change(input, {target:{value:'Как работает команда?'}});
    fireEvent.keyDown(input, {key:'Enter',shiftKey:true});
    expect(input).toHaveValue('Как работает команда?');
    fireEvent.keyDown(input, {key:'Enter'}); await tick();
    click(/Команда Backend · тестовая инструкция/);
    expect(screen.getByRole('dialog')).toHaveTextContent('Тестовая инструкция · не регламент Авито'); close();
    fireEvent.change(input,{target:{value:'Хочу узнать пароль коллеги'}});click('Отправить сообщение');await tick();
    expect(screen.getByText(/Эти сведения недоступны/)).toBeInTheDocument();
    fireEvent.change(input,{target:{value:'Как вырастить кактус?'}});click('Отправить сообщение');await tick();
    expect(screen.getByText(/В демобазе пока нет ответа/)).toBeInTheDocument();
    click('Что дальше?'); await tick();
    expect(screen.getByText(/Предлагаю получить доступ/)).toBeInTheDocument();
  });
  it('opens every room destination and restores focus after dialogs', () => {
    render(<App/>);
    click('Библиотека ↗');
    click(/Как получить доступ к инструментам/);
    expect(screen.getByRole('dialog')).toHaveTextContent('Созданная заявка ещё не означает');close();
    click('Библиотека ↗'); click(/Как работает наша команда/); close();
    click('Экватор'); expect(screen.getByRole('dialog')).toHaveTextContent('прохождение босса не реализовано');close();
    click(/ВПЕРЕДИ Босс: Экватор/); close();
    click('О нашей демокоманде'); click('Открыть инструкцию команды');close();
    click(/КВЕСТ 01 Знакомство с командой/); click('Открыть команду');close();
    click('Мои квесты ↗'); expect(screen.getByRole('status')).toHaveTextContent('Выбери квест');click('Скрыть уведомление');
    click('Как работает демо'); fireEvent(screen.getByRole('dialog'), new Event('cancel', { bubbles: false }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    click('Демо-мир'); fireEvent.click(screen.getByRole('dialog'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  it('resets only after explicit choice and cancels pending work', async () => {
    render(<App/>); await requestAccess();
    click('Начать демо заново'); click('Продолжить приключение'); expect(screen.getByText('ЧЕРНОВИК ЗАЯВКИ')).toBeInTheDocument();
    click('Доступ к Jira'); click('Начать демо заново'); click('Начать заново');await tick();
    expect(screen.queryByText('ЧЕРНОВИК ЗАЯВКИ')).not.toBeInTheDocument();
    expect(screen.getByText('Демо начато заново')).toBeInTheDocument();
    expect(within(screen.getByRole('log')).getAllByText('БАДДИ')).toHaveLength(2);
  });
  it('renders mobile navigation, brand home and storage warning', () => {
    vi.spyOn(Storage.prototype,'setItem').mockImplementation(() => { throw Error('full'); });
    render(<App/>);
    expect(screen.getByText(/не сохранён: хранилище недоступно/)).toBeInTheDocument();
    click('Квесты'); expect(document.querySelector('main')).toHaveClass('mobile-quests');
    click('Бадди'); expect(document.querySelector('main')).toHaveClass('mobile-chat');
    click('Комната'); expect(document.querySelector('main')).toHaveClass('mobile-room');
    fireEvent.click(screen.getByRole('link',{name:'Avito Start — комната Бадди'}));
    expect(screen.getByRole('heading',{name:'Получить доступ к Jira'})).toBeInTheDocument();
  });
  it('can continue a persisted request, without duplicate rewards', async () => {
    let state = reducer(initialState(),{type:'reply',text:'доступ'});
    state = reducer(state,{type:'submit'});
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    render(<App/>); expect(screen.getByText('Ожидает согласования')).toBeInTheDocument();
    click('Согласовать в демо'); await requestAccess();
    expect(screen.getByText(/Доступ уже выдан в демосервисе/)).toBeInTheDocument();
    expect(screen.queryByRole('button',{name:'Согласовать в демо'})).not.toBeInTheDocument();
  });
});
