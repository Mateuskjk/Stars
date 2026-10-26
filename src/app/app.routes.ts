import { inject } from '@angular/core';
import { Router, Routes } from '@angular/router';
import { Home } from './home/home';

// A Home vem no pacote inicial; as outras páginas são baixadas só quando abertas (lazy loading),
// para o primeiro carregamento continuar leve conforme o sistema cresce.
// ponytail: rotas sem página (children: []); trocar por loadComponent quando cada tela existir
export const routes: Routes = [
  { path: '', component: Home },
  { path: 'dashboards', loadComponent: () => import('./dashboard/dashboards').then((m) => m.Dashboards) },
  {
    path: 'projetos',
    children: [
      // Endereço antigo do Dash de Projetos: agora é a aba Projetos dos Dashboards (mantém ?projeto=)
      {
        path: '',
        pathMatch: 'full',
        redirectTo: ({ queryParams }) => inject(Router).createUrlTree(['/dashboards'], { queryParams: { ...queryParams, aba: 'projetos' } }),
      },
      { path: 'visaoGeral', loadComponent: () => import('./projects/projects').then((m) => m.Projects) },
      { path: 'novo', loadComponent: () => import('./projects/project-create').then((m) => m.ProjectCreate) },
      { path: ':id', loadComponent: () => import('./projects/project-page').then((m) => m.ProjectPage) },
    ],
  },
  {
    path: 'workspace',
    children: [
      { path: 'work', loadComponent: () => import('./work/work').then((m) => m.Work) },
      { path: 'daily', loadComponent: () => import('./daily/daily').then((m) => m.Daily) },
      { path: 'backlog', loadComponent: () => import('./backlog/backlog').then((m) => m.Backlog) },
      { path: 'planning', loadComponent: () => import('./planning/planning').then((m) => m.Planning) },
      { path: 'notes', loadComponent: () => import('./notes/notes').then((m) => m.Notes) },
    ],
  },
  { path: 'empresas/:id/setores/:sectorId', loadComponent: () => import('./companies/sector-page').then((m) => m.SectorPage) },
  { path: 'empresas/:id', loadComponent: () => import('./companies/company-page').then((m) => m.CompanyPage) },
  { path: 'convite', loadComponent: () => import('./members/invite').then((m) => m.Invite) },
  {
    path: 'configuracoes',
    children: [
      { path: 'perfis-empresas', loadComponent: () => import('./companies/companies').then((m) => m.Companies) },
      { path: 'membros', loadComponent: () => import('./members/members').then((m) => m.Members) },
      { path: 'equipes', loadComponent: () => import('./teams/teams').then((m) => m.Teams) },
      { path: 'integracao-ia', loadComponent: () => import('./ai/ai-integration').then((m) => m.AiIntegration) },
    ],
  },
  { path: 'arquivo', loadComponent: () => import('./archive/archive').then((m) => m.Archive) },
  { path: 'conta', loadComponent: () => import('./account/account').then((m) => m.Account) },
  { path: 'perfis', children: [] },
  { path: 'api-publica', loadComponent: () => import('./api-docs/api-docs').then((m) => m.ApiDocs) },
];
