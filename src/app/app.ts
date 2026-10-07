import { Component, computed, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

type Menu = 'notifications' | 'user';

@Component({
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
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
  protected readonly notificationsEnabled = signal(true);
  protected readonly soundEnabled = signal(true);

  // ponytail: nome fixo até existir login; trocar pelo usuário autenticado
  protected readonly userName = signal('Usuário');
  protected readonly greeting = signal(greetingFor(new Date().getHours()));

  // ponytail: notificações fixas de exemplo; trocar por um service/API quando o backend existir
  protected readonly notifications = signal([
    { id: 1, text: 'Bem-vindo ao Stars!', read: false },
    { id: 2, text: 'Seu Daily de hoje está pronto.', read: false },
    { id: 3, text: 'Planning da semana atualizado.', read: true },
  ]);
  // ponytail: acessos fixos de exemplo; registrar os acessos reais quando as telas existirem
  protected readonly recents = signal([
    { type: 'Nota', title: 'Ideias para o Q4', link: '/workspace/notes' },
    { type: 'Projeto', title: 'Redesign do site', link: '/projetos' },
    { type: 'Dashboard', title: 'Métricas de vendas', link: '/dashboards' },
    { type: 'Cartão', title: 'Revisar backlog', link: '/workspace/backlog' },
    { type: 'Conversa', title: 'Time de produto', link: '/conversas' },
  ]);

  // ponytail: perfis fixos de exemplo; registrar os acessos reais quando a tela de perfis existir
  protected readonly recentProfiles = signal(
    [
      { name: 'Ana Souza', type: 'Perfil' },
      { name: 'Equipe Comercial', type: 'Subperfil' },
      { name: 'Carlos Lima', type: 'Perfil' },
      { name: 'Financeiro', type: 'Subperfil' },
      { name: 'Marketing', type: 'Subperfil' },
    ].map((p) => ({ ...p, initials: p.name.split(' ').map((w) => w[0]).slice(0, 2).join('') })),
  );

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
      link: '/projetos',
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
    this.notifications.update((list) => list.map((n) => ({ ...n, read: true })));
  }

  protected closeMenuOnOutsideClick(event: Event) {
    if (!(event.target as Element).closest('.nav-menu')) {
      this.openMenu.set(null);
    }
  }
}

function greetingFor(hour: number) {
  if (hour >= 5 && hour < 12) return 'Bom dia';
  if (hour >= 12 && hour < 18) return 'Boa tarde';
  return 'Boa noite';
}
