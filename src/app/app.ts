import { Component, DestroyRef, afterNextRender, computed, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { Assistant } from './ai/assistant';
import { ApiSnapshot } from './api-docs/api-snapshot';
import { AccountStore, NotificationType, greetingFor, hourIn } from './account/account-store';
import { RecentsStore } from './home/recents-store';

type Menu = 'nav' | 'notifications' | 'user';

@Component({
  imports: [Assistant, RouterLink, RouterLinkActive, RouterOutlet],
  selector: 'app-root',
  templateUrl: './app.html',
  host: {
    '(document:click)': 'closeMenuOnOutsideClick($event)',
    '(document:keydown.escape)': 'openMenu.set(null)',
  },
})
export class App {
  protected readonly openMenu = signal<Menu | null>(null);
  protected readonly searchOpen = signal(false);
  // Conta do usuário (Minha conta): nome, foto, fuso e preferências valem para todo o app
  protected readonly account = inject(AccountStore);
  protected readonly notificationsEnabled = computed(() => this.account.account().notifications.enabled);
  protected readonly soundEnabled = computed(() => this.account.account().notifications.sound);
  protected readonly userName = this.account.name;

  // A saudação usa a hora no fuso escolhido na conta; "now" avança a cada minuto
  private readonly now = signal(new Date());
  protected readonly greeting = computed(() => greetingFor(hourIn(this.account.timeZone(), this.now())));

  constructor() {
    const destroyRef = inject(DestroyRef);
    const snapshot = inject(ApiSnapshot);
    afterNextRender(() => {
      this.account.load();
      this.recentsStore.load();
      snapshot.start(); // mantém a API pública com os dados atuais
      const id = setInterval(() => this.now.set(new Date()), 60_000);
      destroyRef.onDestroy(() => clearInterval(id));
    });
  }

  // ponytail: notificações fixas de exemplo; trocar por um service/API quando o backend existir
  private readonly allNotifications = signal<{ id: number; text: string; read: boolean; type: NotificationType }[]>([
    { id: 1, text: 'Bem-vindo ao Stars!', read: false, type: 'system' },
    { id: 2, text: 'Seu Daily de hoje está pronto.', read: false, type: 'daily' },
    { id: 3, text: 'Planning da semana atualizado.', read: true, type: 'planning' },
    { id: 4, text: 'Ana Souza mencionou você em Conversas.', read: false, type: 'mentions' },
  ]);
  // Só os tipos que a pessoa escolheu receber (e nada, se ela desligou as notificações)
  protected readonly notifications = computed(() => {
    const prefs = this.account.account().notifications;
    return prefs.enabled ? this.allNotifications().filter((n) => prefs.types[n.type]) : [];
  });
  // O que a pessoa realmente abriu (projetos, notas, cartões, conversas e dashboards)
  private readonly recentsStore = inject(RecentsStore);
  protected readonly recents = this.recentsStore.items;

  // Membros, equipes e perfis de empresa que a pessoa abriu
  protected readonly recentProfiles = this.recentsStore.profiles;

  protected readonly quickAccess = [
    {
      label: 'Daily',
      link: '/workspace/daily',
      icon: ['M8 2v4', 'M16 2v4', 'M3 10h18', 'M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z'],
    },
    {
      label: 'Backlog',
      link: '/workspace/backlog',
      icon: ['M8 6h13', 'M8 12h13', 'M8 18h13', 'M3 6h.01', 'M3 12h.01', 'M3 18h.01'],
    },
    {
      label: 'Projetos',
      link: '/projetos/visaoGeral',
      icon: ['M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2z'],
    },
    {
      label: 'Notas',
      link: '/workspace/notes',
      icon: ['M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z', 'M14 2v6h6', 'M16 13H8', 'M16 17H8'],
    },
    {
      label: 'Favoritos',
      link: '/workspace/favorites',
      icon: ['M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z'],
    },
  ];

  protected readonly hasUnread = computed(() => this.notifications().some((n) => !n.read));

  protected toggleMenu(menu: Menu) {
    this.openMenu.update((open) => (open === menu ? null : menu));
  }

  protected markAllAsRead() {
    this.allNotifications.update((list) => list.map((n) => ({ ...n, read: true })));
  }

  // No celular o menu do meio é um painel: fecha ao escolher uma página
  protected closeNavOnLinkClick(event: Event) {
    if ((event.target as Element).closest('a')) {
      this.openMenu.set(null);
    }
  }

  protected closeMenuOnOutsideClick(event: Event) {
    if (!(event.target as Element).closest('.nav-menu, .nav-toggle, .center-options')) {
      this.openMenu.set(null);
    }
  }
}
