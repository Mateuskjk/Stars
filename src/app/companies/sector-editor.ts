import { Component, ElementRef, computed, inject, input, output, signal, viewChild } from '@angular/core';
import { MembersStore } from '../members/members-store';
import { Company } from './company-store';
import { Sector, SectorStore } from './sector-store';

// Diálogos de setor (só admin): criar, editar (nome, descrição, gestor, membros) e excluir
@Component({
  selector: 'app-sector-editor',
  templateUrl: './sector-editor.html',
})
export class SectorEditor {
  readonly company = input.required<Company>();
  readonly deleted = output<void>();

  private readonly store = inject(SectorStore);
  private readonly membersStore = inject(MembersStore);

  // Membros ligados à empresa: podem ser gestores e membros do setor
  protected readonly people = computed(() =>
    this.membersStore.members().filter((m) => m.company === this.company().name && m.status === 'active'),
  );

  protected readonly editing = signal<Sector | null>(null); // null = novo setor
  protected readonly memberIds = signal<number[]>([]);
  protected readonly error = signal('');
  protected readonly removing = signal<Sector | null>(null);
  protected readonly linked = computed(() => {
    const sector = this.removing();
    return sector ? this.store.sectorItems(sector.id) : 0;
  });

  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  private readonly confirm = viewChild.required<ElementRef<HTMLDialogElement>>('confirm');

  open(sector: Sector | null = null) {
    this.editing.set(sector);
    this.memberIds.set(sector ? [...sector.memberIds] : []);
    this.error.set('');
    this.dialog().nativeElement.showModal();
  }

  askDelete(sector: Sector) {
    this.removing.set(sector);
    this.confirm().nativeElement.showModal();
  }

  protected toggleMember(id: number) {
    this.memberIds.update((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  }

  protected save(event: Event) {
    event.preventDefault();
    const data = new FormData(event.target as HTMLFormElement);
    const sector = this.editing();
    const name = String(data.get('name') ?? '').trim();
    if (!name) return;
    if (this.store.isNameTaken(this.company().id, name, sector?.id ?? null)) {
      this.error.set(`Já existe o setor “${name}” nesta empresa.`);
      return;
    }
    const manager = String(data.get('manager') ?? '');
    // o gestor também é membro do setor
    const managerId = this.people().find((m) => m.name === manager)?.id;
    const memberIds = managerId && !this.memberIds().includes(managerId) ? [...this.memberIds(), managerId] : this.memberIds();
    const sectorData = { name, description: String(data.get('description') ?? ''), manager, memberIds };
    if (sector) this.store.update(sector.id, sectorData);
    else this.store.create(this.company().id, this.company().name, sectorData);
    this.dialog().nativeElement.close();
  }

  protected confirmDelete() {
    const sector = this.removing();
    if (sector) this.store.remove(sector.id);
    this.confirm().nativeElement.close();
    this.deleted.emit();
  }

  protected closeOnBackdrop(event: MouseEvent, dialog: HTMLDialogElement) {
    if (event.target === dialog) dialog.close();
  }
}
