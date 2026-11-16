create table if not exists public.appointment_notification_events (
  appointment_id uuid not null references public.appointments (id) on delete cascade,
  event_type text not null check (event_type in ('accepted_push', 'transfer_verified_email', 'transfer_verified_push', 'transfer_not_received_push')),
  created_at timestamptz not null default now(),
  primary key (appointment_id, event_type)
);

alter table public.appointment_notification_events
  drop constraint if exists appointment_notification_events_event_type_check;
alter table public.appointment_notification_events
  add constraint appointment_notification_events_event_type_check
  check (event_type in ('accepted_push', 'transfer_verified_email', 'transfer_verified_push', 'transfer_not_received_push'));

alter table public.appointment_notification_events disable row level security;
revoke all on public.appointment_notification_events from public, anon, authenticated;

create table if not exists public.barber_appointment_push_deliveries (
  appointment_id uuid not null references public.appointments (id) on delete cascade,
  event_key text not null,
  created_at timestamptz not null default now(),
  primary key (appointment_id, event_key)
);
alter table public.barber_appointment_push_deliveries disable row level security;
revoke all on public.barber_appointment_push_deliveries from public, anon, authenticated;
grant all on public.barber_appointment_push_deliveries to service_role;

create or replace function public.register_appointment_push(
  p_token text,
  p_endpoint text,
  p_p256dh text,
  p_auth_key text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_appointment_id uuid;
begin
  if p_token is null or char_length(p_token) not in (64, 72)
    or p_endpoint is null or p_endpoint !~ '^https://'
    or coalesce(p_p256dh, '') = '' or coalesce(p_auth_key, '') = '' then
    raise exception 'Los datos de suscripción a notificaciones no son válidos.';
  end if;
  select a.id into target_appointment_id
  from public.appointments a
  where a.access_token = p_token
    and a.status in ('pending', 'accepted')
    and a.reminder_push_consent;
  if not found then raise exception 'No encontramos una cita activa con permiso para recibir notificaciones.'; end if;
  insert into public.appointment_push_subscriptions (appointment_id, endpoint, p256dh, auth_key)
  values (target_appointment_id, p_endpoint, p_p256dh, p_auth_key)
  on conflict (appointment_id, endpoint) do update
    set p256dh = excluded.p256dh, auth_key = excluded.auth_key;
  return true;
end;
$$;

create or replace function public.claim_appointment_notification(
  p_appointment_id uuid,
  p_event_type text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed_count integer;
begin
  if not public.is_barber() then
    raise exception 'Debes iniciar sesión como barbero.';
  end if;
  if p_event_type not in ('accepted_push', 'transfer_verified_email', 'transfer_verified_push', 'transfer_not_received_push') then
    raise exception 'Tipo de notificación no válido.';
  end if;

  insert into public.appointment_notification_events (appointment_id, event_type)
  select a.id, p_event_type
  from public.appointments a
  where a.id = p_appointment_id
    and a.barber_id = public.current_barber_id()
    and (public.is_barber_owner() or a.staff_id = public.current_staff_id())
    and (
      (p_event_type = 'accepted_push'
        and a.status = 'accepted'
        and a.reminder_push_consent)
      or
      (p_event_type = 'transfer_verified_email'
        and a.status in ('pending', 'accepted')
        and a.transfer_payment_required
        and a.transfer_verification_status = 'verified'
        and coalesce(a.customer_email, '') <> '')
      or
      (p_event_type = 'transfer_verified_push'
        and a.status = 'accepted'
        and a.transfer_payment_required
        and a.transfer_verification_status = 'verified'
        and a.reminder_push_consent
        and exists (
          select 1 from public.appointment_push_subscriptions ps
          where ps.appointment_id = a.id
        ))
      or
      (p_event_type = 'transfer_not_received_push'
        and a.status = 'accepted'
        and a.transfer_payment_required
        and a.transfer_verification_status = 'not_transferred'
        and a.transfer_proof_path is null
        and a.reminder_push_consent)
    )
  on conflict (appointment_id, event_type) do nothing;

  get diagnostics claimed_count = row_count;
  return claimed_count = 1;
end;
$$;

create or replace function public.release_appointment_notification(
  p_appointment_id uuid,
  p_event_type text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_barber() then
    raise exception 'Debes iniciar sesión como barbero.';
  end if;
  if p_event_type not in ('accepted_push', 'transfer_verified_email', 'transfer_verified_push', 'transfer_not_received_push') then
    raise exception 'Tipo de notificación no válido.';
  end if;

  delete from public.appointment_notification_events e
  using public.appointments a
  where e.appointment_id = a.id
    and e.appointment_id = p_appointment_id
    and e.event_type = p_event_type
    and a.barber_id = public.current_barber_id()
    and (public.is_barber_owner() or a.staff_id = public.current_staff_id());
end;
$$;

revoke all on function public.claim_appointment_notification(uuid, text) from public, anon;
revoke all on function public.release_appointment_notification(uuid, text) from public, anon;
revoke all on function public.register_appointment_push(text, text, text, text) from public;
grant execute on function public.claim_appointment_notification(uuid, text) to authenticated;
grant execute on function public.release_appointment_notification(uuid, text) to authenticated;
grant execute on function public.register_appointment_push(text, text, text, text) to anon, authenticated;

notify pgrst, 'reload schema';
