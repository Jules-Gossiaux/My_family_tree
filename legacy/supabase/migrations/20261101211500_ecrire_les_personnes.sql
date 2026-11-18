-- Écrire une personne et rattacher deux personnes entre elles.
--
-- Les règles viennent du serveur local (server/index.ts, server/relations.ts) et sont recopiées
-- telle quelle : un enfant ne peut avoir que deux parents, une union n'existe que si quelqu'un la
-- déclare, une personne ne peut pas être son propre ascendant. Ce qui change est l'endroit où elles
-- sont vérifiées — la base, et plus un ordinateur — parce que plusieurs écritures arrivent désormais
-- de plusieurs navigateurs en même temps.
--
-- Rien ici ne touche la souche : l'arbre en ligne n'en garde pas. Le serveur local posait le premier
-- visage comme point de départ ; la reprise ferait réapparaître un choix que l'écran a retiré.

/** `p_person` est-il enfant, petit-enfant ou arrière-petit-enfant de `p_ancestor` ? */
create or replace function public.is_descendant_of(p_person text, p_ancestor text)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  with recursive ascendes(id) as (
    select pc.parent_id from public.parent_child pc where pc.child_id = p_person
    union
    select pc.parent_id from public.parent_child pc join ascendes a on a.id = pc.child_id
  )
  select exists (select 1 from ascendes where id = p_ancestor);
$$;

/** L'union de deux personnes déjà connues : on la retrouve, ou on l'écrit. Jamais deux fois la même. */
create or replace function public.upsert_couple(p_a text, p_b text)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id text;
begin
  select id into v_id from public.couple
    where (partner_a = p_a and partner_b = p_b) or (partner_a = p_b and partner_b = p_a)
    limit 1;
  if v_id is not null then return v_id; end if;

  v_id := gen_random_uuid()::text;
  insert into public.couple (id, partner_a, partner_b, created_at)
    values (v_id, p_a, p_b, now()::text);
  return v_id;
end;
$$;

/** Un lien père-enfant se déclare une fois : la seconde fois, il ne fait que changer d'union. */
create or replace function public.link_parent_child(p_parent text, p_child text, p_couple text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id     text;
  v_couple text;
begin
  select id, couple_id into v_id, v_couple from public.parent_child
    where parent_id = p_parent and child_id = p_child
    limit 1;

  if v_id is not null then
    if p_couple is not null and v_couple is null then
      update public.parent_child set couple_id = p_couple where id = v_id;
    end if;
    return;
  end if;

  insert into public.parent_child (id, parent_id, child_id, couple_id)
    values (gen_random_uuid()::text, p_parent, p_child, p_couple);
end;
$$;

/**
 * Une union déclarée vaut aussi pour les enfants que la base connaît déjà des deux : rattachés
 * parent par parent, ils pendaient sous chaque case, ils pendront désormais sous la jonction.
 * Un lien déjà attribué à une autre union n'est pas touché.
 */
create or replace function public.attribute_children_to_couple(p_couple text, p_a text, p_b text)
returns void
language sql
security invoker
set search_path = ''
as $$
  update public.parent_child set couple_id = p_couple
    where couple_id is null
      and child_id in (select child_id from public.parent_child where parent_id = p_a)
      and child_id in (select child_id from public.parent_child where parent_id = p_b);
$$;

/**
 * La date de naissance ou de décès d'une personne : le texte vide efface le fait, un texte que la
 * grammaire ne lit pas laisse une ligne qui ne porte que ce texte — rien n'est jamais rangé comme
 * une année inventée. La date arrive déjà lue par server/dates.ts, que le navigateur importe.
 */
create or replace function public.set_person_date(
  p_person text,
  p_type text,
  p_text text,
  p_date jsonb
) returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_d       jsonb := coalesce(p_date, '{}'::jsonb);
  v_texte   text  := btrim(coalesce(p_text, ''));
  v_min     text  := nullif(v_d->>'min', '');
  v_max     text  := nullif(v_d->>'max', '');
  v_qual    text  := coalesce(nullif(v_d->>'qualifier', ''), 'unknown');
  v_date    text  := coalesce(nullif(v_d->>'text', ''), nullif(v_texte, ''));
  v_exists  boolean;
begin
  if v_texte = '' then
    -- Une note posée sur un fait effacé n'a plus de sujet : `note` n'a pas de clé étrangère.
    delete from public.note
      where target_type = 'event'
        and target_id in (select id from public.event where person_id = p_person and type = p_type);
    delete from public.event where person_id = p_person and type = p_type;
    return;
  end if;

  select exists (
    select 1 from public.event where person_id = p_person and type = p_type
  ) into v_exists;

  if v_exists then
    update public.event
       set date_min = v_min, date_max = v_max, date_qualifier = v_qual, date_text = v_date
     where person_id = p_person and type = p_type;
    return;
  end if;

  insert into public.event (
    id, person_id, type, date_min, date_max, date_qualifier, date_text, created_at
  ) values (
    gen_random_uuid()::text, p_person, p_type, v_min, v_max, v_qual, v_date, now()::text
  );
end;
$$;

/**
 * Rattache deux personnes que la base connaît déjà.
 *
 * `p->>'type'` décrit la personne soumise par rapport à `ofPersonId` : « child » = elle en est
 * l'enfant, « parent » = elle en est le parent, « partner » = union.
 */
create or replace function public.attach_relation(p_subject_id text, p jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_type    text := p->>'type';
  v_other   text := nullif(p->>'ofPersonId', '');
  v_second  text := nullif(p->>'otherParentId', '');
  v_parent  text;
  v_child   text;
  v_couple  text;
  v_parents text[];
begin
  if not public.can_write() then
    raise exception 'Vous consultez cet arbre sans droit de modification.' using errcode = '42501';
  end if;

  if p_subject_id is null then
    raise exception 'Il manque la personne concernée (personne à rattacher).';
  end if;
  if not exists (select 1 from public.person where id = p_subject_id) then
    raise exception 'Cette personne n’existe plus dans la base.';
  end if;
  if v_type is null or v_type not in ('child', 'parent', 'partner') then
    raise exception 'Type de relation inconnu.';
  end if;
  if v_other is null then
    raise exception 'Il manque la personne concernée (personne visée).';
  end if;
  if not exists (select 1 from public.person where id = v_other) then
    raise exception 'Cette personne n’existe plus dans la base.';
  end if;

  if v_type = 'partner' then
    if v_other = p_subject_id then
      raise exception 'Une personne ne peut pas être son propre conjoint.';
    end if;
    v_couple := public.upsert_couple(p_subject_id, v_other);
    perform public.attribute_children_to_couple(v_couple, p_subject_id, v_other);
    return;
  end if;

  if v_type = 'child' then
    v_parent := v_other;
    v_child  := p_subject_id;
  else
    v_parent := p_subject_id;
    v_child  := v_other;
  end if;

  if v_parent = v_child then
    raise exception 'Une personne ne peut pas être son propre parent.';
  end if;
  if public.is_descendant_of(v_parent, v_child) then
    raise exception 'Impossible : cette personne est déjà descendante de l’autre — cela créerait une boucle.'
      using errcode = 'P0001';
  end if;

  if v_second is not null then
    if not exists (select 1 from public.person where id = v_second) then
      raise exception 'Cette personne n’existe plus dans la base (autre parent).';
    end if;
    if v_second = v_parent or v_second = v_child then
      raise exception 'L’autre parent doit être une personne différente.';
    end if;
  end if;

  -- Les parents déjà écrits plus ceux que l'on veut ajouter : trois, c'est un acte de trop.
  select coalesce(array_agg(distinct pc.parent_id), '{}'::text[])
    into v_parents
    from public.parent_child pc
   where pc.child_id = v_child;

  if not (v_parent = any(v_parents)) then v_parents := v_parents || v_parent; end if;
  if v_second is not null and not (v_second = any(v_parents)) then
    v_parents := v_parents || v_second;
  end if;
  if array_length(v_parents, 1) > 2 then
    raise exception 'Cette personne a déjà deux parents. Commencez par en remplacer un.'
      using errcode = 'P0001';
  end if;

  -- Sans second parent, l'enfant se rattache à ce parent seul : l'arbre le dessinera sous sa case
  -- à lui, pas sous une jonction qu'aucun acte ne confirme.
  if v_second is null then
    perform public.link_parent_child(v_parent, v_child, null);
    return;
  end if;

  v_couple := public.upsert_couple(v_parent, v_second);
  perform public.link_parent_child(v_parent, v_child, v_couple);
  perform public.link_parent_child(v_second, v_child, v_couple);
  perform public.attribute_children_to_couple(v_couple, v_parent, v_second);
end;
$$;

/** Une personne nouvelle, ses deux dates de vie, et le premier lien que l'on en dit. */
create or replace function public.create_person(p jsonb)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_given  text := btrim(coalesce(p->>'givenNames', ''));
  v_family text := btrim(coalesce(p->>'familyName', ''));
  v_sex    text := coalesce(nullif(p->>'sex', ''), '?');
  v_birth  text := btrim(coalesce(p->>'birthText', ''));
  v_death  text := btrim(coalesce(p->>'deathText', ''));
  v_id     text;
begin
  if not public.can_write() then
    raise exception 'Vous consultez cet arbre sans droit de modification.' using errcode = '42501';
  end if;
  if v_given = '' then
    raise exception 'Le prénom est obligatoire';
  end if;
  if v_sex not in ('M', 'F', 'X', '?') then
    raise exception 'Le sexe se dit homme, femme, autre ou inconnu.';
  end if;

  v_id := gen_random_uuid()::text;
  insert into public.person (
    id, given_names, family_name, birth_name, sex, living, created_at, updated_at
  ) values (
    v_id,
    v_given,
    v_family,
    nullif(p->>'birthName', ''),
    v_sex,
    -- Une date de décès dit déjà que la vie est close : personne n'a à la cocher en plus.
    case
      when v_death <> '' then false
      when p->>'living' in ('true', 'false') then (p->>'living')::boolean
      else true
    end,
    now()::text,
    now()::text
  );

  perform public.set_person_date(v_id, 'naissance', v_birth, p->'birthDate');
  perform public.set_person_date(v_id, 'deces', v_death, p->'deathDate');

  if jsonb_typeof(p->'relation') = 'object'
     and nullif(p->'relation'->>'ofPersonId', '') is not null then
    perform public.attach_relation(v_id, p->'relation');
  end if;

  return v_id;
end;
$$;

revoke execute on function
  public.is_descendant_of(text, text),
  public.upsert_couple(text, text),
  public.link_parent_child(text, text, text),
  public.attribute_children_to_couple(text, text, text),
  public.set_person_date(text, text, text, jsonb),
  public.attach_relation(text, jsonb),
  public.create_person(jsonb)
from public, anon;

grant execute on function
  public.is_descendant_of(text, text),
  public.upsert_couple(text, text),
  public.link_parent_child(text, text, text),
  public.attribute_children_to_couple(text, text, text),
  public.set_person_date(text, text, text, jsonb),
  public.attach_relation(text, jsonb),
  public.create_person(jsonb)
to authenticated;
