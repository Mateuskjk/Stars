import { TestBed } from '@angular/core/testing';
import { AccountStore, greetingFor, hourIn } from './account-store';

describe('AccountStore', () => {
  beforeEach(() => localStorage.clear());

  it('picks the name to show: display name, then first name, then "Usuário"', () => {
    const store = TestBed.inject(AccountStore);
    expect(store.name()).toBe('Usuário');
    store.update({ fullName: 'Mateus Silva' });
    expect(store.name()).toBe('Mateus');
    expect(store.initials()).toBe('MS');
    store.update({ displayName: 'Teus' });
    expect(store.name()).toBe('Teus');
  });

  it('saves to localStorage and merges new defaults when loading an older save', () => {
    localStorage.setItem('stars.account', JSON.stringify({ fullName: 'Ana', notifications: { enabled: false, types: { daily: false } } }));
    const store = TestBed.inject(AccountStore);
    store.load();
    expect(store.account().notifications).toEqual({ enabled: false, sound: true, types: { daily: false, planning: true, mentions: true, system: true } });
    expect(store.account().assistantEnabled).toBe(true);

    store.updateNotifications({ sound: false });
    expect(JSON.parse(localStorage.getItem('stars.account')!).notifications.sound).toBe(false);
  });

  it('greets by the hour in the chosen time zone', () => {
    const noonUtc = new Date('2026-10-08T12:00:00Z');
    expect(hourIn('UTC', noonUtc)).toBe(12);
    expect(hourIn('Asia/Tokyo', noonUtc)).toBe(21);
    expect(greetingFor(hourIn('America/Sao_Paulo', noonUtc))).toBe('Bom dia'); // 09h em São Paulo
    expect(greetingFor(hourIn('Asia/Tokyo', noonUtc))).toBe('Boa noite');
  });
});
