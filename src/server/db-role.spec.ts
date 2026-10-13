// O usuário restrito do app (scripts/db-role.sql) é mesmo restrito — e o RLS fecha a porta para os outros papéis.
import { IDS, TestEnv, startTestEnv } from './testing/test-db';

let env: TestEnv;
beforeAll(async () => {
  env = await startTestEnv();
}, 60_000);
afterAll(async () => env?.close());

const fails = async (sql: string) => {
  try {
    await env.db.exec(sql);
    return null;
  } catch (error) {
    return (error as { code?: string }).code ?? 'erro';
  }
};

describe('usuário do banco lexagile_app', () => {
  it('é o usuário de todos os testes (não o dono)', async () => {
    expect((await env.db.query<{ u: string }>('select current_user as u')).rows[0].u).toBe('lexagile_app');
  });

  it('lê e grava o que o app precisa', async () => {
    expect((await env.db.query('select id from "Tenant"')).rows.length).toBe(2);
    expect(await fails(`update "Atividade" set titulo = titulo where id = '${IDS.atividadeDoAtendente}'`)).toBeNull();
    expect(await fails(`insert into lexagile.limite (chave, n, desde) values ('teste-papel', 1, now())`)).toBeNull();
  });

  it('não altera a estrutura do banco (DDL), não apaga nem esvazia tabelas do sistema', async () => {
    expect(await fails('create table public.invasao (a int)')).toBe('42501');
    expect(await fails('alter table "Atividade" add column invasao int')).toBe('42501');
    expect(await fails('drop table lexagile.limite')).toBe('42501');
    expect(await fails(`delete from "Tenant" where id = 'x'`)).toBe('42501');
    expect(await fails(`delete from "Atividade" where id = 'x'`)).toBe('42501');
    expect(await fails('truncate "Atividade"')).toBe('42501');
    expect(await fails('create role invasor login')).toBe('42501');
  });

  it('um papel sem política (como o anon da API do Supabase) não vê nenhuma linha', async () => {
    await env.db.exec(`reset role; create role anon_teste; grant select on "Tenant", "Atividade" to anon_teste; set role anon_teste`);
    const tenants = (await env.db.query('select id from "Tenant"')).rows.length;
    const ativs = (await env.db.query('select id from "Atividade"')).rows.length;
    await env.db.exec('reset role; set role lexagile_app');
    expect(tenants).toBe(0);
    expect(ativs).toBe(0);
  });
});
