// Para onde o login do MCP pode devolver o acesso: Claude, Claude Code (local) e só os endereços EXATOS liberados.
import type { Response } from 'express';
import { allowedRedirect, sendBack } from './mcp-oauth';

describe('allowedRedirect', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('aceita o Claude e o Claude Code; recusa qualquer outro site', () => {
    expect(allowedRedirect('https://claude.ai/api/mcp/auth_callback')).toBe(true);
    expect(allowedRedirect('http://localhost:33418/callback')).toBe(true);
    expect(allowedRedirect('https://n8n.empresa.com.br/rest/oauth2-credential/callback')).toBe(false);
    expect(allowedRedirect('http://localhost:1/cb#x')).toBe(false);
  });

  it('libera só o endereço exato e https de LEXAGILE_OAUTH_REDIRECTS', () => {
    vi.stubEnv('LEXAGILE_OAUTH_REDIRECTS', ' https://n8n.empresa.com.br/rest/oauth2-credential/callback , http://inseguro.com/cb');
    expect(allowedRedirect('https://n8n.empresa.com.br/rest/oauth2-credential/callback')).toBe(true);
    expect(allowedRedirect('https://n8n.empresa.com.br/rest/oauth2-credential/callback/../x')).toBe(false);
    expect(allowedRedirect('https://n8n.empresa.com.br.atacante.com/rest/oauth2-credential/callback')).toBe(false);
    expect(allowedRedirect('http://inseguro.com/cb')).toBe(false); // sem https não entra
  });
});

describe('sendBack', () => {
  afterEach(() => vi.unstubAllEnvs());
  const fakeRes = () => {
    const res = { redirect: vi.fn(), send: vi.fn(), set: () => res, type: () => res };
    return res;
  };

  it('Claude: redirect 303; endereço liberado (n8n): página que segue sozinha (o form-action do site barraria o redirect)', () => {
    vi.stubEnv('LEXAGILE_OAUTH_REDIRECTS', 'https://n8n.empresa.com.br/rest/oauth2-credential/callback');
    const claude = fakeRes();
    sendBack(claude as unknown as Response, new URL('https://claude.ai/api/mcp/auth_callback?code=abc'));
    expect(claude.redirect).toHaveBeenCalledWith(303, 'https://claude.ai/api/mcp/auth_callback?code=abc');

    const n8n = fakeRes();
    sendBack(n8n as unknown as Response, new URL('https://n8n.empresa.com.br/rest/oauth2-credential/callback?code=a"b&state=x'));
    expect(n8n.redirect).not.toHaveBeenCalled();
    const html = n8n.send.mock.calls[0][0] as string;
    expect(html).toContain('http-equiv="refresh" content="0;url=https://n8n.empresa.com.br/rest/oauth2-credential/callback?code=a%22b&#38;state=x"');
  });
});
