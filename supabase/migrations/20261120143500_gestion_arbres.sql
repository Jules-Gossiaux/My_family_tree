-- Supprimer un arbre ou quitter un arbre.
-- La RLS actuelle n'autorise ni DELETE sur `families`, ni le retrait de son
-- propre membre : ces opérations passent donc par des fonctions sécurisées.

-- Suppression interne, sans contrôle de rôle : appelée uniquement par les
-- deux fonctions publiques ci-dessous, qui font leur propre vérification.
create or replace function public._remove_family_data(p_family uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from storage.objects
  where bucket_id = 'family-media'
    and (storage.foldername(name))[1] = p_family::text;

  delete from public.family_documents where family_id = p_family;
  delete from public.invitations     where family_id = p_family;
  delete from public.family_members  where family_id = p_family;
  delete from public.families        where id = p_family;
end;
$$;

-- « from public » ne retire que le privilège accordé au rôle PUBLIC. Supabase
-- donne execute aux rôles nommés anon et authenticated sur tout le schéma
-- public : sans cette deuxième ligne, n'importe quel visiteur pourrait vider
-- un arbre par /rest/v1/rpc/_remove_family_data.
revoke all on function public._remove_family_data(uuid) from public;
revoke all on function public._remove_family_data(uuid) from anon, authenticated;

-- Suppression définitive : réservée à l'admin. Personne ne devient admin,
-- l'arbre disparaît avec toutes ses données.
create or replace function public.delete_family(p_family uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_admin(p_family) then
    raise exception 'Seul un administrateur peut supprimer cet arbre.';
  end if;
  perform public._remove_family_data(p_family);
end;
$$;

-- Liste des membres, pour choisir le successeur. Réservée à l'admin.
create or replace function public.list_family_members(p_family uuid)
returns table (id uuid, email text, role text, joined_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.can_admin(p_family) then
    raise exception 'Seul un administrateur peut voir les membres de cet arbre.';
  end if;
  return query
    select m.user_id, u.email, m.role, m.joined_at
    from public.family_members m
    join auth.users u on u.id = m.user_id
    where m.family_id = p_family
    order by m.joined_at asc;
end;
$$;

-- Nombre de membres, visible par tout membre pour savoir si partir supprime l'arbre.
create or replace function public.family_member_count(p_family uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
  from public.family_members m
  where m.family_id = p_family
    and exists (
      select 1 from public.family_members self
      where self.family_id = p_family and self.user_id = auth.uid()
    );
$$;

-- Quitter un arbre : on retire seulement son adhésion.
-- - dernier membre : l'arbre est supprimé ;
-- - admin avec d'autres membres : un successeur doit être désigné.
create or replace function public.leave_family(
  p_family uuid,
  p_new_admin uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role  text;
  v_count integer;
begin
  select role into v_role
  from public.family_members
  where family_id = p_family and user_id = auth.uid();

  if v_role is null then
    raise exception 'Vous n''êtes pas membre de cet arbre.';
  end if;

  select count(*) into v_count
  from public.family_members
  where family_id = p_family;

  if v_count = 1 then
    perform public._remove_family_data(p_family);
    return;
  end if;

  if v_role = 'admin' then
    if p_new_admin is null then
      raise exception 'Choisissez le membre qui deviendra administrateur.';
    end if;
    if not exists (
      select 1
      from public.family_members
      where family_id = p_family
        and user_id = p_new_admin
        and user_id <> auth.uid()
    ) then
      raise exception 'Le successeur doit être un autre membre de cet arbre.';
    end if;
    update public.family_members
    set role = 'admin'
    where family_id = p_family and user_id = p_new_admin;
  end if;

  delete from public.family_members
  where family_id = p_family and user_id = auth.uid();
end;
$$;

grant execute on function public.delete_family(uuid) to authenticated;
grant execute on function public.list_family_members(uuid) to authenticated;
grant execute on function public.family_member_count(uuid) to authenticated;
grant execute on function public.leave_family(uuid, uuid) to authenticated;
