import { Routes } from '@angular/router';
import { Backlog } from './backlog/backlog';
import { Chat } from './chat/chat';
import { Daily } from './daily/daily';
import { Dashboard } from './dashboard/dashboard';
import { Home } from './home/home';
import { ProjectCreate } from './projects/project-create';
import { Notes } from './notes/notes';
import { Planning } from './planning/planning';
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
      { path: 'daily', component: Daily },
      { path: 'backlog', component: Backlog },
      { path: 'planning', component: Planning },
      { path: 'notes', component: Notes },
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
