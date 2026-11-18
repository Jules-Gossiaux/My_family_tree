-- Où joindre une personne, et où elle repose : adresse, téléphone, e-mail, cimetière.
--
-- Quatre textes libres sur la personne, pas des faits de la vie : une adresse se corrige sans
-- laisser de trace, et le cimetière ne se montre que pour une personne décédée. Les mêmes règles
-- que sur le disque (server/index.ts) : un texte vide rend la colonne à NULL, ce qui n'est pas
-- nommé ne bouge pas. Les fonctions sont redéfinies à l'identique, garde en français compris.

alter table public.person
  add column address text,
  add column phone text,
  add column email text,
  add column cemetery text;

-- La personne rendue à l'écran porte désormais ses quatre champs de contact.
create or replace function public.person_json(p public.person) returns jsonb
language sql stable security invoker set search_path = ''
as $$
  select jsonb_build_object(
    'id', p.id,
    'givenNames', p.given_names,
    'familyName', p.family_name,
    'birthName', p.birth_name,
    'sex', p.sex,
    'living', p.living,
    'summary', p.summary,
    'branchId', p.branch_id,
    'portraitMediaId', p.portrait_media_id,
    'address', p.address,
    'phone', p.phone,
    'email', p.email,
    'cemetery', p.cemetery,
    'birth', (
      select public.gdate(e.date_min, e.date_max, e.date_qualifier, e.date_text)
        from public.event e
       where e.person_id = p.id and e.type = 'naissance'
       order by e.created_at
       limit 1
    ),
    'death', (
      select public.gdate(e.date_min, e.date_max, e.date_qualifier, e.date_text)
        from public.event e
       where e.person_id = p.id and e.type = 'deces'
       order by e.created_at
       limit 1
    )
  );
$$;

-- Une personne nouvelle, ses deux dates de vie, ses coordonnées et le premier lien que l'on en dit.
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
    id, given_names, family_name, birth_name, sex, living,
    address, phone, email, cemetery, created_at, updated_at
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
    nullif(btrim(coalesce(p->>'address', '')), ''),
    nullif(btrim(coalesce(p->>'phone', '')), ''),
    nullif(btrim(coalesce(p->>'email', '')), ''),
    nullif(btrim(coalesce(p->>'cemetery', '')), ''),
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

-- Corriger une personne : les quatre champs suivent la même règle que le reste — ce qui n'est
-- pas nommé ne bouge pas, un texte vidé rend la colonne à NULL.
create or replace function public.update_person(p_id text, p jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_trimmed text;
  v_media   text;
  v_branch  text;
  v_nick    text;
begin
  if not public.can_write() then
    raise exception 'Vous consultez cet arbre sans droit de modification.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.person where id = p_id) then
    raise exception 'Personne introuvable';
  end if;

  if p ? 'givenNames' then
    v_trimmed := btrim(coalesce(p->>'givenNames', ''));
    if v_trimmed = '' then
      raise exception 'Le prénom est obligatoire';
    end if;
    update public.person set given_names = v_trimmed, updated_at = now()::text where id = p_id;
  end if;

  if p ? 'familyName' then
    update public.person set family_name = btrim(coalesce(p->>'familyName', '')),
                             updated_at = now()::text
      where id = p_id;
  end if;

  if p ? 'birthName' then
    update public.person set birth_name = nullif(p->>'birthName', ''), updated_at = now()::text
      where id = p_id;
  end if;

  if p ? 'sex' then
    v_trimmed := coalesce(nullif(p->>'sex', ''), '?');
    if v_trimmed not in ('M', 'F', 'X', '?') then
      raise exception 'Le sexe se dit homme, femme, autre ou inconnu.';
    end if;
    update public.person set sex = v_trimmed, updated_at = now()::text where id = p_id;
  end if;

  if jsonb_typeof(p->'living') = 'boolean' then
    update public.person set living = (p->>'living')::boolean, updated_at = now()::text where id = p_id;
  end if;

  if p ? 'address' then
    update public.person set address = nullif(btrim(coalesce(p->>'address', '')), ''),
                             updated_at = now()::text
      where id = p_id;
  end if;

  if p ? 'phone' then
    update public.person set phone = nullif(btrim(coalesce(p->>'phone', '')), ''),
                             updated_at = now()::text
      where id = p_id;
  end if;

  if p ? 'email' then
    update public.person set email = nullif(btrim(coalesce(p->>'email', '')), ''),
                             updated_at = now()::text
      where id = p_id;
  end if;

  if p ? 'cemetery' then
    update public.person set cemetery = nullif(btrim(coalesce(p->>'cemetery', '')), ''),
                             updated_at = now()::text
      where id = p_id;
  end if;

  if p ? 'birthText' then
    perform public.set_person_date(p_id, 'naissance', p->>'birthText', p->'birthDate');
  end if;

  if p ? 'deathText' then
    perform public.set_person_date(p_id, 'deces', p->>'deathText', p->'deathDate');
    if btrim(coalesce(p->>'deathText', '')) <> '' then
      update public.person set living = false, updated_at = now()::text where id = p_id;
    end if;
  end if;

  -- Un seul surnom, comme sur la fiche : la liste des noms variants garde les autres usages.
  if p ? 'nickname' then
    delete from public.name_variant where person_id = p_id and type = 'surnom';
    v_nick := btrim(coalesce(p->>'nickname', ''));
    if v_nick <> '' then
      insert into public.name_variant (id, person_id, name, type)
        values (gen_random_uuid()::text, p_id, v_nick, 'surnom');
    end if;
  end if;

  if p ? 'portraitMediaId' then
    v_media := nullif(p->>'portraitMediaId', '');
    if v_media is not null and not exists (
      select 1 from public.media_person where media_id = v_media and person_id = p_id
    ) then
      raise exception 'Choisissez d’abord la personne sur cette photo.';
    end if;
    update public.person set portrait_media_id = v_media where id = p_id;
  end if;

  if p ? 'branchId' then
    v_branch := nullif(p->>'branchId', '');
    if v_branch is not null and not exists (select 1 from public.branch where id = v_branch) then
      raise exception 'Cette branche n’existe plus dans la base.';
    end if;
    update public.person set branch_id = v_branch, updated_at = now()::text where id = p_id;
  end if;
end;
$$;

revoke execute on function
  public.person_json(public.person),
  public.create_person(jsonb),
  public.update_person(text, jsonb)
from public, anon;

grant execute on function
  public.person_json(public.person),
  public.create_person(jsonb),
  public.update_person(text, jsonb)
to authenticated;