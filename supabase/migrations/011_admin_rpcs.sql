-- grant_manual_bonus: atomically insert a coin_transaction and update coin_balance
create or replace function grant_manual_bonus(
  p_target_user_id uuid,
  p_amount         integer,
  p_family_id      uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_amount <= 0 then
    raise exception 'amount must be positive';
  end if;
  if not is_admin() then
    raise exception 'caller is not an admin';
  end if;
  insert into coin_transactions(user_id, family_id, amount, reason, related_entity_id)
  values (p_target_user_id, p_family_id, p_amount, 'manual_bonus', null);
  update profiles
  set coin_balance = coin_balance + p_amount, updated_at = now()
  where id = p_target_user_id;
end;
$$;

-- set_trust_level: update a player's trust_level (1–5)
create or replace function set_trust_level(
  p_target_user_id uuid,
  p_new_level      integer
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_new_level < 1 or p_new_level > 5 then
    raise exception 'trust level must be between 1 and 5';
  end if;
  if not is_admin() then
    raise exception 'caller is not an admin';
  end if;
  update profiles
  set trust_level = p_new_level, updated_at = now()
  where id = p_target_user_id;
end;
$$;
