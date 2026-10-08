import { TestBed } from '@angular/core/testing';
import { BacklogStore } from '../backlog/backlog-store';
import { Planning } from './planning';
import { SprintStore } from './sprint-store';

// jsdom não implementa showModal/close do <dialog>
HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
  this.open = true;
};
HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
  this.open = false;
};

describe('Planning', () => {
  it('splits refined activities, sends to the sprint and handles the sprint lifecycle', async () => {
    await TestBed.configureTestingModule({ imports: [Planning] }).compileComponents();
    const backlog = TestBed.inject(BacklogStore);
    const sprints = TestBed.inject(SprintStore);
    const fixture = TestBed.createComponent(Planning);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const names = (group: number) =>
      [...el.querySelectorAll('.planning__group')[group].querySelectorAll('tbody th')].map((th) => th.textContent!.trim());
    const rowButton = (group: number, name: string, label: string) => {
      const row = [...el.querySelectorAll('.planning__group')[group].querySelectorAll('tbody tr')].find((tr) => tr.textContent!.includes(name))!;
      [...row.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent!.includes(label))!.click();
      fixture.detectChanges();
    };
    const confirm = () => {
      el.querySelector<HTMLElement>('dialog.confirm-dialog .confirm-dialog__button:last-child')!.click();
      fixture.detectChanges();
    };

    // Só "Finalizado refinamento", separado em prontas (padrão) e aguardando
    expect(names(0)).toEqual(['Rotina de backup dos arquivos', 'Template de relatório mensal']);
    expect(names(1)).toEqual(['Treinamento de segurança']);
    expect(el.querySelector('.planning__sprint-label')?.textContent).toContain('Sprint 12');

    // Mudar categoria pelo select
    const select = el.querySelector<HTMLSelectElement>('.planning__group select')!;
    select.value = 'waiting';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(names(1)).toContain('Rotina de backup dos arquivos');

    // Enviar para a sprint ativa
    rowButton(0, 'Template de relatório mensal', 'Enviar para sprint');
    expect(names(2)).toContain('Template de relatório mensal');

    // Cancelar a sprint devolve as atividades para "Prontas"
    el.querySelector<HTMLElement>('.planning__sprint-actions .modal__ghost')!.click();
    fixture.detectChanges();
    confirm();
    expect(sprints.active()).toBeNull();
    expect(names(0)).toEqual(expect.arrayContaining(['Template de relatório mensal', 'Automatizar convites da daily']));
    expect(el.querySelector<HTMLButtonElement>('.planning__group button.modal__primary')!.disabled).toBe(true); // sem sprint, não envia

    // Criar a próxima sprint
    el.querySelector<HTMLElement>('.planning__sprint-actions .modal__primary')!.click();
    fixture.detectChanges();
    el.querySelector('dialog.planning__dialog form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    fixture.detectChanges();
    expect(sprints.active()?.name).toBe('Sprint 13');

    // Arquivar uma atividade tira ela da planning
    rowButton(0, 'Template de relatório mensal', 'Arquivar');
    expect(backlog.items().find((i) => i.name === 'Template de relatório mensal')?.status).toBe('archived');
  });
});
