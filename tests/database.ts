import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { RoomResult } from '../packages/protocol/src/rooms.ts';

export async function createTestDatabase() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema public,auth to anon,authenticated,service_role;
    grant execute on function auth.uid() to anon,authenticated,service_role;
  `);
  await db.exec(await readFile(new URL('../supabase/migrations/20261010000100_secure_rooms.sql', import.meta.url), 'utf8'));
  async function user() {
    const id = randomUUID(); await db.query('insert into auth.users values($1)', [id]); return id;
  }
  async function asRole<T>(role: 'authenticated' | 'anon' | 'service_role', id: string | null, sql: string, args: unknown[] = []): Promise<T[]> {
    return db.transaction(async tx => {
      await tx.exec(`set local role ${role}`);
      await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [id ?? '']);
      const result = await tx.query<T>(sql, args); return result.rows;
    });
  }
  async function rpc(userId: string | null, name: string, args: Record<string, unknown> = {}, role: 'authenticated' | 'anon' | 'service_role' = 'authenticated') {
    if (!/^ng_[a-z_]+$/.test(name) || Object.keys(args).some(key => !/^p_[a-z_]+$/.test(key))) throw new Error('Invalid fixture RPC');
    const parameters = Object.keys(args).map((key, i) => `${key} => $${i + 1}`).join(',');
    const values = Object.entries(args).map(([key,value]) => key==='p_connected_members' && Array.isArray(value) ? `{${value.join(',')}}` : value);
    const rows = await asRole<{ result: RoomResult & { arenas?: unknown[] } }>(role, userId, `select public.${name}(${parameters}) as result`, values);
    return rows[0]!.result;
  }
  return { db, user, asRole, rpc };
}
