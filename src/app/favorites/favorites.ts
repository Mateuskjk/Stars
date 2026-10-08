import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { initials } from '../chat/chat';
import { BacklogItem, BacklogStore, tagColor } from '../backlog/backlog-store';

const today = () => new Date().toISOString().slice(0, 10);

@Component({
  imports: [RouterLink],
  selector: 'app-favorites',
  templateUrl: './favorites.html',
  host: { class: 'favorites' },
})
export class Favorites {
  private readonly store = inject(BacklogStore);
  protected readonly initials = initials;
  protected readonly tagColor = tagColor;

  // Favoritos com prazo mais próximo primeiro; sem prazo vão para o fim
  protected readonly cards = computed(() =>
    this.store
      .items()
      .filter((item) => item.favorite)
      .sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999')),
  );

  protected column(item: BacklogItem) {
    return this.store.columns().find((column) => column.id === item.status)!;
  }

  protected unfavorite(item: BacklogItem) {
    this.store.patch(item.id, { favorite: false });
  }

  protected formatDue(due: string) {
    const [, month, day] = due.split('-');
    return `${day}/${month}`;
  }

  protected isOverdue(item: BacklogItem) {
    return !!item.due && item.due < today() && !['refinement-done', 'archived', 'canceled'].includes(item.status);
  }
}
