-- Écrire les branches : un nom, une teinte, et le rang de toute une descendance.
--
-- Une branche est la couleur d'une case sur l'arbre. Trois choses la font exister : un nom qui la
-- distingue, une teinte que personne d'autre ne porte déjà, et les personnes qu'elle range. Les
-- règles viennent de server/branches.ts et sont recopiées, messages compris — y compris la palette
-- des huit teintes, parce qu'un arbre qui change de couleurs selon l'endroit où on l'ouvre se relit
-- mal.
--
-- Rien n'est déplacé au passage : `assign_descendants` ne prend que les personnes encore hors
-- classe. Une branche ne vole pas ses gens à une autre branche, ce serait effacer un choix fait à la
-- main. Et effacer une branche rend ses personnes au hors-classe tout seul : `person.branch_id` est
-- en `on delete set null`.

/** La branche telle que l'arbre la lit : sa couleur et combien de cases elle habille. */
create or replace function public.branch_json(b public.branch)
returns jsonb
language sql stable security invoker set search_path = ''
as $$
  select jsonb_build_object(
    'id', b.id,
    'name', b.name,
    'color', b.color,
    'rootPersonId', b.root_person_id,
    'personCount', (select count(*) from public.person p where p.branch_id = b.id)
  );
$$;

/** Deux branches homonymes ne se lisent pas sur l'arbre : le nom seul les porte. */
create or replace function public.checked_branch_name(p_name text, p_except text)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_nom  text := btrim(coalesce(p_name, ''));
  v_pris boolean := false;
begin
  if v_nom = '' then
    raise exception 'Une branche porte un nom : sans lui, rien ne la distingue des autres.';
  end if;

  select exists (
    select 1 from public.branch
     where lower(name) = lower(v_nom) and id is distinct from p_except
  ) into v_pris;
  if v_pris then
    raise exception 'Une branche porte déjà ce nom : « % ».', v_nom;
  end if;

  return v_nom;
end;
$$;

/**
 * Une teinte se donne en hexadécimal et ne se partage pas : deux branches de la même couleur se
 * lisent comme une seule ligne. Le nom de l'autre branche est dans le refus, pour que l'on sache
 * laquelle recololorier.
 */
create or replace function public.checked_branch_color(p_color text, p_except text)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_teinte text := lower(btrim(coalesce(p_color, '')));
  v_prise  text;
begin
  if v_teinte !~ '^#[0-9a-f]{6}$' then
    raise exception 'Une couleur se donne en hexadécimal, par exemple #c9a961.';
  end if;

  select name into v_prise from public.branch
    where lower(color) = v_teinte and id is distinct from p_except limit 1;
  if v_prise is not null then
    raise exception 'Une autre branche porte déjà cette teinte : « % ».', v_prise;
  end if;

  return v_teinte;
end;
$$;

/** La première teinte que personne d'autre ne porte déjà ; à palette pleine, on la recommence. */
create or replace function public.free_branch_color()
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  -- Les huit teintes qui se distinguent sur le fond sombre de l'arbre.
  v_palette text[] := array['#c9a961', '#5fb0a7', '#d98a8a', '#8fbf6f', '#a78bd9', '#e0a24c', '#6fa8dc', '#c77da9'];
  v_libre   text;
begin
  select c into v_libre
    from unnest(v_palette) with ordinality as t(c, n)
   where not exists (select 1 from public.branch b where lower(b.color) = t.c)
   order by t.n limit 1;
  if v_libre is not null then
    return v_libre;
  end if;

  return v_palette[(select count(*) % 8 from public.branch) + 1];
end;
$$;

/**
 * Range une ligne : la personne et ses descendants, jamais plus bas que ce qui est déjà classé.
 * La descendance se monte lien par lien en gardant le chemin déjà parcouru : une famille qui se
 * marie entre cousins tournerait sinon sans fin.
 */
create or replace function public.assign_descendants(p_branch_id text, p_root_person_id text)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_range integer;
begin
  with recursive rang(id, chemin) as (
      select p_root_person_id, array[p_root_person_id]
    union all
      select pc.child_id, r.chemin || pc.child_id
        from rang r
        join public.parent_child pc on pc.parent_id = r.id
       where not pc.child_id = any (r.chemin)
  ),
  deplaces as (
    update public.person p
       set branch_id = p_branch_id, updated_at = now()::text
      from rang r
     where p.id = r.id and p.branch_id is null
    returning 1
  )
  select count(*) into v_range from deplaces;

  return v_range;
end;
$$;

/**
 * Une branche nouvelle. Sa tête, si on la nomme, range toute sa descendance dans le même geste :
 * c'est le plus long à faire case par case et le premier que l'on a envie de faire.
 */
create or replace function public.create_branch(p jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id     text := gen_random_uuid()::text;
  v_nom    text;
  v_teinte text;
  v_racine text := nullif(btrim(coalesce(p->>'rootPersonId', '')), '');
begin
  if not public.can_write() then
    raise exception 'Vous consultez cet arbre sans droit de modification.' using errcode = '42501';
  end if;

  v_nom := public.checked_branch_name(p->>'name', null);
  v_teinte := case
    when nullif(btrim(coalesce(p->>'color', '')), '') is null then public.free_branch_color()
    else public.checked_branch_color(p->>'color', null)
  end;

  if v_racine is not null
     and not exists (select 1 from public.person where id = v_racine) then
    raise exception 'Cette personne n’existe plus dans la base.';
  end if;

  insert into public.branch (id, name, color, root_person_id, created_at)
    values (v_id, v_nom, v_teinte, v_racine, now()::text);

  if v_racine is not null and coalesce(p->>'includeDescendants', 'true') <> 'false' then
    perform public.assign_descendants(v_id, v_racine);
  end if;

  return (select public.branch_json(b) from public.branch b where b.id = v_id);
end;
$$;

/** Renommer, changer de teinte, changer de tête : le rang des personnes ne bouge pas ici. */
create or replace function public.update_branch(p_id text, p jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_courant public.branch;
  v_racine  text;
  v_change  boolean := false;
begin
  if not public.can_write() then
    raise exception 'Vous consultez cet arbre sans droit de modification.' using errcode = '42501';
  end if;

  select * into v_courant from public.branch where id = p_id;
  if v_courant.id is null then
    raise exception 'Cette branche n’existe plus dans la base.';
  end if;

  -- La tête se vérifie avant d'écrire quoi que ce soit : un refus n'est jamais à moitié passé.
  if p ? 'rootPersonId' then
    v_change := true;
    v_racine := nullif(btrim(coalesce(p->>'rootPersonId', '')), '');
    if v_racine is not null
       and not exists (select 1 from public.person where id = v_racine) then
      raise exception 'Cette personne n’existe plus dans la base.';
    end if;
  end if;

  if p ? 'name' then
    update public.branch set name = public.checked_branch_name(p->>'name', p_id) where id = p_id;
  end if;

  if p ? 'color' then
    update public.branch set color = public.checked_branch_color(p->>'color', p_id) where id = p_id;
  end if;

  if v_change then
    update public.branch set root_person_id = v_racine where id = p_id;
  end if;

  return (select public.branch_json(b) from public.branch b where id = p_id);
end;
$$;

/**
 * Ranger la descendance sous une branche dont la tête est déjà choisie. Sans tête, rien ne part de
 * nulle part : la branche se règle d'abord, puis se remplit.
 */
create or replace function public.branch_descendants(p_id text, p_root_person_id text default null)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_branche public.branch;
  v_racine  text := nullif(btrim(coalesce(p_root_person_id, '')), '');
begin
  if not public.can_write() then
    raise exception 'Vous consultez cet arbre sans droit de modification.' using errcode = '42501';
  end if;

  select * into v_branche from public.branch where id = p_id;
  if v_branche.id is null then
    raise exception 'Cette branche n’existe plus dans la base.';
  end if;

  if v_racine is null then
    v_racine := v_branche.root_person_id;
  end if;
  if v_racine is null then
    raise exception 'Cette branche n’a encore personne dont partir : choisissez d’abord sa tête, puis rangez.';
  end if;
  if not exists (select 1 from public.person where id = v_racine) then
    raise exception 'Cette personne n’existe plus dans la base.';
  end if;

  return public.assign_descendants(p_id, v_racine);
end;
$$;

/** Effacer une branche rend ses personnes au hors-classe ; aucune personne ne se perd en route. */
create or replace function public.delete_branch(p_id text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not public.can_write() then
    raise exception 'Vous consultez cet arbre sans droit de modification.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.branch where id = p_id) then
    raise exception 'Cette branche n’existe plus dans la base.';
  end if;

  delete from public.branch where id = p_id;
end;
$$;

revoke execute on function
  public.branch_json(public.branch),
  public.checked_branch_name(text, text),
  public.checked_branch_color(text, text),
  public.free_branch_color(),
  public.assign_descendants(text, text),
  public.create_branch(jsonb),
  public.update_branch(text, jsonb),
  public.branch_descendants(text, text),
  public.delete_branch(text)
from public, anon;

grant execute on function
  public.branch_json(public.branch),
  public.checked_branch_name(text, text),
  public.checked_branch_color(text, text),
  public.free_branch_color(),
  public.assign_descendants(text, text),
  public.create_branch(jsonb),
  public.update_branch(text, jsonb),
  public.branch_descendants(text, text),
  public.delete_branch(text)
to authenticated;
