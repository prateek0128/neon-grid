import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import type { RoomSnapshot, ServerMessage, Snapshot, Welcome } from '@neon/protocol';
import { createAuthFixture } from '../../../tests/auth-fixture.ts';
import { createTestDatabase } from '../../../tests/database.ts';
import { createSupabaseRooms } from './rooms.ts';
import { createSupabaseVerifier } from './auth.ts';
import { createGameServer } from './legacy-websocket-server.ts';

let data: Awaited<ReturnType<typeof createTestDatabase>>;
let fixture: ReturnType<typeof createAuthFixture>;
let server: ReturnType<typeof createGameServer>;
let url: string;
const sockets: WebSocket[]=[];
beforeAll(async()=>{
  data=await createTestDatabase(); fixture=createAuthFixture(data); fixture.http.listen(0,'127.0.0.1'); await once(fixture.http,'listening');
  const authUrl=`http://127.0.0.1:${(fixture.http.address() as AddressInfo).port}`;
  server=createGameServer({verifyToken:createSupabaseVerifier(authUrl,'sb_publishable_test_fixture'),allowedOrigins:['http://localhost:5173'],
    rooms:createSupabaseRooms(authUrl,'sb_publishable_test_fixture','sb_secret_test_fixture')});
  server.http.listen(0,'127.0.0.1'); await once(server.http,'listening'); url=`ws://127.0.0.1:${(server.http.address() as AddressInfo).port}/ws`;
  await vi.waitFor(async () => expect((await fetch(url.replace('ws:', 'http:').replace('/ws', '/ready'))).status).toBe(200), { timeout: 3000 });
});
afterAll(async()=>{ sockets.forEach(s=>s.terminate()); await server.close(); await new Promise<void>(resolve=>fixture.http.close(()=>resolve())); await data.db.close(); });
async function rpcRoom(user:string,name:string,args:Record<string,unknown>) {
  const result=await data.rpc(user,name,args); if (!result.ok || !('room' in result)) throw new Error(JSON.stringify(result)); return result.room;
}
async function makeMatch() {
  const a=await data.user(); const b=await data.user();
  let room=await rpcRoom(a,'ng_create_room',{p_request_id:randomUUID(),p_name:'Cipher'});
  room=await rpcRoom(b,'ng_join_room',{p_request_id:randomUUID(),p_name:'Ghost',p_code:room.code});
  room=await rpcRoom(a,'ng_set_ready',{p_request_id:randomUUID(),p_room_id:room.id,p_ready:true,p_revision:room.revision});
  room=await rpcRoom(b,'ng_set_ready',{p_request_id:randomUUID(),p_room_id:room.id,p_ready:true,p_revision:room.revision});
  await rpcRoom(a,'ng_request_start',{p_request_id:randomUUID(),p_room_id:room.id,p_revision:room.revision});
  await new Promise(resolve=>setTimeout(resolve,1200));
  room=await rpcRoom(a,'ng_get_room',{p_room_id:room.id}); expect(room.status).toBe('IN_MATCH');
  return {a,b,room};
}
async function connect(user:string,room?:RoomSnapshot) {
  const token=fixture.issue(user); const ws=new WebSocket(url,{origin:'http://localhost:5173'}); sockets.push(ws);
  const messages: ServerMessage[]=[]; ws.on('message',r=>messages.push(JSON.parse(r.toString()))); await once(ws,'open');
  const next=async<T extends ServerMessage>(predicate:(m:ServerMessage)=>boolean):Promise<T>=>{
    for(let n=0;n<300;n++){const i=messages.findIndex(predicate); if(i>=0)return messages.splice(i,1)[0] as T; await new Promise(resolve=>setTimeout(resolve,10));}
    throw new Error('Message not received');
  };
  ws.send(JSON.stringify({type:'authenticate',version:1,accessToken:token,...(room?{roomId:room.id,matchId:room.match!.id}:{})}));
  return {ws,next};
}
it('rejects roomless and nonmember connections without a production test arena',async()=>{
  const outsider=await data.user(); const none=await connect(outsider); expect(await none.next(m=>m.type==='error')).toMatchObject({code:'ROOM_REQUIRED'});
  const {room}=await makeMatch(); const rejected=await connect(outsider,room); expect(await rejected.next(m=>m.type==='error')).toMatchObject({code:'NOT_MEMBER'});
});
it('synchronizes room movement, isolates matches, preserves reconnect identity and disconnects revoked membership',async()=>{
  const {a,b,room}=await makeMatch(); const other=await makeMatch();
  const ca=await connect(a,room); const aw=await ca.next<Welcome>(m=>m.type==='welcome');
  const cb=await connect(b,room); const bw=await cb.next<Welcome>(m=>m.type==='welcome');
  const co=await connect(other.a,other.room); await co.next(m=>m.type==='welcome');
  const own=await ca.next<Snapshot>(m=>m.type==='snapshot'&&m.players.length===2);
  const isolated=await co.next<Snapshot>(m=>m.type==='snapshot'); expect(isolated.players.some(p=>own.players.some(o=>o.id===p.id))).toBe(false);
  ca.ws.send(JSON.stringify({type:'input',version:1,sessionId:aw.sessionId,sequence:0,movement:{x:1,y:0}}));
  const moved=await cb.next<Snapshot>(m=>m.type==='snapshot'&&m.players.some(p=>p.id===aw.playerId&&p.position.x>320)); expect(moved.epoch).toBe(room.match!.id);
  ca.ws.close(); await once(ca.ws,'close'); const reconnected=await connect(a,room); const rw=await reconnected.next<Welcome>(m=>m.type==='welcome'); expect(rw.playerId).toBe(aw.playerId);
  await data.rpc(b,'ng_leave_room',{p_request_id:randomUUID(),p_room_id:room.id});
  expect(await cb.next(m=>m.type==='error')).toMatchObject({code:'NOT_MEMBER'});
  expect(bw.playerId).not.toBe(rw.playerId);
  const remaining=await reconnected.next<Snapshot>(m=>m.type==='snapshot'&&m.players.length===1); expect(remaining.players[0]?.id).toBe(rw.playerId);
});
it('allows authenticated room HTTP reads while the same member receives an Origin handshake 403', async () => {
  const { a, room } = await makeMatch();
  const authUrl = `http://127.0.0.1:${(fixture.http.address() as AddressInfo).port}`;
  const token = fixture.issue(a);
  const response = await fetch(authUrl + '/rest/v1/rpc/ng_get_room', { method: 'POST',
    headers: { apikey: 'sb_publishable_test_fixture', Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_room_id: room.id }) });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ ok: true, room: { id: room.id, status: 'IN_MATCH' } });
  // Deliberately unlisted in this fixture: demonstrates that RPC success is independent of upgrade admission.
  const ws = new WebSocket(url, { origin: 'https://neon-grid-tau.vercel.app' });
  const [error] = await once(ws, 'error'); expect(String(error)).toContain('403');
  const admitted = await connect(a, room);
  expect(await admitted.next<Welcome>(message => message.type === 'welcome')).toMatchObject({ playerId: room.selfMemberId });
});
