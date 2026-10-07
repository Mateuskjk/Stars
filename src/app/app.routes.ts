import { Routes } from '@angular/router';
import { Chat } from './chat/chat';
import { Dashboard } from './dashboard/dashboard';
import { Home } from './home/home';
import { ProjectCreate } from './projects/project-create';
import { Projects } from './projects/projects';

// ponytail: rotas sem página (children: []); trocar por component/loadComponent quando cada tela existir
export const routes: Routes = [
  { path: '', component: Home },
  { path: 'dashboards', component: Dashboard },
  { path: 'conversas', component: Chat },
  { path: 'projetos', component: Projects },
  { path: 'projetos/novo', component: ProjectCreate },
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
