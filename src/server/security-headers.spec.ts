import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { SECURITY_HEADERS, THEME_SCRIPT_HASH } from './security-headers';

describe('security headers', () => {
  it('allows exactly the inline theme script of src/index.html (and no other inline script)', () => {
    const html = readFileSync('src/index.html', 'utf8');
    const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    expect(inline).toHaveLength(1);
    const hash = 'sha256-' + createHash('sha256').update(inline[0].replace(/\r\n/g, '\n')).digest('base64');
    expect(hash, 'atualize THEME_SCRIPT_HASH em security-headers.ts').toBe(THEME_SCRIPT_HASH);
  });

  it('vercel.json sends the same headers to static files', () => {
    const vercel = JSON.parse(readFileSync('vercel.json', 'utf8'));
    const all = vercel.headers.find((h: { source: string }) => h.source === '/(.*)');
    const fromVercel = Object.fromEntries(all.headers.map((h: { key: string; value: string }) => [h.key, h.value]));
    expect(fromVercel).toEqual(SECURITY_HEADERS);
  });
});
