-- Dedicated NEON GRID project only. All game mutations are validated RPC transactions.
create schema if not exists ng_private;
revoke all on schema ng_private from public, anon, authenticated;

create table public.ng_rooms (
  id uuid primary key default gen_random_uuid(),
  host_member_id uuid not null,
  status text not null default 'LOBBY' check (status in ('LOBBY','STARTING','IN_MATCH')),
  revision bigint not null default 1 check (revision > 0),
  current_match_id uuid,
  expires_at timestamptz not null default (clock_timestamp() + interval '2 hours'),
  last_error text,
  created_at timestamptz not null default clock_timestamp()
);
create table public.ng_room_members (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.ng_rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  slot smallint not null check (slot between 1 and 4),
  display_name text not null check (length(display_name) between 1 and 24),
  ready boolean not null default false,
  joined_at timestamptz not null default clock_timestamp(),
  last_seen_at timestamptz not null default clock_timestamp(),
  unique (room_id, slot), unique (user_id), unique (room_id, user_id)
);
create index ng_members_room on public.ng_room_members(room_id);
create index ng_rooms_expiry on public.ng_rooms(expires_at);
create table ng_private.codes (
  code text primary key check (code ~ '^[A-F0-9]{12}$'),
  room_id uuid unique not null references public.ng_rooms(id) on delete cascade
);
create table ng_private.matches (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.ng_rooms(id) on delete cascade,
  status text not null check (status in ('STARTING','IN_MATCH','CLOSED','ABORTED')),
  requested_by uuid not null,
  requested_revision bigint not null,
  roster jsonb not null,
  server_instance uuid,
  started_at timestamptz,
  created_at timestamptz not null default clock_timestamp()
);
create unique index ng_one_live_match on ng_private.matches(room_id) where status in ('STARTING','IN_MATCH');
create table ng_private.requests (
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  action text not null,
  payload jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key(user_id, request_id)
);
create table ng_private.limits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  window_start timestamptz not null,
  attempts integer not null
);
create table ng_private.runtime (
  singleton boolean primary key default true check(singleton),
  instance_id uuid not null,
  lease_until timestamptz not null
);
revoke all on all tables in schema ng_private from public, anon, authenticated;
revoke all on public.ng_rooms, public.ng_room_members from public, anon, authenticated, service_role;
alter table public.ng_rooms enable row level security;
alter table public.ng_room_members enable row level security;

create function ng_private.is_member(p_room uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.ng_room_members m join public.ng_rooms r on r.id=m.room_id
    where m.room_id=p_room and m.user_id=auth.uid() and m.last_seen_at > now()-interval '30 seconds' and r.expires_at>now());
$$;
revoke all on function ng_private.is_member(uuid) from public, anon, authenticated;
-- RLS needs this helper; the private schema must never be added to exposed API schemas.
grant usage on schema ng_private to authenticated;
grant execute on function ng_private.is_member(uuid) to authenticated;
grant select on public.ng_rooms, public.ng_room_members to authenticated;
create policy ng_rooms_member_read on public.ng_rooms for select to authenticated using (ng_private.is_member(id));
create policy ng_roster_member_read on public.ng_room_members for select to authenticated using (ng_private.is_member(room_id));

create function ng_private.error(p_code text, p_message text) returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object('ok',false,'code',p_code,'message',p_message);
$$;
create function ng_private.snapshot(p_room uuid, p_user uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.ng_rooms; m public.ng_room_members; match ng_private.matches;
begin
  select * into r from public.ng_rooms where id=p_room;
  if not found then return ng_private.error('ROOM_MISSING','Room no longer exists.'); end if;
  if r.expires_at<=clock_timestamp() then return ng_private.error('ROOM_EXPIRED','Room expired. Create another room.'); end if;
  select * into m from public.ng_room_members where room_id=p_room and user_id=p_user;
  if not found or m.last_seen_at<=clock_timestamp()-interval '30 seconds' then
    return ng_private.error('NOT_MEMBER','You are no longer an active member of this room.');
  end if;
  select * into match from ng_private.matches where id=r.current_match_id;
  return jsonb_build_object('ok',true,'room',jsonb_build_object(
    'id',r.id,'code',(select code from ng_private.codes where room_id=r.id),'status',r.status,
    'revision',r.revision,'hostMemberId',r.host_member_id,'selfMemberId',m.id,
    'expiresAt',r.expires_at,'lastError',r.last_error,
    'match',case when match.id is null then null else jsonb_build_object('id',match.id,'startedAt',match.started_at,'serverInstance',match.server_instance) end,
    'members',coalesce((select jsonb_agg(jsonb_build_object('id',id,'slot',slot,'displayName',display_name,'ready',ready,
      'online',last_seen_at>clock_timestamp()-interval '30 seconds') order by slot) from public.ng_room_members where room_id=r.id),'[]'::jsonb)));
end;
$$;
-- All membership changes follow room-row locking. The singleton runtime only serializes maintenance.
create function ng_private.repair_room(p_room uuid) returns void language plpgsql security definer set search_path = '' as $$
declare next_host uuid;
begin
  if not exists(select 1 from public.ng_room_members where room_id=p_room) then
    delete from public.ng_rooms where id=p_room; return;
  end if;
  if not exists(select 1 from public.ng_rooms r join public.ng_room_members m on m.id=r.host_member_id where r.id=p_room and m.room_id=p_room) then
    select id into next_host from public.ng_room_members where room_id=p_room order by joined_at,id limit 1;
    update public.ng_rooms set host_member_id=next_host where id=p_room;
  end if;
end;
$$;

create function ng_private.command(p_action text,p_request_id uuid,p_room_id uuid,p_code text,p_name text,p_ready boolean,p_revision bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid(); payload jsonb; cached ng_private.requests; r public.ng_rooms;
  me public.ng_room_members; rid uuid; mid uuid; generated_code text; slot_number smallint;
  result jsonb; count_members integer; attempts_now integer; roster jsonb;
begin
  if uid is null then return ng_private.error('AUTH_REQUIRED','Sign in anonymously first.'); end if;
  if p_request_id is null then return ng_private.error('INVALID_REQUEST','A request identifier is required.'); end if;
  payload:=jsonb_build_object('room',p_room_id,'code',p_code,'name',p_name,'ready',p_ready,'revision',p_revision);
  perform pg_advisory_xact_lock(hashtextextended(uid::text,0));
  select * into cached from ng_private.requests where user_id=uid and request_id=p_request_id;
  if found then
    if cached.action<>p_action or cached.payload<>payload then return ng_private.error('REQUEST_CONFLICT','Request identifier reused with different parameters.'); end if;
    if cached.result ? 'roomId' then return ng_private.snapshot((cached.result->>'roomId')::uuid,uid); end if;
    return cached.result;
  end if;
  if p_action in ('create','join') then
    insert into ng_private.limits values(uid,clock_timestamp(),1)
      on conflict(user_id) do update set
        attempts=case when ng_private.limits.window_start<clock_timestamp()-interval '1 minute' then 1 else ng_private.limits.attempts+1 end,
        window_start=case when ng_private.limits.window_start<clock_timestamp()-interval '1 minute' then clock_timestamp() else ng_private.limits.window_start end
      returning attempts into attempts_now;
    if attempts_now>12 then result:=ng_private.error('RATE_LIMITED','Too many room attempts. Wait one minute.'); end if;
    if result is null and (p_name is null or length(btrim(p_name)) not between 1 and 24 or p_name ~ '[[:cntrl:]]') then
      result:=ng_private.error('INVALID_NAME','Use a display name of 1–24 characters.');
    end if;
    if result is null then
      select * into me from public.ng_room_members where user_id=uid;
      if found then
        if p_action='join' and exists(select 1 from ng_private.codes where room_id=me.room_id and code=upper(btrim(p_code))) then
          select * into r from public.ng_rooms where id=me.room_id for update;
          result:=ng_private.snapshot(me.room_id,uid);
        else result:=ng_private.error('ALREADY_IN_ROOM','Leave your current room first.'); end if;
      end if;
    end if;
    if result is null and p_action='create' then
      rid:=gen_random_uuid(); mid:=gen_random_uuid();
      insert into public.ng_rooms(id,host_member_id) values(rid,mid);
      -- 48 unpredictable bits, with a unique constraint and collision retry.
      loop
        generated_code:=upper(substr(replace(gen_random_uuid()::text,'-',''),21,12));
        begin insert into ng_private.codes values(generated_code,rid); exit; exception when unique_violation then null; end;
      end loop;
      insert into public.ng_room_members(id,room_id,user_id,slot,display_name) values(mid,rid,uid,1,btrim(p_name));
      result:=jsonb_build_object('ok',true,'roomId',rid);
    elsif result is null and p_action='join' then
      if p_code is null or upper(btrim(p_code)) !~ '^[A-F0-9]{12}$' then result:=ng_private.error('INVALID_CODE','Enter the 12-character room code.');
      else
        select room_id into rid from ng_private.codes where code=upper(btrim(p_code));
        select * into r from public.ng_rooms where id=rid for update;
        if not found then result:=ng_private.error('ROOM_MISSING','Room code not found.');
        elsif r.expires_at<=clock_timestamp() then result:=ng_private.error('ROOM_EXPIRED','Room expired.');
        elsif r.status<>'LOBBY' then result:=ng_private.error('ALREADY_STARTED','This room has already started.');
        else
          select count(*) into count_members from public.ng_room_members where room_id=rid;
          if count_members>=4 then result:=ng_private.error('ROOM_FULL','This room already has four players.');
          else
            select s::smallint into slot_number from generate_series(1,4) s where not exists(select 1 from public.ng_room_members where room_id=rid and slot=s) order by s limit 1;
            insert into public.ng_room_members(room_id,user_id,slot,display_name) values(rid,uid,slot_number,btrim(p_name));
            update public.ng_room_members set ready=false where room_id=rid;
            update public.ng_rooms set revision=revision+1,last_error=null where id=rid;
            result:=jsonb_build_object('ok',true,'roomId',rid);
          end if;
        end if;
      end if;
    end if;
  else
    select * into r from public.ng_rooms where id=p_room_id for update;
    select * into me from public.ng_room_members where room_id=p_room_id and user_id=uid;
    if r.id is null then result:=ng_private.error('ROOM_MISSING','Room no longer exists.');
    elsif r.expires_at<=clock_timestamp() then result:=ng_private.error('ROOM_EXPIRED','Room expired.');
    elsif me.id is null or me.last_seen_at<=clock_timestamp()-interval '30 seconds' then result:=ng_private.error('NOT_MEMBER','Active room membership required.');
    elsif p_action<>'leave' and (p_revision is null or p_revision<>r.revision) then result:=ng_private.error('REVISION_CONFLICT','Room changed. Refresh and try again.');
    elsif p_action='leave' then
      delete from public.ng_room_members where id=me.id;
      update public.ng_rooms set revision=revision+1 where id=r.id;
      if r.status='LOBBY' then update public.ng_room_members set ready=false where room_id=r.id; end if;
      perform ng_private.repair_room(r.id);
      result:=jsonb_build_object('ok',true,'left',true);
    elsif p_action='ready' then
      if r.status<>'LOBBY' then result:=ng_private.error('ALREADY_STARTED','Readiness is locked after start.');
      elsif p_ready is null then result:=ng_private.error('INVALID_REQUEST','Ready state is required.');
      else
        update public.ng_room_members set ready=p_ready,last_seen_at=clock_timestamp() where id=me.id;
        update public.ng_rooms set revision=revision+1,last_error=null where id=r.id;
        result:=jsonb_build_object('ok',true,'roomId',r.id);
      end if;
    elsif p_action='start' then
      if r.host_member_id<>me.id then result:=ng_private.error('HOST_ONLY','Only the host can start.');
      elsif r.status<>'LOBBY' then result:=ng_private.error('ALREADY_STARTED','A match already exists.');
      elsif (select count(*) from public.ng_room_members where room_id=r.id)<2 or
        exists(select 1 from public.ng_room_members where room_id=r.id and (not ready or last_seen_at<=clock_timestamp()-interval '30 seconds')) then
        result:=ng_private.error('NOT_READY','At least two players and everyone ready are required.');
      else
        select jsonb_agg(jsonb_build_object('id',id,'userId',user_id,'slot',slot,'displayName',display_name) order by slot) into roster from public.ng_room_members where room_id=r.id;
        mid:=gen_random_uuid();
        insert into ng_private.matches(id,room_id,status,requested_by,requested_revision,roster) values(mid,r.id,'STARTING',uid,r.revision+1,roster);
        update public.ng_rooms set status='STARTING',revision=revision+1,current_match_id=mid,last_error=null where id=r.id;
        result:=jsonb_build_object('ok',true,'roomId',r.id);
      end if;
    elsif p_action='return' then
      if r.host_member_id<>me.id then result:=ng_private.error('HOST_ONLY','Only the host can end the movement session.');
      elsif r.status='LOBBY' then result:=jsonb_build_object('ok',true,'roomId',r.id);
      else
        update ng_private.matches set status='CLOSED' where id=r.current_match_id;
        update public.ng_rooms set status='LOBBY',revision=revision+1,current_match_id=null,last_error=null where id=r.id;
        update public.ng_room_members set ready=false where room_id=r.id;
        result:=jsonb_build_object('ok',true,'roomId',r.id);
      end if;
    else result:=ng_private.error('INVALID_REQUEST','Unknown room action.'); end if;
  end if;
  -- Cache a room reference, never a stale room snapshot.
  if result->>'ok'='true' and result ? 'room' then
    result:=jsonb_build_object('ok',true,'roomId',(result#>>'{room,id}')::uuid);
  end if;
  insert into ng_private.requests(user_id,request_id,action,payload,result) values(uid,p_request_id,p_action,payload,result);
  if result ? 'roomId' then return ng_private.snapshot((result->>'roomId')::uuid,uid); end if;
  return result;
end;
$$;

create function public.ng_create_room(p_request_id uuid,p_name text) returns jsonb language sql security definer set search_path='' as $$ select ng_private.command('create',p_request_id,null,null,p_name,null,null); $$;
create function public.ng_join_room(p_request_id uuid,p_code text,p_name text) returns jsonb language sql security definer set search_path='' as $$ select ng_private.command('join',p_request_id,null,p_code,p_name,null,null); $$;
create function public.ng_set_ready(p_request_id uuid,p_room_id uuid,p_ready boolean,p_revision bigint) returns jsonb language sql security definer set search_path='' as $$ select ng_private.command('ready',p_request_id,p_room_id,null,null,p_ready,p_revision); $$;
create function public.ng_leave_room(p_request_id uuid,p_room_id uuid) returns jsonb language sql security definer set search_path='' as $$ select ng_private.command('leave',p_request_id,p_room_id,null,null,null,null); $$;
create function public.ng_request_start(p_request_id uuid,p_room_id uuid,p_revision bigint) returns jsonb language sql security definer set search_path='' as $$ select ng_private.command('start',p_request_id,p_room_id,null,null,null,p_revision); $$;
create function public.ng_return_lobby(p_request_id uuid,p_room_id uuid,p_revision bigint) returns jsonb language sql security definer set search_path='' as $$ select ng_private.command('return',p_request_id,p_room_id,null,null,null,p_revision); $$;
create function public.ng_get_room(p_room_id uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); rid uuid; result jsonb;
begin
  if uid is null then return ng_private.error('AUTH_REQUIRED','Sign in first.'); end if;
  rid:=p_room_id;
  if rid is null then select room_id into rid from public.ng_room_members where user_id=uid; end if;
  result:=ng_private.snapshot(rid,uid);
  if result->>'ok'='true' then update public.ng_room_members set last_seen_at=clock_timestamp() where room_id=rid and user_id=uid; end if;
  return result;
end;
$$;

-- One persistent process owns the runtime lease. Expired owners are fenced and their matches aborted.
create function public.ng_server_tick(p_instance_id uuid,p_connected_members uuid[] default '{}'::uuid[]) returns jsonb language plpgsql security definer set search_path='' as $$
declare runtime ng_private.runtime; r public.ng_rooms; match ng_private.matches; roster_now jsonb; removed integer; arenas jsonb:='[]'::jsonb;
begin
  if p_instance_id is null then return ng_private.error('INVALID_REQUEST','Instance required.'); end if;
  insert into ng_private.runtime values(true,p_instance_id,clock_timestamp()+interval '10 seconds') on conflict do nothing;
  select * into runtime from ng_private.runtime where singleton=true for update;
  if runtime.instance_id<>p_instance_id and runtime.lease_until>clock_timestamp() then return ng_private.error('SERVER_BUSY','Another game server holds the runtime lease.'); end if;
  update ng_private.runtime set instance_id=p_instance_id,lease_until=clock_timestamp()+interval '10 seconds' where singleton=true;
  -- Verified live sockets keep their existing membership alive even when a browser tab is throttled.
  -- This cannot recreate revoked membership or revive an already-stale member.
  update public.ng_room_members m set last_seen_at=clock_timestamp()
    from public.ng_rooms active_room join ng_private.matches active_match on active_match.id=active_room.current_match_id
    where m.room_id=active_room.id and m.id=any(p_connected_members) and m.last_seen_at>clock_timestamp()-interval '30 seconds'
      and active_room.status='IN_MATCH' and active_match.server_instance=p_instance_id;
  for r in select * from public.ng_rooms order by id for update loop
    if r.expires_at<=clock_timestamp() then delete from public.ng_rooms where id=r.id; continue; end if;
    delete from public.ng_room_members where room_id=r.id and last_seen_at<=clock_timestamp()-interval '30 seconds';
    get diagnostics removed=row_count;
    if removed>0 then
      update public.ng_rooms set revision=revision+1 where id=r.id;
      if r.status='LOBBY' then update public.ng_room_members set ready=false where room_id=r.id; end if;
      perform ng_private.repair_room(r.id);
      select * into r from public.ng_rooms where id=r.id;
      if not found then continue; end if;
    end if;
    if r.status='LOBBY' then continue; end if;
    select * into match from ng_private.matches where id=r.current_match_id;
    if match.id is null then
      update public.ng_rooms set status='LOBBY',current_match_id=null,revision=revision+1,last_error='Match state unavailable.' where id=r.id;
      update public.ng_room_members set ready=false where room_id=r.id; continue;
    end if;
    if r.status='STARTING' then
      select jsonb_agg(jsonb_build_object('id',id,'userId',user_id,'slot',slot,'displayName',display_name) order by slot) into roster_now from public.ng_room_members where room_id=r.id;
      if r.revision<>match.requested_revision or roster_now is distinct from match.roster or
        jsonb_array_length(coalesce(roster_now,'[]'::jsonb))<2 or
        not exists(select 1 from public.ng_room_members where id=r.host_member_id and room_id=r.id and user_id=match.requested_by) or
        exists(select 1 from public.ng_room_members where room_id=r.id and (not ready or last_seen_at<=clock_timestamp()-interval '30 seconds')) then
        update ng_private.matches set status='ABORTED' where id=match.id;
        update public.ng_rooms set status='LOBBY',current_match_id=null,revision=revision+1,last_error='Roster changed before the server started. Ready up again.' where id=r.id;
        update public.ng_room_members set ready=false where room_id=r.id; continue;
      end if;
      update ng_private.matches set status='IN_MATCH',server_instance=p_instance_id,started_at=clock_timestamp() where id=match.id returning * into match;
      update public.ng_rooms set status='IN_MATCH',revision=revision+1 where id=r.id;
    elsif match.server_instance is distinct from p_instance_id then
      update ng_private.matches set status='ABORTED' where id=match.id;
      update public.ng_rooms set status='LOBBY',current_match_id=null,revision=revision+1,last_error='Game server restarted. Movement session was aborted.' where id=r.id;
      update public.ng_room_members set ready=false where room_id=r.id; continue;
    end if;
    arenas:=arenas||jsonb_build_array(jsonb_build_object('roomId',r.id,'matchId',match.id,'startedAt',match.started_at,'members',
      coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'userId',m.user_id,'slot',m.slot) order by m.slot)
        from public.ng_room_members m where m.room_id=r.id and exists(select 1 from jsonb_array_elements(match.roster) x where x->>'id'=m.id::text)),'[]'::jsonb)));
  end loop;
  delete from ng_private.requests where created_at<clock_timestamp()-interval '3 hours';
  delete from ng_private.limits where window_start<clock_timestamp()-interval '1 hour';
  delete from ng_private.matches where status in ('ABORTED','CLOSED') and created_at<clock_timestamp()-interval '3 hours';
  return jsonb_build_object('ok',true,'arenas',arenas);
end;
$$;

revoke all on all functions in schema ng_private from public, anon, authenticated, service_role;
grant execute on function ng_private.is_member(uuid) to authenticated;
revoke all on function public.ng_create_room(uuid,text), public.ng_join_room(uuid,text,text),
  public.ng_set_ready(uuid,uuid,boolean,bigint),public.ng_leave_room(uuid,uuid),public.ng_request_start(uuid,uuid,bigint),
  public.ng_return_lobby(uuid,uuid,bigint),public.ng_get_room(uuid),public.ng_server_tick(uuid,uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.ng_create_room(uuid,text),public.ng_join_room(uuid,text,text),
  public.ng_set_ready(uuid,uuid,boolean,bigint),public.ng_leave_room(uuid,uuid),public.ng_request_start(uuid,uuid,bigint),
  public.ng_return_lobby(uuid,uuid,bigint),public.ng_get_room(uuid) to authenticated;
grant execute on function public.ng_server_tick(uuid,uuid[]) to service_role;
