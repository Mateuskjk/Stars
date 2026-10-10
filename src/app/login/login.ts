import { Component, DestroyRef, afterNextRender, inject, signal } from '@angular/core';
import { SessionStore } from '../api/session';
import { api } from '../api/http';

// Volta do "Entrar com o Google" com erro (o servidor redireciona para /?erro=google-…)
const GOOGLE_ERRORS: Record<string, string> = {
  'google-cancelado': 'O login com o Google foi cancelado.',
  'google-sem-conta': 'Essa conta do Google não tem acesso ao LexÁgile. Use o e-mail cadastrado no sistema ou fale com o administrador.',
  'google-desligado': 'O login com o Google ainda não foi configurado.',
  'google-falha': 'Não foi possível entrar com o Google. Tente de novo.',
};

// Slides de apresentação do painel da marca (cada um com a sua cor)
export const SLIDES = [
  {
    kicker: 'Sprints',
    title: 'Seu time, suas sprints e seus projetos no mesmo ritmo.',
    text: 'Planeje em sprints de 7 dias úteis e acompanhe tudo num lugar só.',
    color: '#7b5cf0',
  },
  {
    kicker: 'Kanbans',
    title: 'Do backlog ao finalizado, sem perder nada pelo caminho.',
    text: 'Refine na Planning, acompanhe no kanban do setor e veja quem está com o quê.',
    color: '#1baf7a',
  },
  {
    kicker: 'Previsibilidade',
    title: 'Saiba se a entrega chega no prazo antes de atrasar.',
    text: 'Burn-up, burn-down e Gantt mostram o ritmo real do time e a previsão de término.',
    color: '#2a78d6',
  },
  {
    kicker: 'Empresas',
    title: 'Cada empresa no seu espaço, com as regras dela.',
    text: 'Setores, equipes e visibilidade separados por empresa — cada pessoa vê o que deve ver.',
    color: '#eb6834',
  },
  {
    kicker: 'Assistente',
    title: 'Uma IA que entende o trabalho do seu time.',
    text: 'Peça uma análise das sprints e receba sugestões de melhoria em segundos.',
    color: '#d6457f',
  },
];

const SLIDE_MS = 6000;

// Tela de entrada: e-mail e senha do sistema atual (tabela de usuários do banco) ou conta do Google
@Component({
  selector: 'app-login',
  templateUrl: './login.html',
})
export class Login {
  protected readonly session = inject(SessionStore);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly showPassword = signal(false);
  protected readonly google = signal(false);

  // ---------- Slides ----------
  protected readonly slides = SLIDES;
  protected readonly current = signal(0);
  protected readonly paused = signal(false); // mouse em cima ou foco do teclado no painel

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const erro = new URLSearchParams(location.search).get('erro');
      if (erro && GOOGLE_ERRORS[erro]) {
        this.error.set(GOOGLE_ERRORS[erro]);
        history.replaceState(null, '', location.pathname); // tira o erro da barra de endereço
      }
      api<{ google: boolean }>('/auth/providers')
        .then((p) => this.google.set(p.google))
        .catch(() => undefined);

      // Avança sozinho, menos para quem pediu ao sistema para reduzir movimento
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      const timer = setInterval(() => {
        if (!this.paused() && document.visibilityState === 'visible') this.next();
      }, SLIDE_MS);
      destroyRef.onDestroy(() => clearInterval(timer));
    });
  }

  protected next() {
    this.current.update((i) => (i + 1) % this.slides.length);
  }

  protected goTo(index: number) {
    this.current.set(index);
  }

  protected async submit(event: Event) {
    event.preventDefault();
    const form = event.target as HTMLFormElement;
    const data = new FormData(form);
    this.busy.set(true);
    this.error.set('');
    try {
      await this.session.login(String(data.get('email')), String(data.get('senha')));
      if (this.session.status() !== 'in') this.error.set(this.session.error() || 'Não foi possível entrar.');
    } catch (e) {
      this.error.set((e as Error).message);
    } finally {
      this.busy.set(false);
    }
  }
}
