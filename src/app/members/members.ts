import { NgTemplateOutlet } from '@angular/common';
import { Component, DestroyRef, ElementRef, afterNextRender, computed, inject, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { initials } from '../format';
import { ResponsiveTable } from '../responsive-table';
import { AllowedDomains } from './allowed-domains';
import {
  ACCESS_LEVELS,
  Access,
  FEATURES,
  Feature,
  Member,
  MembersStore,
  Permissions,
  ROLES,
  Role,
  defaultPermissions,
  inviteEmail,
} from './members-store';
import { CompanyStore } from '../companies/company-store';
import { AccountStore } from '../account/account-store';

const normalize = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

@Component({
  imports: [AllowedDomains, ResponsiveTable, NgTemplateOutlet, RouterLink],
  selector: 'app-members',
  templateUrl: './members.html',
  host: { class: 'members' },
})
export class Members {
  protected readonly store = inject(MembersStore);
  protected readonly roles = ROLES;
  protected readonly features = FEATURES;
  protected readonly levels = ACCESS_LEVELS;
  protected readonly initials = initials;
  private readonly companyStore = inject(CompanyStore);
  private readonly account = inject(AccountStore); // quem convida assina o e-mail
  protected readonly activeCompanies = this.companyStore.activeNames;
  protected readonly allCompanies = this.companyStore.companies;

  protected readonly search = signal('');
  protected readonly list = computed(() => {
    const term = normalize(this.search());
    return this.store.members().filter((m) => normalize(`${m.name} ${m.email}`).includes(term));
  });
  protected readonly pendingCount = computed(() => this.store.members().filter((m) => m.status === 'pending').length);
  private readonly admins = computed(() => this.store.members().filter((m) => m.role === 'admin' && m.status === 'active'));

  protected roleLabel(role: Role) {
    return ROLES.find((r) => r.id === role)!.label;
  }

  protected summary(permissions: Permissions) {
    const values = Object.values(permissions);
    return `${values.filter((v) => v === 'edit').length} editar · ${values.filter((v) => v === 'view').length} ver`;
  }

  // Sempre precisa sobrar pelo menos um admin ativo
  protected isLastAdmin(member: Member) {
    return member.role === 'admin' && this.admins().length === 1 && this.admins()[0].id === member.id;
  }

  protected changeRole(member: Member, role: Role) {
    if (this.isLastAdmin(member) && role !== 'admin') return;
    this.store.patch(member.id, { role });
  }

  // ---------- Matriz de permissões (usada no convite e na edição) ----------
  protected readonly permDraft = signal<Permissions>(defaultPermissions('member'));

  protected setPermission(feature: Feature, access: Access) {
    this.permDraft.update((p) => ({ ...p, [feature]: access }));
  }

  protected applyRoleDefaults(role: Role) {
    this.permDraft.set(defaultPermissions(role));
  }

  // ---------- Convite ----------
  private readonly inviteDialog = viewChild.required<ElementRef<HTMLDialogElement>>('inviteDialog');
  protected readonly inviteStep = signal<'form' | 'sent'>('form');
  protected readonly inviteError = signal('');
  protected readonly inviteRole = signal<Role>('member');
  protected readonly sentEmail = signal<ReturnType<typeof inviteEmail> | null>(null);
  private inviteMessage = '';

  protected openInvite() {
    this.inviteStep.set('form');
    this.inviteError.set('');
    this.inviteRole.set('member');
    this.applyRoleDefaults('member');
    this.inviteDialog().nativeElement.showModal();
  }

  protected onInviteRole(role: Role) {
    this.inviteRole.set(role);
    this.applyRoleDefaults(role);
  }

  protected sendInvite(event: Event) {
    event.preventDefault();
    const form = event.target as HTMLFormElement;
    const data = new FormData(form);
    const name = String(data.get('name') ?? '').trim();
    const email = String(data.get('email') ?? '').trim();
    const company = String(data.get('company') ?? '');
    if (!name || !email) return;
    if (!company) {
      this.inviteError.set('Escolha o perfil de empresa da pessoa.');
      return;
    }
    if (this.store.findByEmail(email)) {
      this.inviteError.set('Já existe um membro (ou convite) com esse e-mail.');
      return;
    }
    this.inviteMessage = String(data.get('message') ?? '');
    const member = this.store.invite({ name, email, role: this.inviteRole(), permissions: this.permDraft(), company });
    this.showEmail(member);
    form.reset();
  }

  protected resend(member: Member) {
    this.store.resend(member.id);
    this.inviteMessage = '';
    this.showEmail(this.store.members().find((m) => m.id === member.id)!);
    this.inviteDialog().nativeElement.showModal();
  }

  // ponytail: aqui o servidor enviaria o e-mail (ex.: rota POST /api/convites no server.ts + provedor SMTP);
  // sem backend, a tela mostra a prévia do e-mail que seria enviado
  private showEmail(member: Member) {
    this.sentEmail.set(inviteEmail(member, this.account.fullName(), this.inviteMessage, location.origin));
    this.inviteStep.set('sent');
  }

  protected closeInvite() {
    this.inviteDialog().nativeElement.close();
  }

  // ---------- Permissões de um membro ----------
  private readonly permDialog = viewChild.required<ElementRef<HTMLDialogElement>>('permDialog');
  protected readonly editing = signal<Member | null>(null);


  constructor() {
    const route = inject(ActivatedRoute);
    const destroyRef = inject(DestroyRef);
    // Vindo dos "Perfis acessados": ?membro=ID abre direto
    afterNextRender(() =>
      route.queryParamMap.pipe(takeUntilDestroyed(destroyRef)).subscribe((params) => {
        const found = this.store.members().find((item) => item.id === Number(params.get('membro')));
        if (found) this.openPermissions(found);
      }),
    );
  }

  protected openPermissions(member: Member) {
    this.editing.set(member);
    this.permDraft.set({ ...member.permissions });
    this.permDialog().nativeElement.showModal();
  }

  protected savePermissions() {
    const member = this.editing();
    if (member) this.store.patch(member.id, { permissions: this.permDraft() });
    this.permDialog().nativeElement.close();
  }

  protected closePermissions() {
    this.permDialog().nativeElement.close();
  }

  // ---------- Token individual ----------
  private readonly tokenDialog = viewChild.required<ElementRef<HTMLDialogElement>>('tokenDialog');
  protected readonly newToken = signal<{ member: Member; token: string } | null>(null);
  protected readonly copied = signal(false);

  protected readonly tokenError = signal('');

  protected async generateToken(member: Member) {
    this.tokenError.set('');
    try {
      this.newToken.set({ member, token: await this.store.issueToken(member.id) });
      this.copied.set(false);
      this.tokenDialog().nativeElement.showModal();
    } catch (error) {
      this.tokenError.set(error instanceof Error ? error.message : 'Não foi possível gerar o token.');
    }
  }

  protected async copyToken() {
    const token = this.newToken()?.token;
    if (!token) return;
    try {
      await navigator.clipboard.writeText(token);
      this.copied.set(true);
    } catch {
      this.copied.set(false); // sem permissão de área de transferência: o token continua selecionável na tela
    }
  }

  protected closeToken() {
    this.newToken.set(null); // o token inteiro some da memória da tela ao fechar
    this.tokenDialog().nativeElement.close();
  }

  // ---------- Confirmações ----------
  private readonly confirmDialog = viewChild.required<ElementRef<HTMLDialogElement>>('confirmDialog');
  protected readonly pending = signal<{ title: string; text: string; label: string; run: () => void } | null>(null);

  protected askRemove(member: Member) {
    this.pending.set({
      title: `Remover ${member.name}?`,
      text: member.status === 'pending' ? 'O convite deixa de valer.' : 'A pessoa perde o acesso ao sistema e o token dela é revogado.',
      label: 'Remover',
      run: () => this.store.remove(member.id),
    });
    this.confirmDialog().nativeElement.showModal();
  }

  protected askRevoke(member: Member) {
    this.pending.set({
      title: 'Revogar o token?',
      text: `Integrações que usam o token de ${member.name} param de funcionar.`,
      label: 'Revogar',
      run: () => this.store.revokeToken(member.id),
    });
    this.confirmDialog().nativeElement.showModal();
  }

  protected confirm() {
    this.pending()?.run();
    this.confirmDialog().nativeElement.close();
  }

  protected cancelConfirm() {
    this.confirmDialog().nativeElement.close();
  }

  protected closeOnBackdrop(event: MouseEvent, dialog: HTMLDialogElement) {
    if (event.target === dialog) dialog.close();
  }
}
