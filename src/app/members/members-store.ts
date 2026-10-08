import { Injectable, signal } from '@angular/core';
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
  readonly members = signal<Member[]>(SEED);

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
    return member;
  }

  // Reenviar: código novo, prazo novo e tentativas zeradas (o código antigo deixa de valer)
  resend(id: number, now = Date.now()) {
    const invite: Invite = { code: generateCode(), expiresAt: now + CODE_TTL, attempts: 0, sentAt: now };
    this.patch(id, { invite });
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
      return invite.attempts + 1 >= MAX_ATTEMPTS ? 'blocked' : 'wrong-code';
    }
    this.patch(member.id, { status: 'active', invite: null });
    return 'ok';
  }

  // Gera um token novo (o anterior deixa de valer). Devolve o token inteiro só desta vez.
  issueToken(id: number) {
    const token = generateToken();
    this.patch(id, { tokenHint: token.slice(-4) });
    return token;
  }

  revokeToken(id: number) {
    this.patch(id, { tokenHint: null });
  }

  patch(id: number, changes: Partial<Member>) {
    this.members.update((list) => list.map((member) => (member.id === id ? { ...member, ...changes } : member)));
  }

  remove(id: number) {
    this.members.update((list) => list.filter((member) => member.id !== id));
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
