import { Injectable, Injector, effect, inject } from '@angular/core';
import { BacklogStore } from '../backlog/backlog-store';
import { MembersStore } from '../members/members-store';
import { SprintStore } from '../planning/sprint-store';
import { ProjectStore } from '../projects/project-store';
import { TeamsStore } from '../teams/teams-store';

// Envia ao servidor um "retrato" dos dados para a API pública responder.
// Só o que a API expõe — sem e-mails, tokens, convites, anexos (URLs locais) nem notas pessoais.
// ponytail: some quando existir backend com banco (aí a API lê direto do banco)
@Injectable({ providedIn: 'root' })
export class ApiSnapshot {
  private readonly projects = inject(ProjectStore);
  private readonly backlog = inject(BacklogStore);
  private readonly sprints = inject(SprintStore);
  private readonly teams = inject(TeamsStore);
  private readonly members = inject(MembersStore);
  private readonly injector = inject(Injector);
  private timer: ReturnType<typeof setTimeout> | undefined;

  // Chamado uma vez pelo App, no navegador
  start() {
    if (typeof window === 'undefined') return;
    effect(
      () => {
        const snapshot = this.build();
        clearTimeout(this.timer);
        // espera as mudanças pararem um instante para não enviar a cada tecla
        this.timer = setTimeout(() => {
          fetch('/api/internal/snapshot', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(snapshot) }).catch(
            () => undefined,
          );
        }, 800);
      },
      { injector: this.injector },
    );
  }


  build() {
    return {
      projects: this.projects.projects().map(({ cover, docs, image, ...p }) => ({ ...p, docs: docs.length, image: !!image })),
      activities: this.backlog.items().map(({ attachments, subtasks, comments, ...a }) => ({
        ...a,
        attachments: attachments.length,
        subtasks: subtasks.length,
        comments: comments.length,
      })),
      sprints: this.sprints.sprints(),
      teams: this.teams.teams(),
      members: this.members.members().map(({ id, name, role, company, status }) => ({ id, name, role, company, status })),
    };
  }
}

