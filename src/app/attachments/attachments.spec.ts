import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Attachments } from './attachments';

@Component({ imports: [Attachments], template: `<app-attachments [activityId]="id()" />` })
class Host {
  readonly id = signal<string | null>(null);
}

const tick = () => new Promise((resolve) => setTimeout(resolve));

describe('Attachments', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('lists, uploads to the database, refuses files over 4 MB and removes', async () => {
    const calls: { url: string; method: string; headers?: Record<string, string> }[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
      calls.push({ url, method: init.method ?? 'GET', headers: init.headers as Record<string, string> });
      if (init.method === 'POST') return Response.json({ id: 'x2', nome: 'novo.pdf', mime: 'application/pdf', tamanho: 3, criadoEm: '', autor: 'Eu' }, { status: 201 });
      if (init.method === 'DELETE') return new Response(null, { status: 204 });
      return Response.json([{ id: 'x1', nome: 'contrato.pdf', mime: 'application/pdf', tamanho: 2048, criadoEm: '', autor: 'Ana' }]);
    });
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Salve a atividade para anexar arquivos.');

    fixture.componentInstance.id.set('ativ-1');
    fixture.detectChanges();
    await tick();
    fixture.detectChanges();
    expect(calls[0]).toMatchObject({ url: '/api/data/atividades/ativ-1/anexos', method: 'GET' });
    expect(el.querySelector('.attachment__name')?.textContent).toBe('contrato.pdf');

    // Envia o arquivo cru com o nome no cabeçalho; o grande demais nem sai do navegador
    const input = el.querySelector<HTMLInputElement>('input[type="file"]')!;
    const small = new File(['abc'], 'novo.pdf', { type: 'application/pdf' });
    const big = new File([new Uint8Array(4 * 1024 * 1024 + 1)], 'grande.pdf', { type: 'application/pdf' });
    Object.defineProperty(input, 'files', { value: [small, big], configurable: true });
    input.dispatchEvent(new Event('change'));
    await tick();
    fixture.detectChanges();
    const posts = calls.filter((c) => c.method === 'POST');
    expect(posts).toHaveLength(1);
    expect(posts[0].headers!['x-file-name']).toBe('novo.pdf');
    expect([...el.querySelectorAll('.attachment__name')].map((n) => n.textContent)).toEqual(['contrato.pdf', 'novo.pdf']);
    expect(el.textContent).toContain('grande.pdf: maior que 4 MB.');

    el.querySelectorAll<HTMLButtonElement>('.attachment__link')[1].click(); // Remover o primeiro
    await tick();
    fixture.detectChanges();
    expect(calls.at(-1)).toMatchObject({ url: '/api/data/anexos/x1', method: 'DELETE' });
    expect([...el.querySelectorAll('.attachment__name')].map((n) => n.textContent)).toEqual(['novo.pdf']);
  });

  it('turns a pasted screenshot into an attachment only while its modal is open', async () => {
    const posts: Record<string, string>[] = [];
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit = {}) => {
      if (init.method === 'POST') {
        posts.push(init.headers as Record<string, string>);
        return Response.json({ id: 'p1', nome: 'print.png', mime: 'image/png', tamanho: 3, criadoEm: '', autor: 'Eu' }, { status: 201 });
      }
      return Response.json([]);
    });
    const dialog = document.createElement('dialog');
    document.body.append(dialog);
    const fixture = TestBed.createComponent(Host);
    dialog.append(fixture.nativeElement);
    fixture.componentInstance.id.set('ativ-1');
    fixture.detectChanges();
    await tick();
    const paste = (files: File[]) => {
      const event = new Event('paste', { cancelable: true }) as ClipboardEvent;
      Object.defineProperty(event, 'clipboardData', { value: { files } });
      window.dispatchEvent(event);
      return event;
    };
    const shot = new File(['png'], 'image.png', { type: 'image/png' });

    paste([shot]); // modal fechado: ignora
    await tick();
    expect(posts).toHaveLength(0);

    dialog.open = true;
    expect(paste([new File(['txt'], 'a.txt', { type: 'text/plain' })]).defaultPrevented).toBe(false); // não é imagem: segue normal
    const event = paste([shot]);
    expect(event.defaultPrevented).toBe(true);
    await tick();
    expect(posts).toHaveLength(1);
    expect(posts[0]['content-type']).toBe('image/png');
    expect(posts[0]['x-file-name']).toMatch(/^print-.+.png$/);
    dialog.remove();
  });
});
