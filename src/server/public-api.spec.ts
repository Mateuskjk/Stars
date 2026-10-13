import { ENDPOINTS, hashToken, openApiSpec, rateLimited } from './public-api';

describe('public API (server)', () => {
  it('stores only a SHA-256 hash of tokens', () => {
    const hash = hashToken('stars_' + 'a'.repeat(48));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain('stars_');
  });

  it('limits each token to 60 requests per minute', async () => {
    const key = 'teste-' + Math.random();
    for (let i = 0; i < 60; i++) expect(await rateLimited(key)).toBe(false);
    expect(await rateLimited(key)).toBe(true);
    expect(await rateLimited('outro-' + Math.random())).toBe(false); // cada token tem o seu limite
  });

  it('generates a valid OpenAPI 3 spec with bearer auth for every endpoint', () => {
    const spec = openApiSpec('http://localhost:4200/api/v1') as any;
    expect(spec.openapi).toBe('3.0.3');
    expect(spec.components.securitySchemes.bearerAuth).toMatchObject({ type: 'http', scheme: 'bearer' });
    expect(Object.keys(spec.paths)).toEqual(ENDPOINTS.map((e) => e.path));
    expect(spec.paths['/projects/{id}'].get.parameters[0]).toMatchObject({ name: 'id', in: 'path', required: true });
    expect(spec.paths['/activities'].get.responses['403']).toBeDefined();
  });
});
