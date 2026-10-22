import { Component, DestroyRef, ElementRef, afterNextRender, computed, inject, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { BacklogStatus, BacklogStore } from '../backlog/backlog-store';
import { initials } from '../format';
import { Member, MembersStore } from '../members/members-store';
import { ProjectStore } from '../projects/project-store';
import { Team, TeamData, TeamsStore } from './teams-store';

const normalize = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const empty = (): TeamData => ({ name: '', focus: '', memberIds: [], projectIds: [], activityIds: [] });

@Component({
  imports: [RouterLink],
  selector: 'app-teams',
  templateUrl: './teams.html',
  host: { class: 'teams' },
})
export class Teams {
  protected readonly store = inject(TeamsStore);
  private readonly membersStore = inject(MembersStore);
  private readonly projectStore = inject(ProjectStore);
  private readonly backlog = inject(BacklogStore);
  protected readonly initials = initials;

  // Membros que podem entrar em equipes (ativos e com empresa) e quantos ficam de fora
  protected readonly eligible = computed(() => this.membersStore.eligibleForTeams());
  protected readonly ineligibleCount = computed(() => this.membersStore.members().length - this.eligible().length);
  protected readonly projects = this.projectStore.visible; // só empresas ativas
  // Atividades gerais ainda em andamento (arquivadas e canceladas não recebem equipe)
  protected readonly activities = computed(() => this.backlog.items().filter((item) => item.status !== 'archived' && item.status !== 'canceled'));

  // ---------- Cartões das equipes ----------
  protected membersOf(team: Team) {
    const all = this.membersStore.members();
    return team.memberIds.map((id) => all.find((member) => member.id === id)).filter((member): member is Member => !!member);
  }

  protected projectsOf(team: Team) {
    return this.projects().filter((project) => team.projectIds.includes(project.id));
  }

  protected activitiesOf(team: Team) {
    return this.backlog.items().filter((item) => team.activityIds.includes(item.id));
  }

  protected statusLabel(status: string) {
    return this.backlog.label(status as BacklogStatus);
  }

  // Em quais outras equipes uma atividade já está (para mostrar no seletor)
  protected otherTeams(activityId: number) {
    return this.store
      .teams()
      .filter((team) => team.id !== this.editingId() && team.activityIds.includes(activityId))
      .map((team) => team.name)
      .join(', ');
  }

  // ---------- Modal de criar / editar ----------
  private readonly editor = viewChild.required<ElementRef<HTMLDialogElement>>('editor');
  protected readonly editingId = signal<number | null>(null);
  protected readonly draft = signal<TeamData>(empty());
  protected readonly memberSearch = signal('');
  protected readonly error = signal('');

  protected readonly filteredEligible = computed(() => {
    const term = normalize(this.memberSearch());
    return this.eligible().filter((member) => normalize(`${member.name} ${member.company} ${member.email}`).includes(term));
  });

  protected openNew() {
    this.editingId.set(null);
    this.draft.set(empty());
    this.openEditor();
  }


  constructor() {
    const route = inject(ActivatedRoute);
    const destroyRef = inject(DestroyRef);
    // Vindo dos "Perfis acessados": ?equipe=ID abre direto
    afterNextRender(() =>
      route.queryParamMap.pipe(takeUntilDestroyed(destroyRef)).subscribe((params) => {
        const found = this.store.teams().find((item) => item.id === Number(params.get('equipe')));
        if (found) this.openEdit(found);
      }),
    );
  }

  protected openEdit(team: Team) {
    this.editingId.set(team.id);
    // Quem perdeu a elegibilidade (saiu da empresa, foi removido…) não volta para o rascunho
    const eligible = new Set(this.eligible().map((member) => member.id));
    this.draft.set({ ...team, memberIds: team.memberIds.filter((id) => eligible.has(id)) });
    this.openEditor();
  }

  private openEditor() {
    this.memberSearch.set('');
    this.error.set('');
    this.editor().nativeElement.showModal();
  }

  protected closeEditor() {
    this.editor().nativeElement.close();
  }

  protected patch(changes: Partial<TeamData>) {
    this.draft.update((draft) => ({ ...draft, ...changes }));
  }

  protected toggle(field: 'memberIds' | 'projectIds' | 'activityIds', id: number) {
    const list = this.draft()[field];
    this.patch({ [field]: list.includes(id) ? list.filter((current) => current !== id) : [...list, id] });
  }

  protected save(event: Event) {
    event.preventDefault();
    const draft = this.draft();
    if (!draft.name.trim()) {
      this.error.set('Dê um nome para a equipe.');
      return;
    }
    const duplicate = this.store.teams().some((team) => team.id !== this.editingId() && normalize(team.name.trim()) === normalize(draft.name.trim()));
    if (duplicate) {
      this.error.set('Já existe uma equipe com esse nome.');
      return;
    }
    const id = this.editingId();
    if (id === null) this.store.create(draft);
    else this.store.update(id, draft);
    this.closeEditor();
  }

  // ---------- Exclusão ----------
  private readonly confirmDialog = viewChild.required<ElementRef<HTMLDialogElement>>('confirmDialog');
  protected readonly deleting = signal<Team | null>(null);

  protected askDelete(team: Team) {
    this.deleting.set(team);
    this.confirmDialog().nativeElement.showModal();
  }

  protected confirmDelete() {
    const team = this.deleting();
    if (team) this.store.remove(team.id);
    this.confirmDialog().nativeElement.close();
  }

  protected cancelDelete() {
    this.confirmDialog().nativeElement.close();
  }

  protected closeOnBackdrop(event: MouseEvent, dialog: HTMLDialogElement) {
    if (event.target === dialog) dialog.close();
  }
}
