import { Component, ElementRef, afterNextRender, computed, signal, viewChild } from '@angular/core';
import { ApiError, api } from '../api/http';
import { datesFromName } from '../api/sprint-dates';

export { datesFromName };

// Pop-up de migração (tipo instalação): liga o LexÁgile ao banco existente.
// Só admins (papel Dono). Tudo é salvo pelo servidor em /api/migracao; aqui é só a tela.

type Step = 'login' | 'preparar' | 'empresas' | 'setores' | 'usuarios' | 'projetos' | 'atividades' | 'sprints';
type Papel = 'DONO' | 'GESTOR' | 'ATENDENTE' | 'OBSERVADOR';

interface Empresa { id: string; nome: string; sigla: string; cor: string; ativo: boolean; visibilidade: 'TUDO' | 'RESTRITA' }
interface Setor { id: string; nome: string; cor: string; tenantId: string; membros: { usuarioId: string; gestor: boolean }[] }
interface Usuario { id: string; nome: string; email: string | null; papel: Papel; situacao: string; tenantId: string }
interface Projeto { id: string; numero: number | null; nome: string; setorId: string | null; tenantId: string; responsavelId: string; situacao: string; arquivado: boolean }
interface Sprint { id: string; nome: string; situacao: string; tenantId: string; inicio: string | null; fim: string | null }
interface Atividade { id: string; numero: number | null; titulo: string; status: string; tenantId: string; projetoId: string | null; sprintId: string | null; setorGeral: string | null }
interface Dados { instalado: boolean; empresas: Empresa[]; setores: Setor[]; usuarios: Usuario[]; projetos: Projeto[]; sprints: Sprint[]; atividades: Atividade[] }

export const STEPS: { id: Exclude<Step, 'login'>; label: string; hint: string }[] = [
  { id: 'preparar', label: 'Preparar banco', hint: 'Cria as tabelas do LexÁgile' },
  { id: 'empresas', label: 'Empresas', hint: 'Criar e definir visibilidade' },
  { id: 'setores', label: 'Setores', hint: 'Criar, membros e gestores' },
  { id: 'usuarios', label: 'Usuários', hint: 'Acesso às empresas' },
  { id: 'projetos', label: 'Projetos', hint: 'Criar e ligar ao setor' },
  { id: 'atividades', label: 'Atividades', hint: 'Projeto, sprint e gerais' },
  { id: 'sprints', label: 'Sprints', hint: 'Início e fim' },
];

export const PAPEIS: { id: Papel; label: string }[] = [
  { id: 'DONO', label: 'Admin' },
  { id: 'GESTOR', label: 'Supervisor' },
  { id: 'ATENDENTE', label: 'Membro' },
  { id: 'OBSERVADOR', label: 'Membro (só leitura)' },
];
export const papelLabel = (p: string) => PAPEIS.find((x) => x.id === p)?.label ?? p;
export const COLORS = ['sky', 'emerald', 'amber', 'rose', 'violet'];

const LIST_LIMIT = 200;

@Component({
  selector: 'app-migration-wizard',
  templateUrl: './migration-wizard.html',
})
export class MigrationWizard {
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  protected readonly steps = STEPS;
  protected readonly papeis = PAPEIS;
  protected readonly colors = COLORS;
  protected readonly papelLabel = papelLabel;

  protected readonly step = signal<Step>('login');
  protected readonly dados = signal<Dados | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly notice = signal('');
  protected readonly empresaId = signal('');

  // ---------- Recortes da empresa escolhida ----------
  protected readonly empresa = computed(() => this.dados()?.empresas.find((e) => e.id === this.empresaId()) ?? null);
  private readonly ofEmpresa = <T extends { tenantId: string }>(list: T[] | undefined) => (list ?? []).filter((x) => x.tenantId === this.empresaId());
  protected readonly setores = computed(() => this.ofEmpresa(this.dados()?.setores));
  protected readonly usuarios = computed(() => this.ofEmpresa(this.dados()?.usuarios).filter((u) => u.situacao !== 'REMOVIDO'));
  protected readonly projetos = computed(() => this.ofEmpresa(this.dados()?.projetos));
  protected readonly sprints = computed(() => this.ofEmpresa(this.dados()?.sprints));

  // Pessoas (por e-mail) e em quais empresas cada uma está
  protected readonly pessoas = computed(() => {
    const byKey = new Map<string, { key: string; nome: string; email: string | null; contas: Usuario[] }>();
    for (const u of this.dados()?.usuarios ?? []) {
      const key = u.email?.toLowerCase() || u.id;
      const p = byKey.get(key) ?? { key, nome: u.nome, email: u.email, contas: [] };
      p.contas.push(u);
      byKey.set(key, p);
    }
    return [...byKey.values()].sort((a, b) => a.nome.localeCompare(b.nome));
  });

  // ---------- Setores: edição de membros ----------
  protected readonly editingSetor = signal<string | null>(null);
  protected readonly setorMembros = signal(new Map<string, boolean>()); // usuarioId → gestor

  // ---------- Atividades: filtros e seleção ----------
  protected readonly busca = signal('');
  protected readonly filtroProjeto = signal('todos'); // todos | sem | <id>
  protected readonly filtroSprint = signal('todas'); // todas | sem | <id>
  protected readonly filtroGeral = signal('todas'); // todas | gerais | nao
  protected readonly selecionadas = signal(new Set<string>());

  protected readonly atividadesFiltradas = computed(() => {
    const term = this.busca().trim().toLowerCase();
    const proj = this.filtroProjeto();
    const sprint = this.filtroSprint();
    const geral = this.filtroGeral();
    return this.ofEmpresa(this.dados()?.atividades).filter(
      (a) =>
        (!term || a.titulo.toLowerCase().includes(term) || String(a.numero ?? '').includes(term)) &&
        (proj === 'todos' || (proj === 'sem' ? !a.projetoId : a.projetoId === proj)) &&
        (sprint === 'todas' || (sprint === 'sem' ? !a.sprintId : a.sprintId === sprint)) &&
        (geral === 'todas' || (geral === 'gerais' ? !!a.setorGeral : !a.setorGeral)),
    );
  });
  // ponytail: mostra as 200 primeiras; filtros afunilam o resto
  protected readonly atividadesVisiveis = computed(() => this.atividadesFiltradas().slice(0, LIST_LIMIT));
  protected readonly limit = LIST_LIMIT;
  protected readonly todasMarcadas = computed(() => {
    const list = this.atividadesVisiveis();
    return list.length > 0 && list.every((a) => this.selecionadas().has(a.id));
  });

  // Carregado sob demanda: abre assim que aparece pela primeira vez
  constructor() {
    afterNextRender(() => void this.open());
  }

  // ---------- Abrir / fechar ----------
  async open() {
    this.dialog().nativeElement.showModal();
    this.error.set('');
    this.notice.set('');
    await this.start();
  }

  protected close() {
    this.dialog().nativeElement.close();
  }

  protected closeOnBackdrop(event: MouseEvent) {
    if (event.target === this.dialog().nativeElement) this.close();
  }

  private async start() {
    this.busy.set(true);
    try {
      const status = await api<{ instalado: boolean }>('/migracao/status');
      await this.reload();
      this.step.set(status.instalado ? 'empresas' : 'preparar');
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) this.step.set('login');
      else this.error.set((e as Error).message);
    } finally {
      this.busy.set(false);
    }
  }

  private async reload() {
    const dados = await api<Dados>('/migracao/dados');
    this.dados.set(dados);
    if (!dados.empresas.some((e) => e.id === this.empresaId())) this.empresaId.set(dados.empresas[0]?.id ?? '');
  }

  protected goTo(step: Step) {
    this.error.set('');
    this.notice.set('');
    this.editingSetor.set(null);
    this.step.set(step);
  }

  protected setEmpresa(id: string) {
    this.empresaId.set(id);
    this.selecionadas.set(new Set());
    this.editingSetor.set(null);
    this.filtroProjeto.set('todos');
    this.filtroSprint.set('todas');
  }

  // Roda uma ação no servidor, mostra o resultado e recarrega os dados
  private async run(message: string, request: () => Promise<unknown>) {
    this.busy.set(true);
    this.error.set('');
    this.notice.set('');
    try {
      await request();
      await this.reload();
      this.notice.set(message);
      return true;
    } catch (e) {
      this.error.set((e as Error).message);
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  private static form(event: Event) {
    event.preventDefault();
    const form = event.target as HTMLFormElement;
    return { form, data: Object.fromEntries(new FormData(form)) as Record<string, string> };
  }

  // ---------- Login ----------
  protected async login(event: Event) {
    const { data } = MigrationWizard.form(event);
    this.busy.set(true);
    this.error.set('');
    try {
      await api('/auth/login', { method: 'POST', body: JSON.stringify({ email: data['email'], senha: data['senha'] }) });
      (event.target as HTMLFormElement).reset();
      await this.start();
    } catch (e) {
      this.error.set((e as Error).message);
    } finally {
      this.busy.set(false);
    }
  }

  // ---------- Etapas ----------
  protected async install() {
    if (await this.run('Banco preparado. As tabelas do LexÁgile foram criadas no schema "lexagile".', () => api('/migracao/instalar', { method: 'POST' }))) {
      this.step.set('empresas');
    }
  }

  protected async createEmpresa(event: Event) {
    const { form, data } = MigrationWizard.form(event);
    if (await this.run(`Empresa "${data['nome']}" criada. Você entrou nela como Admin.`, () => api('/migracao/empresas', { method: 'POST', body: JSON.stringify(data) }))) {
      form.reset();
    }
  }

  protected setVisibilidade(empresa: Empresa, visibilidade: string) {
    void this.run(`Visibilidade de ${empresa.nome} atualizada.`, () =>
      api(`/migracao/empresas/${empresa.id}`, { method: 'PATCH', body: JSON.stringify({ visibilidade }) }),
    );
  }

  protected async createSetor(event: Event) {
    const { form, data } = MigrationWizard.form(event);
    const body = { ...data, tenantId: this.empresaId() };
    if (await this.run(`Setor "${data['nome']}" criado.`, () => api('/migracao/setores', { method: 'POST', body: JSON.stringify(body) }))) form.reset();
  }

  protected editMembros(setor: Setor) {
    this.editingSetor.set(setor.id);
    this.setorMembros.set(new Map(setor.membros.map((m) => [m.usuarioId, m.gestor])));
  }

  protected toggleMembro(usuarioId: string) {
    this.setorMembros.update((map) => {
      const next = new Map(map);
      if (next.has(usuarioId)) next.delete(usuarioId);
      else next.set(usuarioId, false);
      return next;
    });
  }

  protected toggleGestor(usuarioId: string) {
    this.setorMembros.update((map) => new Map(map).set(usuarioId, !map.get(usuarioId)));
  }

  protected async saveMembros(setor: Setor) {
    const membros = [...this.setorMembros()].map(([usuarioId, gestor]) => ({ usuarioId, gestor }));
    if (await this.run(`Membros de ${setor.nome} salvos.`, () => api(`/migracao/setores/${setor.id}/membros`, { method: 'PUT', body: JSON.stringify({ membros }) }))) {
      this.editingSetor.set(null);
    }
  }

  protected nomeUsuario(id: string | null) {
    return this.dados()?.usuarios.find((u) => u.id === id)?.nome ?? '—';
  }

  protected gestoresDe(setor: Setor) {
    return setor.membros.filter((m) => m.gestor).map((m) => this.nomeUsuario(m.usuarioId)).join(', ') || 'nenhum';
  }

  protected nomeEmpresa(id: string) {
    return this.dados()?.empresas.find((e) => e.id === id)?.nome ?? '—';
  }

  protected nomeSetor(id: string | null) {
    return this.dados()?.setores.find((s) => s.id === id)?.nome ?? '';
  }

  protected nomeProjeto(id: string | null) {
    return this.dados()?.projetos.find((p) => p.id === id)?.nome ?? '';
  }

  protected nomeSprint(id: string | null) {
    return this.dados()?.sprints.find((s) => s.id === id)?.nome ?? '';
  }

  // Empresas onde a pessoa ainda não está
  protected empresasSem(contas: Usuario[]) {
    return (this.dados()?.empresas ?? []).filter((e) => !contas.some((c) => c.tenantId === e.id));
  }

  protected addToEmpresa(contas: Usuario[], tenantId: string, papel: string) {
    if (!tenantId) return;
    void this.run(`${contas[0].nome} agora tem acesso a ${this.nomeEmpresa(tenantId)}.`, () =>
      api('/migracao/usuarios', { method: 'POST', body: JSON.stringify({ usuarioId: contas[0].id, tenantId, papel }) }),
    );
  }

  protected async createProjeto(event: Event) {
    const { form, data } = MigrationWizard.form(event);
    const body = { ...data, tenantId: this.empresaId() };
    if (await this.run(`Projeto "${data['nome']}" criado.`, () => api('/migracao/projetos', { method: 'POST', body: JSON.stringify(body) }))) form.reset();
  }

  protected setSetorProjeto(projeto: Projeto, setorId: string) {
    void this.run(`Setor de "${projeto.nome}" atualizado.`, () =>
      api(`/migracao/projetos/${projeto.id}`, { method: 'PATCH', body: JSON.stringify({ setorId: setorId || null }) }),
    );
  }

  protected toggleAtividade(id: string) {
    this.selecionadas.update((set) => {
      const next = new Set(set);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  protected toggleTodas() {
    const all = this.todasMarcadas();
    this.selecionadas.update((set) => {
      const next = new Set(set);
      for (const a of this.atividadesVisiveis()) {
        if (all) next.delete(a.id);
        else next.add(a.id);
      }
      return next;
    });
  }

  // Lote: field = projetoId | sprintId | setorGeral; value '' = remover
  protected async applyLote(field: 'projetoId' | 'sprintId' | 'setorGeral', value: string, select: HTMLSelectElement) {
    const ids = [...this.selecionadas()];
    if (!ids.length || value === '__') return;
    const labels = { projetoId: 'projeto', sprintId: 'sprint', setorGeral: 'atividade geral do setor' };
    const ok = await this.run(`${ids.length} ${ids.length === 1 ? 'atividade atualizada' : 'atividades atualizadas'} (${labels[field]}).`, () =>
      api('/migracao/atividades', { method: 'PATCH', body: JSON.stringify({ ids, [field]: value || null }) }),
    );
    select.value = '__';
    if (ok) this.selecionadas.set(new Set());
  }

  protected suggested(sprint: Sprint) {
    return datesFromName(sprint.nome);
  }

  protected savePeriodo(sprint: Sprint, inicio: string, fim: string) {
    if (!inicio || !fim) {
      this.error.set('Preencha início e fim da sprint.');
      return;
    }
    void this.run(`Período de ${sprint.nome} salvo.`, () =>
      api(`/migracao/sprints/${sprint.id}/periodo`, { method: 'PUT', body: JSON.stringify({ inicio, fim }) }),
    );
  }

  // Preenche, pelo nome, as sprints que ainda não têm período
  protected async fillFromNames() {
    const pending = this.sprints().filter((s) => !s.inicio && datesFromName(s.nome));
    if (!pending.length) {
      this.notice.set('Nenhuma sprint sem período tem datas no nome.');
      return;
    }
    await this.run(`${pending.length} ${pending.length === 1 ? 'sprint preenchida' : 'sprints preenchidas'} pelas datas do nome.`, async () => {
      for (const s of pending) {
        await api(`/migracao/sprints/${s.id}/periodo`, { method: 'PUT', body: JSON.stringify(datesFromName(s.nome)) });
      }
    });
  }

  protected async logout() {
    await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
    this.dados.set(null);
    this.step.set('login');
  }
}
