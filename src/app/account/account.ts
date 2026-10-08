import { Component, ElementRef, afterNextRender, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { compressImage } from '../companies/company-store';
import { AccountStore, DEFAULT_ACCOUNT, NOTIFICATION_TYPES, NotificationType, greetingFor, hourIn } from './account-store';

type Profile = Pick<typeof DEFAULT_ACCOUNT, 'fullName' | 'displayName' | 'email' | 'phone' | 'jobTitle' | 'bio' | 'photo'>;

const pickProfile = ({ fullName, displayName, email, phone, jobTitle, bio, photo }: Profile): Profile => ({
  fullName,
  displayName,
  email,
  phone,
  jobTitle,
  bio,
  photo,
});

@Component({
  selector: 'app-account',
  templateUrl: './account.html',
  host: { class: 'account' },
})
export class Account {
  protected readonly store = inject(AccountStore);
  protected readonly notificationTypes = NOTIFICATION_TYPES;
  protected readonly timeZones = Intl.supportedValuesOf('timeZone');
  protected readonly browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  // ---------- Perfil (com botão Salvar) ----------
  protected readonly draft = signal<Profile>(pickProfile(DEFAULT_ACCOUNT));
  protected readonly saved = signal(false);
  protected readonly photoError = signal('');
  protected readonly dirty = computed(() => JSON.stringify(this.draft()) !== JSON.stringify(pickProfile(this.store.account())));

  constructor() {
    afterNextRender(() => this.store.load());
    // Quando a conta carrega (ou é restaurada), o formulário acompanha
    effect(() => {
      const profile = pickProfile(this.store.account());
      untracked(() => this.draft.set(profile));
    });
  }

  protected patch(changes: Partial<Profile>) {
    this.draft.update((draft) => ({ ...draft, ...changes }));
    this.saved.set(false);
  }

  protected async onPhoto(input: HTMLInputElement) {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) return this.photoError.set('Escolha um arquivo de imagem.');
    try {
      this.photoError.set('');
      this.patch({ photo: await compressImage(file, 256) }); // foto de perfil pequena basta
    } catch {
      this.photoError.set('Não foi possível ler essa imagem.');
    }
  }

  protected saveProfile(event: Event) {
    event.preventDefault();
    const draft = this.draft();
    this.store.update({ ...draft, fullName: draft.fullName.trim(), displayName: draft.displayName.trim(), email: draft.email.trim() });
    this.saved.set(true);
  }

  protected discard() {
    this.draft.set(pickProfile(this.store.account()));
  }

  protected initialsOf(name: string) {
    const words = name.trim().split(' ').filter(Boolean);
    return (words.length > 1 ? words[0][0] + words.at(-1)![0] : name.trim().slice(0, 2) || '?').toUpperCase();
  }

  // ---------- Preferências (salvam na hora) ----------
  protected readonly preview = computed(() => {
    const zone = this.store.timeZone();
    const now = new Date();
    return {
      time: now.toLocaleTimeString('pt-BR', { timeZone: zone, hour: '2-digit', minute: '2-digit' }),
      greeting: greetingFor(hourIn(zone, now)),
    };
  });

  protected zoneLabel(zone: string) {
    return zone.replaceAll('_', ' ');
  }

  protected setType(type: NotificationType, on: boolean) {
    this.store.updateNotifications({ types: { ...this.store.account().notifications.types, [type]: on } });
  }

  // ---------- Restaurar padrões ----------
  private readonly confirmDialog = viewChild.required<ElementRef<HTMLDialogElement>>('confirmDialog');

  protected askReset() {
    this.confirmDialog().nativeElement.showModal();
  }

  protected confirmReset() {
    this.store.reset();
    this.saved.set(false);
    this.confirmDialog().nativeElement.close();
  }

  protected cancelReset() {
    this.confirmDialog().nativeElement.close();
  }

  protected closeOnBackdrop(event: MouseEvent, dialog: HTMLDialogElement) {
    if (event.target === dialog) dialog.close();
  }
}
