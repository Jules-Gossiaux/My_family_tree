-- Un jeton d'invitation donne désormais le droit de modifier l'arbre par défaut.
-- Les jetons déjà créés conservent le rôle qui était le leur au moment de leur création.
create or replace function public.create_invitation(
  p_family uuid,
  p_role text default 'editor',
  p_email text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  new_token text;
begin
  if not public.can_admin(p_family) then
    raise exception 'Seul un administrateur peut créer un jeton.';
  end if;
  if p_role not in ('admin', 'editor', 'viewer') then
    raise exception 'Rôle inconnu.';
  end if;
  insert into public.invitations(family_id, email, role, invited_by, expires_at)
  values (p_family, nullif(lower(trim(coalesce(p_email, ''))), ''), p_role,
          auth.uid(), now() + interval '90 days')
  returning token into new_token;
  return new_token;
end;
$$;
