import { describe, expect, it } from 'vitest';
import { getLevel, getXP, initialState, loadState, questStatus, reducer, saveState } from './model';
import type { DemoState } from './model';

const draft = () => reducer(initialState(), { type: 'reply', text: 'Нужен доступ к Jira' });
const pending = () => reducer(draft(), { type: 'submit' });
const approved = () => reducer(pending(), { type: 'approve' });
describe('the onboarding journey', () => {
  it('awards experience only on actual completion, once', () => {
    expect(getXP(initialState())).toBe(240);
    expect(getLevel(initialState())).toBe(2);
    expect(getXP(draft())).toBe(240);
    expect(getXP(pending())).toBe(240);
    expect(questStatus(pending(), 'access')).toBe('pending');
    const done = approved();
    expect(getXP(done)).toBe(360);
    expect(questStatus(done, 'access')).toBe('done');
    expect(reducer(done, { type: 'approve' })).toBe(done);
    const all = reducer(done, { type: 'read' });
    expect(getXP(all)).toBe(460); expect(getLevel(all)).toBe(3);
    expect(reducer(all, { type: 'read' })).toBe(all);
    expect(reducer(all, { type: 'reset' })).toEqual(initialState());
  });
  it('allows independent knowledge quest while access is pending', () => {
    expect(questStatus(initialState(), 'guide')).toBe('available');
    const next = reducer(pending(), { type: 'read' });
    expect(next.ticket?.status).toBe('pending');
    expect(next.completed).toEqual(['team', 'guide']);
    expect(getXP(next)).toBe(340);
  });
  it('does not create duplicate requests from repeated questions or submits', () => {
    for (const state of [draft(), pending(), approved()]) {
      const next = reducer(state, { type: 'reply', text: 'Какой статус заявки?' });
      expect(next.ticket).toEqual(state.ticket);
      expect(next.messages.filter(m => m.kind === 'request')).toHaveLength(1);
    }
    expect(reducer(pending(), { type: 'submit' }).ticket?.status).toBe('pending');
    const s = initialState(); expect(reducer(s, { type: 'submit' })).toBe(s); expect(reducer(s, { type: 'approve' })).toBe(s);
  });
  it('preserves draft on service failure and allows retry', () => {
    const s = reducer(draft(), { type: 'edit', resource: 'Jira', reason: '  Нужен для задачи DEMO-7  ' });
    const failed = reducer(s, { type: 'submit', fail: true });
    expect(failed.ticket?.reason).toBe('Нужен для задачи DEMO-7');
    expect(failed.ticket?.status).toBe('draft'); expect(getXP(failed)).toBe(240);
    expect(reducer(failed, { type: 'submit' }).ticket?.id).toBe('REQ-042');
  });
  it('validates edits and keeps sent requests immutable', () => {
    const s = draft();
    for (const [resource, reason] of [['Jira',' '], ['Other','Valid reason'], ['Jira','a'.repeat(241)]]) expect(reducer(s, { type: 'edit', resource, reason })).toBe(s);
    const p = pending(); expect(reducer(p, { type: 'edit', resource: 'Jira', reason: 'New reason' })).toBe(p);
  });
  it('ignores empty input, limits user messages and trims history', () => {
    const s = initialState(); expect(reducer(s, { type: 'user', text: ' ' })).toBe(s);
    expect(reducer(s, { type: 'user', text: 'a'.repeat(600) }).messages.at(-1)?.text).toHaveLength(500);
    let next = s; for (let i=0;i<80;i++) next = reducer(next, { type: 'user', text: 'Привет' });
    expect(next.messages).toHaveLength(60);
    expect(new Set(next.messages.map(m => m.id)).size).toBe(60);
  });
  it('keeps the actionable ticket card in a long conversation', () => {
    let next = draft();
    for (let i=0;i<80;i++) next = reducer(next, {type:'user',text:'Ещё вопрос'});
    expect(next.messages).toHaveLength(60);
    expect(next.messages[0].kind).toBe('request');
    expect(new Set(next.messages.map(m => m.id)).size).toBe(60);
  });
  it.each([
    ['пароль коллеги','недоступны'], ['Расскажи про наставника','Анна'], ['Что делать дальше?','получить доступ'],
    ['Привет','Я рядом'], ['спасибо','Я рядом'], ['Босс Экватор','презентацию'], ['Что за квантовая физика?','нет ответа']
  ])('handles %s with grounded demo response', (text, expected) => {
    expect(reducer(initialState(), { type: 'reply', text }).messages.at(-1)?.text).toContain(expected);
  });
  it('adapts next steps to progress', () => {
    expect(reducer(pending(), { type: 'reply', text: 'Что дальше?' }).messages.at(-1)?.text).toContain('ждём');
    expect(reducer(approved(), { type: 'reply', text: 'Что дальше?' }).messages.at(-1)?.text).toContain('Доступ получен');
    expect(reducer(reducer(approved(), { type: 'read' }), { type: 'reply', text: 'Что дальше?' }).messages.at(-1)?.text).toContain('Все задачи');
  });
});
describe('local persistence', () => {
  const storage = (data: unknown) => ({ getItem: () => JSON.stringify(data) });
  it('restores valid draft, pending and completed state', () => {
    for (const s of [initialState(),draft(),pending(),approved()]) expect(loadState(storage(s))).toEqual(s);
    expect(saveState(pending())).toBe(true); expect(loadState()).toEqual(pending());
  });
  it('recovers from malformed storage and storage denial', () => {
    expect(loadState({ getItem: () => '{' })).toEqual(initialState());
    expect(loadState({ getItem: () => { throw Error(); } })).toEqual(initialState());
    expect(saveState(initialState(), { setItem: () => { throw Error(); } })).toBe(false);
    for (const data of [null, {}, {version:2}, {...initialState(), completed:['admin']}, {...initialState(), completed:['team','team']}, {...initialState(), messages:[{id:1,role:'system',text:'bad'}]}, {...initialState(), messages:[{id:1,role:'buddy',text:'ok',source:'unknown'}]}, {...initialState(), ticket:{id:'OTHER',resource:'Jira',reason:'x',status:'draft'}}, {...initialState(),completed:['team','access']}]) expect(loadState(storage(data))).toEqual(initialState());
  });
  it('resets an oversized transcript', () => {
    const s: DemoState = {...initialState(), messages:Array(61).fill({id:1,role:'buddy',text:'x'})};
    expect(loadState(storage(s))).toEqual(initialState());
  });
});
