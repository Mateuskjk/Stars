// Cabeçalhos de segurança de todas as respostas. Os mesmos valores ficam no vercel.json (lá valem também para os
// arquivos estáticos, que a Vercel serve sem passar pelo Express); o teste security-headers.spec.ts confere os dois.

// Hash do único script inline (o que aplica o tema antes do primeiro desenho, em src/index.html).
// Mudou o script? O teste avisa e mostra o hash novo.
export const THEME_SCRIPT_HASH = 'sha256-dxjzlbaY9tBbGrm1M3zGtdkoVxQoTJSRZl8zQwyrbsQ=';

export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  `script-src 'self' '${THEME_SCRIPT_HASH}'`, // nenhum outro script inline nem de fora: um XSS não roda
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com", // estilos do Angular ([style], <style> dos componentes)
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:", // fotos (data:) e avatares de outros serviços
  "connect-src 'self'",
  "frame-src 'self' blob:", // visualizador de anexos
  "object-src 'none'",
  "base-uri 'self'",
  // Formulários só para o próprio site; o "Permitir" do MCP redireciona para o Claude (site ou Claude Code local)
  "form-action 'self' https://claude.ai https://claude.com http://localhost:* http://127.0.0.1:*",
  "frame-ancestors 'none'", // ninguém coloca o LexÁgile dentro de um iframe (clickjacking)
].join('; ');

export const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy': CONTENT_SECURITY_POLICY,
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
};
