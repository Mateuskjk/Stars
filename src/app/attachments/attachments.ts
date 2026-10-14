import { Component, ElementRef, computed, effect, inject, input, signal, viewChild } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { api } from '../api/http';

export interface AttachmentFile {
  id: string;
  nome: string;
  mime: string;
  tamanho: number;
  criadoEm: string;
  autor: string | null;
}

export const MAX_FILE = 4 * 1024 * 1024; // o mesmo limite do servidor (a Vercel recusa pedidos maiores)
// Só estes abrem na tela; o resto (inclusive SVG e HTML, que poderiam rodar script) só baixa
const VIEWABLE = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf'];

// Anexos de uma atividade (geral ou de projeto), gravados no banco na hora: os mesmos do sistema atual.
@Component({
  selector: 'app-attachments',
  templateUrl: './attachments.html',
  host: { '(window:paste)': 'onPaste($event)' },
})
export class Attachments {
  readonly activityId = input<string | null>(null); // id da atividade no banco (null = ainda não salva)

  protected readonly files = signal<AttachmentFile[]>([]);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  private readonly sanitizer = inject(DomSanitizer);
  private readonly host = inject(ElementRef<HTMLElement>);

  constructor() {
    effect(() => {
      const id = this.activityId();
      this.files.set([]);
      this.error.set('');
      if (id) void this.load(id);
    });
  }

  private url = (id: string) => `/data/atividades/${encodeURIComponent(id)}/anexos`;

  private async load(id: string) {
    try {
      const files = await api<AttachmentFile[]>(this.url(id));
      if (this.activityId() === id) this.files.set(files);
    } catch (error) {
      this.error.set((error as Error).message);
    }
  }

  protected add(input: HTMLInputElement) {
    const chosen = [...(input.files ?? [])];
    input.value = '';
    void this.upload(chosen);
  }

  // Ctrl+V com um print (ou imagem copiada) enquanto o modal desta atividade está aberto vira anexo.
  // Texto colado continua indo para o campo normalmente.
  protected onPaste(event: ClipboardEvent) {
    const dialog = (this.host.nativeElement as HTMLElement).closest('dialog');
    if (!dialog?.open || !this.activityId()) return;
    const images = [...(event.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'));
    if (!images.length) return;
    event.preventDefault();
    const stamp = new Date().toLocaleString('sv-SE').replace(' ', '_').replaceAll(':', '-'); // 2026-10-14_15-30-00
    void this.upload(images.map((f, i) => new File([f], `print-${stamp}${images.length > 1 ? `-${i + 1}` : ''}.${f.type.split('/')[1] || 'png'}`, { type: f.type })));
  }

  private async upload(chosen: File[]) {
    const id = this.activityId();
    if (!id || !chosen.length) return;
    this.error.set('');
    this.busy.set(true);
    try {
      for (const file of chosen) {
        if (file.size > MAX_FILE) {
          this.error.set(`${file.name}: maior que 4 MB.`);
          continue;
        }
        const response = await fetch(`/api${this.url(id)}`, {
          method: 'POST',
          headers: { 'content-type': file.type || 'application/octet-stream', 'x-file-name': encodeURIComponent(file.name) },
          body: file,
        });
        const body = await response.json().catch(() => null);
        if (!response.ok) this.error.set(`${file.name}: ${body?.error ?? 'não foi possível anexar.'}`);
        else this.files.update((list) => [...list, body as AttachmentFile]);
      }
    } finally {
      this.busy.set(false);
    }
  }

  protected async remove(file: AttachmentFile) {
    try {
      await api(`/data/anexos/${encodeURIComponent(file.id)}`, { method: 'DELETE' });
      this.files.update((list) => list.filter((f) => f.id !== file.id));
    } catch (error) {
      this.error.set((error as Error).message);
    }
  }

  // O servidor manda sempre como download; aqui vira um arquivo local, com o tipo só se for de pré-visualização segura
  private async blobUrl(file: AttachmentFile) {
    const response = await fetch(`/api/data/anexos/${encodeURIComponent(file.id)}`);
    if (!response.ok) throw new Error('Não foi possível abrir o anexo.');
    const type = VIEWABLE.includes(file.mime) ? file.mime : 'application/octet-stream';
    return URL.createObjectURL(new Blob([await response.arrayBuffer()], { type }));
  }

  protected async download(file: AttachmentFile) {
    try {
      const url = await this.blobUrl(file);
      const link = document.createElement('a');
      link.href = url;
      link.download = file.nome;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (error) {
      this.error.set((error as Error).message);
    }
  }

  protected viewable(file: AttachmentFile) {
    return VIEWABLE.includes(file.mime);
  }

  protected kind(file: AttachmentFile) {
    if (file.mime === 'application/pdf') return 'PDF';
    if (file.mime.startsWith('image/')) return 'IMG';
    return (file.nome.split('.').pop() ?? '').slice(0, 4).toUpperCase() || 'ARQ';
  }

  protected size(bytes: number) {
    return bytes < 1_048_576 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1_048_576).toFixed(1)} MB`;
  }

  // ---------- Visualizador ----------
  private readonly viewer = viewChild.required<ElementRef<HTMLDialogElement>>('viewer');
  protected readonly viewing = signal<{ file: AttachmentFile; url: string } | null>(null);
  // O object URL foi criado aqui, de um tipo seguro: pode ir no iframe do PDF
  protected readonly viewingUrl = computed(() => {
    const v = this.viewing();
    return v ? this.sanitizer.bypassSecurityTrustResourceUrl(v.url) : null;
  });

  protected async view(file: AttachmentFile) {
    if (!this.viewable(file)) return void this.download(file);
    try {
      this.viewing.set({ file, url: await this.blobUrl(file) });
      this.viewer().nativeElement.showModal();
    } catch (error) {
      this.error.set((error as Error).message);
    }
  }

  protected closeViewer() {
    this.viewer().nativeElement.close();
  }

  protected onViewerClose() {
    const v = this.viewing();
    if (v) URL.revokeObjectURL(v.url);
    this.viewing.set(null);
  }

  protected closeOnBackdrop(event: MouseEvent) {
    if (event.target === this.viewer().nativeElement) this.closeViewer();
  }
}
