// Servidor do LexÁgile (API + páginas com SSR) rodando como função da Vercel.
// Reaproveita o servidor que o `ng build` gera; os arquivos estáticos a Vercel serve direto (vercel.json).
export default async function handler(req, res) {
  const { reqHandler } = await import('../dist/Stars/server/server.mjs');
  return reqHandler(req, res);
}
