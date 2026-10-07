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

  // ponytail: notificações fixas de exemplo; trocar por um service/API quando o backend existir
  protected readonly notifications = signal([
    { id: 1, text: 'Bem-vindo ao Stars!', read: false },
    { id: 2, text: 'Seu Daily de hoje está pronto.', read: false },
    { id: 3, text: 'Planning da semana atualizado.', read: true },
  ]);
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
