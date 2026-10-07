import { Routes } from '@angular/router';
import { Home } from './home/home';

// ponytail: rotas sem página (children: []); trocar por component/loadComponent quando cada tela existir
export const routes: Routes = [
  { path: '', component: Home },
  { path: 'dashboards', children: [] },
  { path: 'conversas', children: [] },
  { path: 'projetos', children: [] },
  {
    path: 'workspace',
    children: [
      { path: 'daily', children: [] },
      { path: 'backlog', children: [] },
      { path: 'planning', children: [] },
      { path: 'notes', children: [] },
      { path: 'favorites', children: [] },
      { path: 'brain', children: [] },
    ],
  },
  { path: 'configuracoes', children: [] },
  { path: 'conta', children: [] },
  { path: 'perfis', children: [] },
  { path: 'api-publica', children: [] },
  { path: 'erros-navegador', children: [] },
];
