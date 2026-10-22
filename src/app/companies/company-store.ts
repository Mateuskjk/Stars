import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { CarouselItem } from '../carousel/carousel';
import { MembersStore } from '../members/members-store';
import { ProjectStore, cssImage } from '../projects/project-store';

export interface ViewSettings {
  locale: 'pt-BR' | 'en-US' | 'es-ES';
  dateFormat: 'dd/MM/yyyy' | 'MM/dd/yyyy' | 'yyyy-MM-dd';
  currency: 'BRL' | 'USD' | 'EUR';
  weekStart: 'sunday' | 'monday';
  showInCarousel: boolean;
}

export interface Company {
  id: number;
  name: string;
  description: string;
  site: string;
  active: boolean;
  image: string | null; // imagem do perfil (data URL); aparece no carrossel de Empresas
  cover: string; // gradiente usado quando não há imagem
  timeZone: string; // fuso horário IANA, ex.: America/Sao_Paulo
  view: ViewSettings;
}

export type CompanyData = Omit<Company, 'id' | 'cover'>;

export const DEFAULT_VIEW: ViewSettings = {
  locale: 'pt-BR',
  dateFormat: 'dd/MM/yyyy',
  currency: 'BRL',
  weekStart: 'sunday',
  showInCarousel: true,
};

const COVERS = [
  'linear-gradient(135deg, #222b44, #8a93b8)',
  'linear-gradient(135deg, #1f4e79, #a7c4e0)',
  'linear-gradient(135deg, #8a4b3c, #f0c9a8)',
  'linear-gradient(135deg, #2f5d3a, #b5d6a7)',
  'linear-gradient(135deg, #2f5d62, #bfe0dc)',
  'linear-gradient(135deg, #5c3d6e, #d9c2e6)',
];

const seed = (id: number, name: string, description: string, timeZone = 'America/Sao_Paulo', view: Partial<ViewSettings> = {}): Company => ({
  id,
  name,
  description,
  site: '',
  active: true,
  image: null,
  cover: COVERS[(id - 1) % COVERS.length],
  timeZone,
  view: { ...DEFAULT_VIEW, ...view },
});

// ponytail: perfis de exemplo, só em memória (somem ao recarregar); as imagens viram data URL comprimida
// — com backend, enviar o arquivo para um storage e guardar só a URL
const SEED: Company[] = [
  seed(1, 'Acme Ltda', 'Indústria e distribuição'),
  seed(2, 'Nova Tech', 'Software e consultoria', 'America/New_York', { locale: 'en-US', dateFormat: 'MM/dd/yyyy', currency: 'USD' }),
  seed(3, 'Grupo Horizonte', 'Serviços financeiros'),
  seed(4, 'Verde Alimentos', 'Alimentos orgânicos', 'America/Manaus'),
  seed(5, 'Lumen Saúde', 'Clínicas e laboratórios'),
  seed(6, 'Órbita Logística', 'Transporte e armazenagem', 'Europe/Lisbon', { currency: 'EUR', weekStart: 'monday' }),
];

// Perfis de empresas: fonte única dos nomes usados em membros, equipes, projetos e no carrossel da Home
@Injectable({ providedIn: 'root' })
export class CompanyStore {
  private readonly members = inject(MembersStore);
  private readonly projects = inject(ProjectStore);
  readonly companies = signal<Company[]>(SEED);
  // Empresa em que a pessoa está trabalhando (Backlog, Planning, sprint ativa); null = todas (exemplos)
  readonly currentId = signal<number | null>(null);
  readonly current = computed(() => this.companies().find((c) => c.id === this.currentId()) ?? null);

  readonly active = computed(() => this.companies().filter((company) => company.active));
  readonly activeNames = computed(() => this.active().map((company) => company.name));

  // Projetos de empresas inativas somem das telas e, com uma empresa escolhida no seletor, só aparecem
  // os dela (o ProjectStore não injeta este store: seria circular)
  constructor() {
    effect(() => {
      const current = this.current();
      this.projects.activeCompanies.set(new Set(current?.active ? [current.name] : this.activeNames()));
    });
  }

  // Carrossel de Empresas: só perfis ativos marcados para aparecer; com imagem, ela vira a capa
  readonly carouselItems = computed<CarouselItem[]>(() =>
    this.active()
      .filter((company) => company.view.showInCarousel)
      .map((company) => ({
        name: company.name,
        cover: company.image ? cssImage(company.image) : company.cover,
        link: `/empresas/${company.id}`,
      })),
  );

  create(data: CompanyData) {
    const id = Math.max(0, ...this.companies().map((company) => company.id)) + 1;
    this.companies.update((list) => [...list, { ...data, name: data.name.trim(), id, cover: COVERS[(id - 1) % COVERS.length] }]);
    return id;
  }

  // Renomear atualiza o nome da empresa em membros e projetos, para nenhum vínculo se perder
  update(id: number, data: CompanyData) {
    const old = this.companies().find((company) => company.id === id);
    if (!old) return;
    const name = data.name.trim();
    this.companies.update((list) => list.map((company) => (company.id === id ? { ...company, ...data, name } : company)));
    if (old.name !== name) {
      this.members.members.update((list) => list.map((m) => (m.company === old.name ? { ...m, company: name } : m)));
      this.projects.projects.update((list) => list.map((p) => (p.company === old.name ? { ...p, company: name } : p)));
    }
  }

  setActive(id: number, active: boolean) {
    const company = this.companies().find((c) => c.id === id);
    if (!company || company.active === active) return;
    this.companies.update((list) => list.map((c) => (c.id === id ? { ...c, active } : c)));
  }

  isNameTaken(name: string, exceptId: number | null) {
    const target = name.trim().toLowerCase();
    return this.companies().some((company) => company.id !== exceptId && company.name.toLowerCase() === target);
  }
}

// Reduz a imagem (lado maior até 800px, JPEG) antes de guardar, para não pesar a memória da página
export function compressImage(file: File, maxSize = 800): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(image.width * scale);
      canvas.height = Math.round(image.height * scale);
      canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Imagem inválida'));
    };
    image.src = url;
  });
}
