import { browserErrors, clearBrowserErrors, installErrorCapture, record, redact } from './browser-errors';

describe('browser error capture', () => {
  beforeAll(() => installErrorCapture());
  beforeEach(() => clearBrowserErrors());

  it('captures JS errors, unhandled rejections and console.error/warn', () => {
    const error = new TypeError('x is undefined');
    window.dispatchEvent(new ErrorEvent('error', { message: error.message, error, filename: 'main.js', lineno: 10, colno: 5 }));
    window.dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason: new Error('falhou ao salvar') }));
    console.error('algo deu errado', { codigo: 42 });
    console.warn('cuidado');

    const byKind = Object.fromEntries(browserErrors().map((e) => [e.kind, e]));
    expect(byKind['js']).toMatchObject({ message: 'TypeError: x is undefined', source: 'main.js:10:5' });
    expect(byKind['promise'].message).toBe('Error: falhou ao salvar');
    expect(byKind['console-error'].message).toBe('algo deu errado {"codigo":42}');
    expect(byKind['console-warn'].message).toBe('cuidado');
  });

  it('groups repeated errors with a counter', () => {
    record('js', 'Boom', 'a.js:1:1');
    record('js', 'Boom', 'a.js:1:1');
    record('js', 'Boom', 'b.js:1:1');
    expect(browserErrors().map((e) => [e.source, e.count])).toEqual([
      ['b.js:1:1', 1],
      ['a.js:1:1', 2],
    ]);
  });

  it('masks tokens and secrets', () => {
    expect(redact('token stars_' + 'a'.repeat(48) + ' falhou')).toBe('token stars_•••• falhou');
    expect(redact('Authorization: Bearer abc.def-123')).toBe('Authorization: Bearer ••••');
    expect(redact('{"password":"hunter2","x":1}')).toBe('{"password":"••••","x":1}');
    expect(redact('senha=abc123 e token: xyz')).toBe('senha=•••• e token: ••••');
    expect(redact('Token inválido')).toBe('Token inválido'); // texto comum não é mascarado
  });
});
