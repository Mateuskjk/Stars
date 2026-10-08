import { Routes } from '@angular/router';
import { Home } from './home/home';

// A Home vem no pacote inicial; as outras páginas são baixadas só quando abertas (lazy loading),
// para o primeiro carregamento continuar leve conforme o sistema cresce.
// ponytail: rotas sem página (children: []); trocar por loadComponent quando cada tela existir
export const routes: Routes = [
  { path: '', component: Home },
  { path: 'dashboards', loadComponent: () => import('./dashboard/dashboard').then((m) => m.Dashboard) },
  { path: 'conversas', loadComponent: () => import('./chat/chat').then((m) => m.Chat) },
  { path: 'projetos', loadComponent: () => import('./projects/projects').then((m) => m.Projects) },
  { path: 'projetos/novo', loadComponent: () => import('./projects/project-create').then((m) => m.ProjectCreate) },
  {
    path: 'workspace',
    children: [
      { path: 'daily', loadComponent: () => import('./daily/daily').then((m) => m.Daily) },
      { path: 'backlog', loadComponent: () => import('./backlog/backlog').then((m) => m.Backlog) },
      { path: 'planning', loadComponent: () => import('./planning/planning').then((m) => m.Planning) },
      { path: 'notes', loadComponent: () => import('./notes/notes').then((m) => m.Notes) },
      { path: 'favorites', loadComponent: () => import('./favorites/favorites').then((m) => m.Favorites) },
      { path: 'brain', loadComponent: () => import('./brain/brain').then((m) => m.Brain) },
    ],
  },
  { path: 'convite', loadComponent: () => import('./members/invite').then((m) => m.Invite) },
  {
    path: 'configuracoes',
    children: [
      { path: 'perfis-empresas', loadComponent: () => import('./companies/companies').then((m) => m.Companies) },
      { path: 'membros', loadComponent: () => import('./members/members').then((m) => m.Members) },
      { path: 'equipes', loadComponent: () => import('./teams/teams').then((m) => m.Teams) },
      { path: 'integracao-ia', children: [] },
      { path: 'relatorios', children: [] },
      { path: 'auditorias', children: [] },
      { path: 'integracoes', children: [] },
    ],
  },
  { path: 'conta', children: [] },
  { path: 'perfis', children: [] },
  { path: 'api-publica', children: [] },
  { path: 'erros-navegador', children: [] },
];
