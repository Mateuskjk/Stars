import { createHmac } from 'node:crypto';
import { checkWebhookUrl, clientConfig, isPrivateAddress, sign } from './integrations';

describe('integrations (server)', () => {
  it('flags internal addresses so webhooks cannot reach the private network', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.0.10', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1']) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    for (const ip of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '2606:4700::1111']) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
  });

  it('only accepts public https webhook URLs', async () => {
    expect(await checkWebhookUrl('http://example.com/hook')).toBe('Use uma URL https.');
    expect(await checkWebhookUrl('https://localhost/hook')).toBe('Endereços internos não são permitidos.');
    expect(await checkWebhookUrl('https://127.0.0.1/hook')).toBe('Endereços internos não são permitidos.');
    expect(await checkWebhookUrl('https://user:pass@8.8.8.8/hook')).toBe('Não coloque usuário e senha na URL.');
    expect(await checkWebhookUrl('https://8.8.8.8/hook')).toBeNull();
    expect(await checkWebhookUrl('não é url')).toBe('URL inválida.');
  });

  it('signs the payload with HMAC-SHA256 over "timestamp.body"', () => {
    const expected = 'sha256=' + createHmac('sha256', 'whsec_x').update('1700000000.{"a":1}').digest('hex');
    expect(sign('whsec_x', '1700000000', '{"a":1}')).toBe(expected);
  });

  it('builds the PostgreSQL client config with SSL, timeouts, schema and read-only', () => {
    const config = clientConfig({
      name: 'BI', host: 'db.empresa.com', port: 5432, database: 'bi', user: 'leitor', password: 'x', ssl: 'verify-full',
      schema: 'vendas', connectTimeoutSec: 5, statementTimeoutSec: 20, poolMax: 5, readOnly: true, applicationName: 'stars',
    });
    expect(config).toMatchObject({ host: 'db.empresa.com', ssl: { rejectUnauthorized: true }, connectionTimeoutMillis: 5000, statement_timeout: 20000 });
    expect(config.options).toBe('-c search_path=vendas -c default_transaction_read_only=on');
  });
});
