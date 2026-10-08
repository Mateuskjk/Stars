import { RenderMode, ServerRoute } from '@angular/ssr';

export const serverRoutes: ServerRoute[] = [
  // Página de cada projeto: o id só existe no navegador (projetos ficam em memória), então não dá para pré-gerar
  { path: 'projetos/:id', renderMode: RenderMode.Client },
  {
    path: '**',
    renderMode: RenderMode.Prerender
  }
];
