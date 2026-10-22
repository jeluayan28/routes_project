-- Fare history: a price change never overwrites or deletes a verified fare.
--
--   * A verified fare rule is part of the record of what was charged. API callers
--     cannot edit or delete it. A price change is public.change_fare(), which ends
--     the old rule the day before and adds a new, unverified rule from the new date.
--     public.end_fare() ends a rule without replacing it.
--   * Re-verifying a route does not re-stamp rules that were already verified, so
--     each rule keeps the date it was actually verified.
--   * Amounts are already numeric(8,2) (fixed precision); see the transport tables.

create or replace function private.guard_fare_verification()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not private.is_api_role() then
    return new;
  end if;

  -- Inside verify_route() / change_fare() / end_fare() for this route.
  if private.verifying_route() is not distinct from new.route_id then
    -- Keep the original verification stamp of a rule that was already verified.
    if tg_op = 'UPDATE' and old.verification_status = 'verified' and old.verified_at is not null
       and new.verification_status = 'verified' then
      new.verified_at := old.verified_at;
      new.source_description := old.source_description;
    end if;
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.verification_status := 'unverified';
    new.verified_at := null;
    return new;
  end if;

  if old.verified_at is not null then
    raise exception 'A verified fare is kept as history and cannot be edited. Use change_fare() to set a new price, or end_fare() to stop it.'
      using errcode = 'check_violation';
  end if;

  if new.verification_status = 'verified' and old.verification_status <> 'verified' then
    raise exception 'A fare is verified together with its route, using verify_route()'
      using errcode = 'check_violation';
  end if;

  if (new.route_id, new.from_stop_id, new.to_stop_id, new.passenger_type, new.amount,
      new.effective_from, new.effective_until)
     is distinct from
     (old.route_id, old.from_stop_id, old.to_stop_id, old.passenger_type, old.amount,
      old.effective_from, old.effective_until) then
    new.verification_status := 'unverified';
    new.verified_at := null;
  end if;
  return new;
end;
$$;

-- Verified fares cannot be deleted through the API (deleting their route is still allowed).
create function private.guard_fare_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if private.is_api_role()
     and old.verified_at is not null
     and exists (select 1 from public.routes r where r.id = old.route_id) then
    raise exception 'A verified fare is kept as history and cannot be deleted. Use end_fare() to stop it.'
      using errcode = 'check_violation';
  end if;
  return old;
end;
$$;
revoke all on function private.guard_fare_delete() from public;

create trigger fare_rules_guard_delete
  before delete on public.fare_rules
  for each row execute function private.guard_fare_delete();

-- ---------------------------------------------------------------------------
-- public.change_fare(): a new price from a given date. Returns the new rule's id.
-- ---------------------------------------------------------------------------
create function public.change_fare(
  p_fare_id uuid,
  p_amount numeric,
  p_effective_from date,
  p_source text
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  old public.fare_rules%rowtype;
  v_id uuid;
begin
  if not private.is_admin() then
    raise exception 'Administrators only' using errcode = 'insufficient_privilege';
  end if;

  select * into old from public.fare_rules where id = p_fare_id for update;
  if not found then
    raise exception 'Fare not found' using errcode = 'no_data_found';
  end if;
  if p_amount is null or p_amount < 0 or p_amount >= 1000000 or p_amount <> round(p_amount, 2) then
    raise exception 'The fare must be an amount of zero or more with at most two decimals' using errcode = 'check_violation';
  end if;
  if p_effective_from is null or p_effective_from <= old.effective_from then
    raise exception 'The new price must start after the current fare starts' using errcode = 'check_violation';
  end if;
  if old.effective_until is not null and old.effective_until < p_effective_from then
    raise exception 'That fare already ended before the new start date' using errcode = 'check_violation';
  end if;
  if p_source is null or char_length(btrim(p_source)) < 3 then
    raise exception 'A source for the new fare is required' using errcode = 'check_violation';
  end if;

  perform set_config('app.verifying_route', old.route_id::text, true);
  update public.fare_rules set effective_until = p_effective_from - 1 where id = old.id;
  perform set_config('app.verifying_route', '', true);

  -- Inserted as an API caller, so it is forced to unverified: the new price must be
  -- verified (with its route) before the public sees it.
  insert into public.fare_rules (
    route_id, from_stop_id, to_stop_id, passenger_type, amount,
    effective_from, effective_until, source_description
  ) values (
    old.route_id, old.from_stop_id, old.to_stop_id, old.passenger_type, round(p_amount, 2),
    p_effective_from, old.effective_until, btrim(p_source)
  ) returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.change_fare(uuid, numeric, date, text) from public, anon;
grant execute on function public.change_fare(uuid, numeric, date, text) to authenticated;

-- ---------------------------------------------------------------------------
-- public.end_fare(): stop a fare on a date without replacing it.
-- ---------------------------------------------------------------------------
create function public.end_fare(p_fare_id uuid, p_effective_until date)
returns void
language plpgsql
set search_path = ''
as $$
declare
  old public.fare_rules%rowtype;
begin
  if not private.is_admin() then
    raise exception 'Administrators only' using errcode = 'insufficient_privilege';
  end if;

  select * into old from public.fare_rules where id = p_fare_id for update;
  if not found then
    raise exception 'Fare not found' using errcode = 'no_data_found';
  end if;
  if p_effective_until is null or p_effective_until < old.effective_from then
    raise exception 'The end date is before the fare starts' using errcode = 'check_violation';
  end if;
  if old.effective_until is not null and p_effective_until >= old.effective_until then
    raise exception 'A fare can only be ended earlier than it currently ends' using errcode = 'check_violation';
  end if;

  perform set_config('app.verifying_route', old.route_id::text, true);
  update public.fare_rules set effective_until = p_effective_until where id = old.id;
  perform set_config('app.verifying_route', '', true);
end;
$$;
revoke all on function public.end_fare(uuid, date) from public, anon;
grant execute on function public.end_fare(uuid, date) to authenticated;
