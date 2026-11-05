// Envio de e-mail (SMTP) — roda SOMENTE no servidor. Configuração nas variáveis SMTP_* do .env / da Vercel.
import nodemailer, { Transporter } from 'nodemailer';

export interface Mail {
  to: string;
  subject: string;
  html: string;
  text: string;
}

let transport: Transporter | null = null;

export const mailConfigured = () => !!(process.env['SMTP_HOST'] && process.env['SMTP_FROM']);

function transporter() {
  if (!transport) {
    const port = Number(process.env['SMTP_PORT'] || 587);
    transport = nodemailer.createTransport({
      host: process.env['SMTP_HOST'],
      port,
      secure: port === 465, // 465 = TLS direto; 587/25 sobem para TLS com STARTTLS
      requireTLS: port !== 25 && port !== 465,
      auth: process.env['SMTP_USER'] ? { user: process.env['SMTP_USER'], pass: process.env['SMTP_PASS'] } : undefined,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    });
  }
  return transport;
}

// Testes trocam o envio por uma caixa de saída em memória
let outbox: Mail[] | null = null;
export function captureMailForTests() {
  outbox = [];
  return outbox;
}

export async function sendMail(mail: Mail) {
  if (outbox) return void outbox.push(mail);
  if (!mailConfigured()) throw new Error('E-mail não configurado no servidor (SMTP_HOST e SMTP_FROM).');
  await transporter().sendMail({ from: process.env['SMTP_FROM'], ...mail });
}

// ---------- Modelo dos e-mails (HTML com estilos inline, em tabelas: é o que os clientes de e-mail entendem) ----------
// Faixa fina no topo, cabeçalho colorido com a marca, o título grande e o botão branco em pílula; embaixo, o corpo
// em cinza claro com "Olá, Nome!", o texto, a mensagem de quem convidou e o código.

const BRAND = { ink: '#111827', muted: '#6b7280', line: '#e5e7eb', page: '#e5e5e5', body: '#f5f5f5', head: '#4338ca', strip: '#a78bfa', soft: '#ede9fe' };

export const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export interface Layout {
  preheader: string; // texto que aparece ao lado do assunto na caixa de entrada
  title: string; // vai grande no cabeçalho colorido (e no assunto)
  greeting: string; // "Olá, Joana!"
  paragraphs: string[]; // já escapados (podem ter <strong>)
  quote?: string; // mensagem de quem convidou (texto puro)
  code?: string;
  button?: { label: string; url: string };
  footnote: string;
}

const FONT = "Helvetica,Arial,sans-serif";

export function layout(l: Layout) {
  const p = (html: string) => `<p style="margin:0 0 18px;font-family:${FONT};font-size:15px;line-height:1.55;color:${BRAND.ink}">${html}</p>`;
  const button = l.button
    ? `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:28px 0 0"><tr>
              <td style="border-radius:999px;background-color:#ffffff">
                <a href="${escapeHtml(l.button.url)}" style="display:inline-block;padding:13px 26px;font-family:${FONT};font-size:15px;color:${BRAND.ink};text-decoration:none;border-radius:999px">${escapeHtml(l.button.label)} &nbsp;&rarr;</a>
              </td>
            </tr></table>`
    : '';
  const quote = l.quote
    ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 20px"><tr>
              <td style="border-left:4px solid ${BRAND.head};background-color:#ffffff;padding:14px 18px;font-family:${FONT};font-size:15px;line-height:1.55;color:${BRAND.ink};font-style:italic">&ldquo;${escapeHtml(l.quote)}&rdquo;</td>
            </tr></table>`
    : '';
  const code = l.code
    ? `<p style="margin:8px 0 10px;font-family:${FONT};font-size:13px;color:${BRAND.muted}">Seu código de verificação:</p>
            <table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 0 22px"><tr>
              <td style="background-color:${BRAND.soft};border-radius:12px;padding:16px 26px;font-family:Consolas,'Courier New',monospace;font-size:30px;font-weight:700;letter-spacing:10px;color:${BRAND.head}">${escapeHtml(l.code)}</td>
            </tr></table>`
    : '';
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${escapeHtml(l.title)}</title></head>
<body style="margin:0;padding:0;background-color:${BRAND.page}">
  <span style="display:none!important;opacity:0;color:transparent;height:0;width:0;overflow:hidden">${escapeHtml(l.preheader)}</span>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:${BRAND.page}"><tr><td align="center" style="padding:0">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px">
      <tr><td style="height:6px;line-height:6px;font-size:0;background-color:${BRAND.strip}">&nbsp;</td></tr>
      <tr><td style="background-color:${BRAND.head};padding:36px 40px 40px">
        <p style="margin:0 0 40px;font-family:${FONT};font-size:26px;font-weight:700;letter-spacing:-.03em;color:#ffffff">&#10022; LexÁgile</p>
        <h1 style="margin:0;font-family:${FONT};font-size:28px;font-weight:400;line-height:1.3;color:#ffffff">${escapeHtml(l.title)}</h1>
        ${button}
      </td></tr>
      <tr><td style="background-color:${BRAND.body};padding:44px 56px 40px">
        <h2 style="margin:0 0 28px;font-family:${FONT};font-size:22px;font-weight:700;color:${BRAND.ink}">${escapeHtml(l.greeting)}</h2>
        ${l.paragraphs.map(p).join('')}
        ${quote}${code}
        <p style="margin:12px 0 0;padding-top:20px;border-top:1px solid ${BRAND.line};font-family:${FONT};font-size:13px;line-height:1.6;color:${BRAND.muted}">${l.footnote}</p>
      </td></tr>
      <tr><td style="padding:24px 16px 32px;font-family:${FONT};font-size:12px;color:${BRAND.muted};text-align:center">Equipe LexÁgile</td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}
