import { signal } from '@angular/core';

export type ErrorKind = 'js' | 'promise' | 'console-error' | 'console-warn' | 'resource' | 'network' | 'csp';

export const ERROR_KINDS: Record<ErrorKind, { label: string; color: string }> = {
  js: { label: 'Erro de JavaScript', color: '#d03b3b' },
  promise: { label: 'Promise rejeitada', color: '#eb6834' },
  'console-error': { label: 'console.error', color: '#b42f2f' },
  'console-warn': { label: 'console.warn', color: '#eda100' },
  resource: { label: 'Arquivo não carregou', color: '#9b7be0' },
  network: { label: 'Falha de rede', color: '#2a78d6' },
  csp: { label: 'Bloqueio de segurança', color: '#52514e' },
};

export interface BrowserError {
  id: string;
  kind: ErrorKind;
  message: string;
  source: string; // arquivo:linha:coluna ou URL
  stack: string;
  page: string; // tela onde aconteceu
  firstAt: string;
  lastAt: string;
  count: number; // erros iguais são agrupados
}

const KEY = 'stars.browser-errors';
const LIMIT = 300;

// Fica fora do Angular para começar a capturar antes do app subir (chamado no main.ts)
export const browserErrors = signal<BrowserError[]>([]);

// Tokens e senhas não podem ficar no registro
export function redact(text: string) {
  return text
    .replace(/stars_[0-9a-f]{48}/gi, 'stars_••••')
    .replace(/whsec_[0-9a-f]{20,}/gi, 'whsec_••••')
    .replace(/(Bearer\s+)[\w.\-~+/]+=*/gi, '$1••••')
    // só no formato chave: valor / chave=valor (texto comum como "Token inválido" fica como está)
    .replace(/((?:password|senha|token|api[_-]?key|secret)["']?\s*[:=]\s*["']?)[^\s"',}]+/gi, '$1••••');
}

function describe(value: unknown): { message: string; stack: string } {
  if (value instanceof Error) return { message: `${value.name}: ${value.message}`, stack: value.stack ?? '' };
  if (typeof value === 'string') return { message: value, stack: '' };
  try {
    return { message: JSON.stringify(value), stack: '' };
  } catch {
    return { message: String(value), stack: '' };
  }
}

// Registra (ou soma no grupo igual já existente)
export function record(kind: ErrorKind, message: string, source = '', stack = '', now = new Date()) {
  const clean = redact(message).slice(0, 2000);
  const page = typeof location !== 'undefined' ? location.pathname : '';
  const at = now.toISOString();
  const list = browserErrors();
  // O Angular também manda os erros que trata para o console.error: não conta o mesmo erro duas vezes
  const twin = kind === 'console-error' && list.find((e) => (e.kind === 'js' || e.kind === 'promise') && clean.includes(e.message) && now.getTime() - Date.parse(e.lastAt) < 2000);
  if (twin) return;
  const same = list.find((e) => e.kind === kind && e.message === clean && e.source === source);
  if (same) {
    browserErrors.set(list.map((e) => (e === same ? { ...e, count: e.count + 1, lastAt: at, page } : e)));
  } else {
    const entry: BrowserError = { id: crypto.randomUUID(), kind, message: clean, source: redact(source), stack: redact(stack).slice(0, 8000), page, firstAt: at, lastAt: at, count: 1 };
    browserErrors.set([entry, ...list].slice(0, LIMIT));
  }
  persist();
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(browserErrors()));
    } catch {
      // sem armazenamento: vale só nesta sessão
    }
  }, 300);
}

export function clearBrowserErrors() {
  browserErrors.set([]);
  try {
    localStorage.removeItem(KEY);
  } catch {
    // nada a fazer
  }
}

let installed = false;

// Liga a captura. Só no navegador; chamado uma vez, o mais cedo possível.
export function installErrorCapture() {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    if (Array.isArray(saved)) browserErrors.set(saved);
  } catch {
    // ignora registro antigo corrompido
  }

  // Erros de JavaScript e arquivos que não carregaram (fase de captura pega <img>, <script>, <link>)
  window.addEventListener(
    'error',
    (event: Event) => {
      if (event instanceof ErrorEvent) {
        const { message, stack } = event.error ? describe(event.error) : { message: event.message, stack: '' };
        record('js', message || 'Erro de script', event.filename ? `${event.filename}:${event.lineno}:${event.colno}` : '', stack);
        return;
      }
      const target = event.target as (HTMLElement & { src?: string; href?: string }) | null;
      if (target && target !== (window as unknown)) {
        const url = target.src || target.href || '';
        record('resource', `<${target.tagName.toLowerCase()}> não carregou`, url);
      }
    },
    true,
  );

  window.addEventListener('unhandledrejection', (event) => {
    const { message, stack } = describe((event as PromiseRejectionEvent).reason);
    record('promise', message || 'Promise rejeitada sem motivo', '', stack);
  });

  window.addEventListener('securitypolicyviolation', (event) => {
    record('csp', `Bloqueado pela política de segurança (${event.violatedDirective})`, event.blockedURI || event.sourceFile || '');
  });

  // console.error / console.warn: registra e continua mostrando no console normalmente
  for (const [method, kind] of [
    ['error', 'console-error'],
    ['warn', 'console-warn'],
  ] as const) {
    const original = console[method].bind(console);
    console[method] = (...args: unknown[]) => {
      try {
        const error = args.find((a) => a instanceof Error) as Error | undefined;
        record(kind, args.map((a) => describe(a).message).join(' '), '', error?.stack ?? '');
      } catch {
        // registrar nunca pode quebrar o console
      }
      original(...args);
    };
  }

  // Requisições com falha (o navegador só mostra "Failed to load resource" no console)
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (...args: Parameters<typeof fetch>) => {
    const [input, init] = args;
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    try {
      const response = await originalFetch(...args);
      if (response.status >= 400) record('network', `${method} → HTTP ${response.status} ${response.statusText}`.trim(), url);
      return response;
    } catch (error) {
      record('network', `${method} → sem resposta (${describe(error).message})`, url);
      throw error;
    }
  };
}
