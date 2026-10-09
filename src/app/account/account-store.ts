import { Injectable, computed, signal } from '@angular/core';

export type NotificationType = 'daily' | 'planning' | 'mentions' | 'system';

export const NOTIFICATION_TYPES: { id: NotificationType; label: string; description: string }[] = [
  { id: 'daily', label: 'Daily', description: 'Lembretes e resumos da daily' },
  { id: 'planning', label: 'Planning e sprints', description: 'Sprint criada, fechada ou atividades enviadas para você' },
  { id: 'mentions', label: 'Menções e conversas', description: 'Quando alguém fala com você ou te menciona' },
  { id: 'system', label: 'Avisos do sistema', description: 'Novidades e avisos importantes do LexÁgile' },
];

export interface Account {
  fullName: string;
  displayName: string; // como quer ser chamado (saudação)
  email: string;
  phone: string;
  jobTitle: string;
  bio: string;
  photo: string | null; // data URL já reduzida
  timeZone: string; // '' = fuso do navegador
  notifications: { enabled: boolean; sound: boolean; types: Record<NotificationType, boolean> };
  assistantEnabled: boolean;
  reduceMotion: boolean;
}

export const DEFAULT_ACCOUNT: Account = {
  fullName: '',
  displayName: '',
  email: '',
  phone: '',
  jobTitle: '',
  bio: '',
  photo: null,
  timeZone: '',
  notifications: { enabled: true, sound: true, types: { daily: true, planning: true, mentions: true, system: true } },
  assistantEnabled: true,
  reduceMotion: false,
};

const KEY = 'stars.account';

// Hora (0–23) num fuso específico
export function hourIn(timeZone: string, date = new Date()) {
  return Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone }).format(date));
}

export function greetingFor(hour: number) {
  if (hour >= 5 && hour < 12) return 'Bom dia';
  if (hour >= 12 && hour < 18) return 'Boa tarde';
  return 'Boa noite';
}

// Conta do usuário atual: perfil e preferências pessoais.
// ponytail: sem login, fica no localStorage deste navegador; com login, buscar/salvar no servidor por usuário
@Injectable({ providedIn: 'root' })
export class AccountStore {
  readonly account = signal<Account>(DEFAULT_ACCOUNT);
  private loaded = false;

  // Nome mostrado na saudação e usado como "quem fez" na auditoria
  readonly name = computed(() => {
    const { displayName, fullName } = this.account();
    return displayName.trim() || fullName.trim().split(' ')[0] || 'Usuário';
  });
  readonly fullName = computed(() => this.account().fullName.trim() || this.name());
  readonly initials = computed(() => {
    const words = this.fullName().split(' ').filter(Boolean);
    return (words.length > 1 ? words[0][0] + words.at(-1)![0] : this.fullName().slice(0, 2)).toUpperCase();
  });
  readonly timeZone = computed(() => this.account().timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone);

  // Chamado no navegador depois da primeira renderização (no SSR não existe localStorage)
  load() {
    if (this.loaded || typeof localStorage === 'undefined') return;
    this.loaded = true;
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null');
      if (saved && typeof saved === 'object') {
        // mescla com o padrão: campos novos ganham valor mesmo em contas salvas antes deles existirem
        this.account.set({
          ...DEFAULT_ACCOUNT,
          ...saved,
          notifications: {
            ...DEFAULT_ACCOUNT.notifications,
            ...saved.notifications,
            types: { ...DEFAULT_ACCOUNT.notifications.types, ...saved.notifications?.types },
          },
        });
      }
    } catch {
      // armazenamento bloqueado ou dado corrompido: fica com o padrão
    }
  }

  update(changes: Partial<Account>) {
    this.account.update((account) => ({ ...account, ...changes }));
    this.persist();
  }

  updateNotifications(changes: Partial<Account['notifications']>) {
    this.update({ notifications: { ...this.account().notifications, ...changes } });
  }

  reset() {
    this.account.set(DEFAULT_ACCOUNT);
    this.persist();
  }

  private persist() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.account()));
    } catch {
      // sem armazenamento: vale só nesta sessão
    }
  }
}
