import { Injectable, inject, signal } from '@angular/core';
import { AuditStore } from '../audit/audit-store';
import { USERS } from '../chat/chat';

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
  { id: 'chat', label: 'Conversas' },
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
  return { ...all('view'), daily: 'edit', backlog: 'edit', notes: 'edit', chat: 'edit', settings: 'none' };
}

export interface Invite {
  code: string;
  expiresAt: number;
  attempts: number;
  sentAt: number;
}

export interface Member {
  id: number;
  name: string;
  email: string;
  role: Role;
  status: 'active' | 'pending';
  permissions: Permissions;
  company: string | null; // perfil de empresa ao qual a pessoa está ligada (obrigatório para entrar em equipes)
  tokenHint: string | null; // só o final do token fica guardado; o token inteiro aparece uma vez
  invite: Invite | null;
}

export const CODE_TTL = 24 * 60 * 60 * 1000; // o código vale 24h
export const MAX_ATTEMPTS = 5;

// Número aleatório seguro (crypto), não Math.random
function randomInt(max: number) {
  return crypto.getRandomValues(new Uint32Array(1))[0] % max;
}

export function generateCode() {
  return String(randomInt(1_000_000)).padStart(6, '0');
}

export function generateToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return 'stars_' + [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export type ValidationResult = 'ok' | 'not-found' | 'expired' | 'blocked' | 'wrong-code';

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
  private readonly audit = inject(AuditStore);
  readonly members = signal<Member[]>(SEED);

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
    return this.members().find((member) => member.email.toLowerCase() === target) ?? null;
  }

  // Cria o membro como "convite pendente" e devolve o código para o e-mail
  invite(data: { name: string; email: string; role: Role; permissions: Permissions; company: string }, now = Date.now()) {
    const invite: Invite = { code: generateCode(), expiresAt: now + CODE_TTL, attempts: 0, sentAt: now };
    const member: Member = { ...data, email: data.email.trim().toLowerCase(), id: this.nextId(), status: 'pending', tokenHint: null, invite };
    this.members.update((list) => [...list, member]);
    this.audit.log({ action: 'create', entity: 'Membro', name: member.name, to: 'Convite pendente', details: `Convite enviado para ${member.email} · ${roleLabel(member.role)} · ${member.company}` });
    return member;
  }

  // Reenviar: código novo, prazo novo e tentativas zeradas (o código antigo deixa de valer)
  resend(id: number, now = Date.now()) {
    const invite: Invite = { code: generateCode(), expiresAt: now + CODE_TTL, attempts: 0, sentAt: now };
    this.patch(id, { invite });
    const member = this.byId(id);
    if (member) this.audit.log({ action: 'update', entity: 'Membro', name: member.name, details: 'Convite reenviado (código anterior invalidado)' });
    return invite;
  }

  validate(email: string, code: string, now = Date.now()): ValidationResult {
    const member = this.findByEmail(email);
    if (!member || member.status !== 'pending' || !member.invite) return 'not-found';
    const invite = member.invite;
    if (now > invite.expiresAt) return 'expired';
    if (invite.attempts >= MAX_ATTEMPTS) return 'blocked';
    if (code.trim() !== invite.code) {
      this.patch(member.id, { invite: { ...invite, attempts: invite.attempts + 1 } });
      if (invite.attempts + 1 >= MAX_ATTEMPTS) {
        this.audit.log({ action: 'update', entity: 'Membro', name: member.name, actor: member.name, details: `Convite bloqueado após ${MAX_ATTEMPTS} códigos errados` });
        return 'blocked';
      }
      return 'wrong-code';
    }
    this.patch(member.id, { status: 'active', invite: null });
    // quem valida é a própria pessoa convidada
    this.audit.log({ action: 'update', entity: 'Membro', name: member.name, actor: member.name, from: 'Convite pendente', to: 'Ativo', details: 'Conta ativada com o código do convite' });
    return 'ok';
  }

  // Gera um token novo (o anterior deixa de valer). Devolve o token inteiro só desta vez.
  issueToken(id: number) {
    const token = generateToken();
    const replaced = !!this.byId(id)?.tokenHint;
    this.patch(id, { tokenHint: token.slice(-4) });
    const member = this.byId(id);
    // o token nunca entra no registro; só o fato de ter sido gerado
    if (member) this.audit.log({ action: 'update', entity: 'Membro', name: member.name, details: replaced ? 'Token de API gerado de novo (o anterior foi invalidado)' : 'Token de API gerado' });
    return token;
  }

  revokeToken(id: number) {
    this.patch(id, { tokenHint: null });
    const member = this.byId(id);
    if (member) this.audit.log({ action: 'update', entity: 'Membro', name: member.name, details: 'Token de API revogado' });
  }

  patch(id: number, changes: Partial<Member>) {
    const before = this.byId(id);
    this.members.update((list) => list.map((member) => (member.id === id ? { ...member, ...changes } : member)));
    if (!before) return;
    // Cargo, empresa e permissões são auditados aqui (convite, token e status têm registro próprio)
    if (changes.role && changes.role !== before.role) {
      this.audit.log({ action: 'update', entity: 'Membro', name: before.name, from: roleLabel(before.role), to: roleLabel(changes.role), details: 'Cargo alterado' });
    }
    if ('company' in changes && changes.company !== before.company) {
      this.audit.log({ action: 'move', entity: 'Membro', name: before.name, from: before.company ?? 'Sem empresa', to: changes.company ?? 'Sem empresa', details: 'Perfil de empresa alterado' });
    }
    if (changes.permissions) {
      const label = (access: Access) => ACCESS_LEVELS.find((a) => a.id === access)!.label;
      const details = FEATURES.filter((f) => before.permissions[f.id] !== changes.permissions![f.id])
        .map((f) => `${f.label}: ${label(before.permissions[f.id])} → ${label(changes.permissions![f.id])}`)
        .join(' · ');
      if (details) this.audit.log({ action: 'update', entity: 'Membro', name: before.name, details: `Permissões — ${details}` });
    }
  }

  remove(id: number) {
    const member = this.byId(id);
    this.members.update((list) => list.filter((current) => current.id !== id));
    if (member) this.audit.log({ action: 'delete', entity: 'Membro', name: member.name, from: member.status === 'pending' ? 'Convite pendente' : 'Ativo' });
  }
}

// E-mail de convite personalizado (texto). O servidor de e-mail usaria este conteúdo.
export function inviteEmail(member: Member, invitedBy: string, message: string, origin: string) {
  const firstName = member.name.split(' ')[0];
  const role = ROLES.find((r) => r.id === member.role)!.label;
  return {
    to: member.email,
    subject: `${invitedBy} convidou você para o Stars`,
    body: [
      `Olá, ${firstName}!`,
      ``,
      `${invitedBy} convidou você para entrar no Stars como ${role}` + (member.company ? ` na ${member.company}.` : '.'),
      ...(message.trim() ? [``, `“${message.trim()}”`] : []),
      ``,
      `Seu código de verificação é:`,
      ``,
      `    ${member.invite?.code}`,
      ``,
      `Para ativar sua conta, acesse ${origin}/convite e informe este e-mail e o código acima.`,
      `O código vale por 24 horas. Se você não esperava este convite, é só ignorar esta mensagem.`,
      ``,
      `Equipe Stars`,
    ].join('\n'),
  };
}

const roleLabel = (role: Role) => ROLES.find((r) => r.id === role)!.label;
