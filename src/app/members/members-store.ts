import { Injectable, computed, inject, signal } from '@angular/core';
import { AccountStore } from '../account/account-store';
import { USERS } from './users';

export type Role = 'admin' | 'supervisor' | 'member';
export type Access = 'none' | 'view' | 'edit';
export type Feature = (typeof FEATURES)[number]['id'];

export const ROLES: { id: Role; label: string; description: string }[] = [
  { id: 'admin', label: 'Admin', description: 'Acesso total, inclusive configurações e membros' },
  { id: 'supervisor', label: 'Supervisor', description: 'Gerencia o trabalho do time; vê as configurações' },
  { id: 'member', label: 'Membro', description: 'Trabalha nas próprias atividades' },
];

export const ACCESS_LEVELS: { id: Access; label: string }[] = [
  { id: 'none', label: 'Sem acesso' },
  { id: 'view', label: 'Ver' },
  { id: 'edit', label: 'Editar' },
];

export const FEATURES = [
  { id: 'dashboards', label: 'Dashboards' },
  { id: 'projects', label: 'Projetos' },
  { id: 'daily', label: 'Daily' },
  { id: 'backlog', label: 'Backlog' },
  { id: 'planning', label: 'Planning' },
  { id: 'notes', label: 'Notas' },
  { id: 'settings', label: 'Configurações' },
] as const;

export type Permissions = Record<Feature, Access>;

// Permissões padrão de cada cargo (dá para ajustar membro a membro depois)
export function defaultPermissions(role: Role): Permissions {
  const all = (access: Access) => Object.fromEntries(FEATURES.map((f) => [f.id, access])) as Permissions;
  if (role === 'admin') return all('edit');
  if (role === 'supervisor') return { ...all('edit'), settings: 'view' };
  return { ...all('view'), daily: 'edit', backlog: 'edit', notes: 'edit', settings: 'none' };
}

// Convite pendente: o código vai por e-mail e é conferido no servidor (src/server/invites.ts)
export interface Invite {
  sentAt: number;
  message?: string; // mensagem de quem convidou (vai no e-mail)
}

// Situação do último e-mail de convite (a tela de Membros mostra se saiu ou falhou)
export interface InviteMail {
  email: string;
  state: 'sending' | 'sent' | 'failed';
  error?: string;
}

export interface Member {
  id: number;
  name: string;
  email: string;
  role: Role;
  status: 'active' | 'pending';
  permissions: Permissions;
  company: string | null; // perfil de empresa ao qual a pessoa está ligada (obrigatório para entrar em equipes)
  companies?: string[]; // dados do banco: todas as empresas em que a pessoa está ativa
  tokenHint: string | null; // só o final do token fica guardado; o token inteiro aparece uma vez
  invite: Invite | null;
}

export function generateToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return 'stars_' + [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}


const emailOf = (name: string) =>
  name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(' ', '.') + '@stars.com';

// Empresas de exemplo para os membros iniciais (os nomes vêm dos Perfis de Empresas)
const SEED_COMPANIES = ['Acme Ltda', 'Acme Ltda', 'Nova Tech', 'Acme Ltda', 'Nova Tech', 'Acme Ltda', null];

const SEED: Member[] = USERS.map((user, i) => {
  const role: Role = i === 0 ? 'admin' : user.role === 'Tech Lead' ? 'supervisor' : 'member';
  return {
    id: i + 1,
    name: user.name,
    email: emailOf(user.name),
    role,
    status: 'active',
    permissions: defaultPermissions(role),
    company: SEED_COMPANIES[i] ?? null,
    tokenHint: null,
    invite: null,
  };
});

// Membros do sistema.
// SEGURANÇA / ponytail: aqui tudo roda no navegador, só para a tela funcionar sem backend.
// Em produção, gerar o código, guardá-lo (de preferência só o hash), validar, contar tentativas
// e enviar o e-mail TÊM de acontecer no servidor — no navegador qualquer um consegue ler o código.
@Injectable({ providedIn: 'root' })
export class MembersStore {
  readonly members = signal<Member[]>(SEED);
  private readonly account = inject(AccountStore);

  // E-mail de quem fez login (preenchido ao carregar os dados do banco)
  readonly sessionEmail = signal<string | null>(null);

  // Quem está usando o sistema: quem fez login; sem login (exemplos/testes), o e-mail de Minha conta
  // ou o dono do sistema (1º admin ativo).
  // SEGURANÇA: isto só esconde botões. Com backend, a permissão tem de ser checada no servidor.
  readonly current = computed(
    () =>
      this.findByEmail(this.sessionEmail() ?? '') ??
      this.findByEmail(this.account.account().email) ??
      this.members().find((member) => member.role === 'admin' && member.status === 'active') ??
      null,
  );
  readonly isAdmin = computed(() => this.current()?.role === 'admin');

  private byId(id: number) {
    return this.members().find((member) => member.id === id);
  }

  private nextId() {
    return Math.max(0, ...this.members().map((m) => m.id)) + 1;
  }

  // Quem pode entrar numa equipe: membro ativo e ligado a um perfil de empresa
  eligibleForTeams() {
    return this.members().filter((member) => member.status === 'active' && !!member.company);
  }

  findByEmail(email: string) {
    const target = email.trim().toLowerCase();
    if (!target) return null; // e-mail vazio não identifica ninguém
    return this.members().find((member) => member.email.toLowerCase() === target) ?? null;
  }

  // Último e-mail de convite: o servidor responde se enviou (ApiSync) e a tela mostra
  readonly inviteMail = signal<InviteMail | null>(null);

  // Cria o membro como "convite pendente"; ao gravar no banco, o servidor envia o e-mail com o código
  invite(data: { name: string; email: string; role: Role; permissions: Permissions; company: string }, message = '', now = Date.now()) {
    const invite: Invite = { sentAt: now, message: message.trim() || undefined };
    const member: Member = { ...data, email: data.email.trim().toLowerCase(), id: this.nextId(), status: 'pending', tokenHint: null, invite };
    this.members.update((list) => [...list, member]);
    this.inviteMail.set({ email: member.email, state: 'sending' });
    return member;
  }


  // Gera um token novo (o anterior deixa de valer) e registra no servidor da API pública.
  // Devolve o token inteiro só desta vez. Falha (lança erro) se o servidor não registrar.
  async issueToken(id: number) {
    const token = generateToken();
    const owner = this.byId(id);
    if (!owner) throw new Error('Membro não encontrado.');
    const response = await fetch(`/api/internal/tokens/${id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, name: owner.name, email: owner.email, role: owner.role, permissions: owner.permissions }),
    });
    if (!response.ok) throw new Error('O servidor não registrou o token. Tente de novo.');
    this.patch(id, { tokenHint: token.slice(-4) });
    return token;
  }

  revokeToken(id: number) {
    this.syncToken(id, 'DELETE');
    this.patch(id, { tokenHint: null });
  }

  patch(id: number, changes: Partial<Member>) {
    const before = this.byId(id);
    this.members.update((list) => list.map((member) => (member.id === id ? { ...member, ...changes } : member)));
    if (!before) return;
    // Cargo/permissões mudaram: o token da pessoa passa a valer com as permissões novas
    if (before.tokenHint && (changes.role || changes.permissions || changes.name)) this.syncToken(id, 'PATCH');
  }

  // Avisa o servidor da API pública (revogar ou atualizar permissões); não trava a tela
  private syncToken(id: number, method: 'DELETE' | 'PATCH') {
    if (typeof window === 'undefined') return;
    const member = this.byId(id);
    fetch(`/api/internal/tokens/${id}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: method === 'PATCH' && member ? JSON.stringify({ name: member.name, role: member.role, permissions: member.permissions }) : undefined,
    }).catch(() => undefined);
  }

  remove(id: number) {
    this.syncToken(id, 'DELETE'); // quem sai do sistema perde o acesso à API
    this.members.update((list) => list.filter((current) => current.id !== id));
  }
}


