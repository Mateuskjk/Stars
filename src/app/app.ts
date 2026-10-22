import { Component, DestroyRef, afterNextRender, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NgTemplateOutlet } from '@angular/common';
import { NavigationCancel, NavigationEnd, NavigationError, NavigationStart, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';
import { Assistant } from './ai/assistant';
import { Login } from './login/login';
import { Loader } from './loader/loader';
import { initials } from './format';
import { SessionStore } from './api/session';
import { CompanyStore } from './companies/company-store';
import { AccountStore, NotificationType } from './account/account-store';

type Menu = 'nav' | 'notifications';

const THEME_KEY = 'stars.theme';

@Component({
  imports: [Assistant, Login, NgTemplateOutlet, RouterLink, RouterLinkActive, RouterOutlet, Loader],
  selector: 'app-root',
  templateUrl: './app.html',
  host: {
    '(document:click)': 'closeMenuOnOutsideClick($event)',
    '(document:keydown.escape)': 'openMenu.set(null); companyMenu.set(false); userMenu.set(false)',
  },
})
export class App {
  protected readonly openMenu = signal<Menu | null>(null);
  // Lista de empresas do seletor da sidebar (à parte do openMenu: no celular a sidebar continua aberta)
  protected readonly companyMenu = signal(false);
  // Nome e iniciais na conta da sidebar: o de Minha conta; sem ele preenchido, o nome do login
  protected readonly userName = computed(() => (this.account.account().fullName.trim() || this.account.account().displayName.trim() || this.session.me()?.nome) ?? 'Usuário');
  protected readonly userInitials = computed(() => initials(this.userName()).toUpperCase());
  // Menu da conta, no rodapé da sidebar (também à parte do openMenu)
  protected readonly userMenu = signal(false);
  protected readonly searchOpen = signal(false);
  // Conta do usuário (Minha conta): nome, foto, fuso e preferências valem para todo o app
  protected readonly account = inject(AccountStore);
  protected readonly session = inject(SessionStore);
  protected readonly companyStore = inject(CompanyStore);
  protected readonly notificationsEnabled = computed(() => this.account.account().notifications.enabled);
  protected readonly soundEnabled = computed(() => this.account.account().notifications.sound);
  private readonly router = inject(Router);
  // Trocando de tela (carregando a página): mostra a animação sobre a área da página
  protected readonly navigating = toSignal(
    this.router.events.pipe(
      filter((e) => e instanceof NavigationStart || e instanceof NavigationEnd || e instanceof NavigationCancel || e instanceof NavigationError),
      map((e) => e instanceof NavigationStart),
    ),
    { initialValue: false },
  );

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      void this.session.check();
      this.account.load();
      this.loadTheme();
      destroyRef.onDestroy(kanbanPan());
    });
  }

  // ponytail: notificações fixas de exemplo; trocar por um service/API quando o backend existir
  private readonly allNotifications = signal<{ id: number; text: string; read: boolean; type: NotificationType }[]>([
    { id: 1, text: 'Bem-vindo ao LexÁgile!', read: false, type: 'system' },
    { id: 2, text: 'Seu Daily de hoje está pronto.', read: false, type: 'daily' },
    { id: 3, text: 'Planning da semana atualizado.', read: true, type: 'planning' },
    { id: 4, text: 'Ana Souza mencionou você num comentário.', read: false, type: 'mentions' },
  ]);
  // Só os tipos que a pessoa escolheu receber (e nada, se ela desligou as notificações)
  protected readonly notifications = computed(() => {
    const prefs = this.account.account().notifications;
    return prefs.enabled ? this.allNotifications().filter((n) => prefs.types[n.type]) : [];
  });
  // Menu principal (sidebar): todas as telas, agrupadas
  protected readonly navGroups: { label: string; items: { label: string; link: string; icon: string[] }[] }[] = [
    {
      label: '',
      items: [
        { label: 'Home', link: '/', icon: ['M3 10.5 12 3l9 7.5', 'M5 9.5V21h14V9.5', 'M10 21v-6h4v6'] },
        { label: 'Dashboards', link: '/dashboards', icon: ['M3 3v18h18', 'M8 17v-5', 'M13 17V8', 'M18 17v-9'] },
      ],
    },
    {
      label: 'Projetos',
      items: [
        { label: 'Geral', link: '/projetos/visaoGeral', icon: ['M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2z'] },
        { label: 'Criar novo projeto', link: '/projetos/novo', icon: ['M12 5v14', 'M5 12h14'] },
      ],
    },
    {
      label: 'Workspace',
      items: [
        { label: 'Work', link: '/workspace/work', icon: ['M3 8h18v12H3z', 'M8 8V5h8v3', 'M3 13h18'] },
        { label: 'Daily', link: '/workspace/daily', icon: ['M8 2v4', 'M16 2v4', 'M3 10h18', 'M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z'] },
        { label: 'Backlog', link: '/workspace/backlog', icon: ['M8 6h13', 'M8 12h13', 'M8 18h13', 'M3 6h.01', 'M3 12h.01', 'M3 18h.01'] },
        { label: 'Planning', link: '/workspace/planning', icon: ['M3 3v18h18', 'M7 14l4-4 4 4 5-6'] },
        { label: 'Notas', link: '/workspace/notes', icon: ['M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z', 'M14 2v6h6', 'M16 13H8', 'M16 17H8'] },
        { label: 'Arquivo', link: '/arquivo', icon: ['M3 4h18v4H3z', 'M5 8v12h14V8', 'M10 12h4'] },
      ],
    },
    {
      label: 'Configurações',
      items: [
        { label: 'Perfis de empresas', link: '/configuracoes/perfis-empresas', icon: ['M4 21V3h10v18', 'M14 9h6v12', 'M8 7h2', 'M8 11h2', 'M8 15h2', 'M2 21h20'] },
        { label: 'Membros', link: '/configuracoes/membros', icon: ['M16 21a6 6 0 0 0-12 0', 'M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M22 21a6 6 0 0 0-4-5.7', 'M16 3.1a4 4 0 0 1 0 7.8'] },
        { label: 'Equipes', link: '/configuracoes/equipes', icon: ['M12 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M5 20a7 7 0 0 1 14 0', 'M5 10a2 2 0 1 0 0-4', 'M19 10a2 2 0 1 0 0-4'] },
        { label: 'Integração com IA', link: '/configuracoes/integracao-ia', icon: ['M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z', 'M19 17l.8 2.2L22 20l-2.2.8L19 23l-.8-2.2L16 20l2.2-.8z'] },
        { label: 'Integrações', link: '/configuracoes/integracoes', icon: ['M9 2v6', 'M15 2v6', 'M6 8h12v3a6 6 0 0 1-12 0z', 'M12 17v5'] },
      ],
    },
  ];

  protected readonly hasUnread = computed(() => this.notifications().some((n) => !n.read));

  // ---------- Tema claro/escuro ----------
  // ponytail: só troca o atributo data-theme no <html>; as cores do modo escuro entram depois,
  // em :root[data-theme='dark'] { … }. A escolha fica salva neste navegador.
  protected readonly theme = signal<'light' | 'dark'>('light');

  private loadTheme() {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(THEME_KEY);
    } catch {
      // sem acesso ao localStorage: segue o sistema
    }
    const system = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    this.applyTheme(saved === 'dark' || saved === 'light' ? saved : system);
  }

  protected toggleTheme() {
    const next = this.theme() === 'light' ? 'dark' : 'light';
    this.applyTheme(next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      // sem espaço ou sem permissão: vale só nesta sessão
    }
  }

  private applyTheme(theme: 'light' | 'dark') {
    this.theme.set(theme);
    document.documentElement.dataset['theme'] = theme;
  }

  protected toggleMenu(menu: Menu) {
    this.openMenu.update((open) => (open === menu ? null : menu));
  }

  protected markAllAsRead() {
    this.allNotifications.update((list) => list.map((n) => ({ ...n, read: true })));
  }

  // No celular o menu do meio é um painel: fecha ao escolher uma página
  // Submenus (Projetos, Workspace, Configurações): no tablet/celular abrem e fecham no clique;
  // no computador continuam abrindo ao passar o mouse


  protected closeNavOnLinkClick(event: Event) {
    if ((event.target as Element).closest('a')) {
      this.openMenu.set(null);
      this.userMenu.set(false);
    }
  }

  protected pickCompany(id: number) {
    void this.session.selectCompany(id);
    this.companyMenu.set(false);
  }

  protected closeMenuOnOutsideClick(event: Event) {
    if (!(event.target as Element).closest('.company-picker')) this.companyMenu.set(false);
    if (!(event.target as Element).closest('.user-menu')) this.userMenu.set(false);
    if (!(event.target as Element).closest('.nav-menu, .nav-toggle, .sidebar')) {
      this.openMenu.set(null);
    }
  }
}

// Kanbans: segurar o mouse no fundo do quadro e arrastar rola as colunas para o lado.
// Cartões (arrastáveis), botões e campos continuam com o comportamento normal.
const PAN_BOARDS = '.kanban__board, .backlog__board';
const PAN_SKIP = '[draggable="true"], button, a, input, select, textarea, label, [contenteditable]';

function kanbanPan() {
  let board: HTMLElement | null = null;
  let startX = 0;
  let startScroll = 0;
  const down = (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    if (e.button !== 0 || target.closest(PAN_SKIP)) return;
    board = target.closest<HTMLElement>(PAN_BOARDS);
    if (!board || board.scrollWidth <= board.clientWidth) {
      board = null;
      return;
    }
    startX = e.clientX;
    startScroll = board.scrollLeft;
    board.style.scrollSnapType = 'none'; // o "ímã" das colunas brigaria com o arraste
    board.style.cursor = 'grabbing';
    e.preventDefault(); // não seleciona texto
  };
  const move = (e: MouseEvent) => {
    if (board) board.scrollLeft = startScroll - (e.clientX - startX);
  };
  const up = () => {
    if (!board) return;
    board.style.scrollSnapType = '';
    board.style.cursor = '';
    board = null;
  };
  document.addEventListener('mousedown', down);
  document.addEventListener('mousemove', move);
  document.addEventListener('mouseup', up);
  return () => {
    document.removeEventListener('mousedown', down);
    document.removeEventListener('mousemove', move);
    document.removeEventListener('mouseup', up);
  };
}
