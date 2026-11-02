-- Corriger une personne, l'effacer, corriger un fait de sa vie.
--
-- Le serveur local ne touchait qu'un fichier SQLite sur ce disque ; ici, la même écriture arrive
-- d'un navigateur et se applique à une base que d'autres lisent pendant l'écriture. Les règles sont
-- donc recopiées mot pour mot (server/index.ts, server/life-events.ts), et les messages que la
-- famille lit sont ceux qu'elle a toujours lus.
--
-- Deux choses se font toutes seules et ne demandent plus de code : `tree_setting.root_person_id` et
-- `family_member.person_id` sont en `on delete set null`, donc effacer une personne rend sa souche à
-- l'absence et éteint le « moi » de qui la désignait. C'est exactement ce que l'écran veut — l'arbre
-- en ligne ne garde pas de souche épinglée.

/**
 * Une union ne sert pas qu'à dessiner deux cases côte à côte : elle porte la mémoire de l'union dont
 * des enfants sont issus. Elle ne disparaît donc que quand plus personne ne la justifie — ni un
 * enfant, ni un acte, ni l'un de ses deux membres.
 */
create or replace function public.prune_empty_couples()
returns void
language sql
security invoker
set search_path = ''
as $$
  delete from public.note
   where target_type = 'couple'
     and target_id in (
       select c.id from public.couple c
        where c.partner_a is null and c.partner_b is null
          and c.id not in (select pc.couple_id from public.parent_child pc where pc.couple_id is not null)
          and c.id not in (select e.couple_id from public.event e where e.couple_id is not null)
     );

  delete from public.couple c
   where c.partner_a is null and c.partner_b is null
     and c.id not in (select pc.couple_id from public.parent_child pc where pc.couple_id is not null)
     and c.id not in (select e.couple_id from public.event e where e.couple_id is not null);
$$;

/**
 * Corriger un fait de la vie. Ce qui n'est pas nommé ne bouge pas : la fiche n'envoie que ce que
 * l'on a touché, et une date que l'on ne dit pas n'est pas une date que l'on efface.
 */
create or replace function public.update_event(p_id text, p jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_row        public.event;
  v_courant    public.event;
  v_type       text;
  v_person     text;
  v_couple     text;
  v_conf       text;
  v_description text;
  v_source     text;
  v_place_id   text;
  v_place_name text;
  v_place      text;
  v_date       jsonb;
  v_min        text;
  v_max        text;
  v_qual       text;
  v_text       text;
begin
  if not public.can_write() then
    raise exception 'Vous consultez cet arbre sans droit de modification.' using errcode = '42501';
  end if;

  select * into v_courant from public.event where id = p_id;
  if v_courant.id is null then
    raise exception 'Cet événement n’existe pas dans la base.';
  end if;

  v_type := case
    when p ? 'type' then lower(btrim(coalesce(p->>'type', '')))
    else v_courant.type
  end;
  if v_type not in ('naissance', 'bapteme', 'deces', 'inhumation', 'profession', 'residence', 'autre') then
    raise exception 'Ce fait n’est pas de ceux que l’arbre sait ranger.';
  end if;

  v_person := case when p ? 'personId' then nullif(p->>'personId', '') else v_courant.person_id end;
  v_couple := case when p ? 'coupleId' then nullif(p->>'coupleId', '') else v_courant.couple_id end;
  if v_person is null and v_couple is null then
    raise exception 'Un événement se rattache à une personne ou à une union : dites lequel.';
  end if;
  if v_person is not null and v_couple is not null then
    raise exception 'Un événement porte une personne ou une union, pas les deux à la fois.';
  end if;
  if v_person is not null and not exists (select 1 from public.person where id = v_person) then
    raise exception 'Cette personne n’existe pas dans la base.';
  end if;
  if v_couple is not null and not exists (select 1 from public.couple where id = v_couple) then
    raise exception 'Cette union n’existe pas dans la base.';
  end if;

  -- Le fait que l'on corrige est celui que l'on compare aux autres : il ne se compte pas deux fois.
  if v_person is not null and v_type in ('naissance', 'deces')
     and exists (
       select 1 from public.event
        where person_id = v_person and type = v_type and id <> p_id
     ) then
    raise exception 'Cette personne a déjà un événement « % » : modifiez-le au lieu d’en écrire un second.',
      case v_type when 'naissance' then 'Naissance' else 'Décès' end;
  end if;

  if p ? 'dateText' then
    v_date := coalesce(p->'date', '{}'::jsonb);
    v_min  := nullif(v_date->>'min', '');
    v_max  := nullif(v_date->>'max', '');
    v_qual := coalesce(nullif(v_date->>'qualifier', ''), 'unknown');
    v_text := nullif(v_date->>'text', '');
    if (v_min is not null and v_min !~ '^[0-9]{1,9}(-[0-9]{1,2}){0,2}$')
       or (v_max is not null and v_max !~ '^[0-9]{1,9}(-[0-9]{1,2}){0,2}$') then
      raise exception 'Une date range ne se dit qu’en années, mois ou jours chiffrés.';
    end if;
    if v_qual not in ('exact', 'about', 'before', 'after', 'between', 'unknown') then
      raise exception 'Ce qualificatif de date n’est pas un de ceux que l’arbre comprend.';
    end if;
  else
    v_min  := v_courant.date_min;
    v_max  := v_courant.date_max;
    v_qual := v_courant.date_qualifier;
    v_text := v_courant.date_text;
  end if;

  -- Le lieu se dit par son identifiant ou par le nom que l'on tape, et le nom trouvé ou créé suit
  -- la même règle que la création d'un fait : un nom écrit deux fois ne fait qu'une ligne.
  if p ? 'placeId' and p ? 'placeName' then
    raise exception 'Un lieu se dit par son nom ou par son identifiant, pas les deux.';
  end if;
  if p ? 'placeName' then
    v_place_name := nullif(btrim(coalesce(p->>'placeName', '')), '');
    v_place_id   := null;
  else
    v_place_name := null;
    v_place_id   := case when p ? 'placeId' then nullif(p->>'placeId', '') else v_courant.place_id end;
  end if;

  if v_place_id is not null then
    if not exists (select 1 from public.place where id = v_place_id) then
      raise exception 'Ce lieu n’existe pas dans la base.';
    end if;
    v_place := v_place_id;
  elsif v_place_name is not null then
    select id into v_place from public.place where lower(name) = lower(v_place_name) limit 1;
    if v_place is null then
      v_place := gen_random_uuid()::text;
      insert into public.place (id, name) values (v_place, v_place_name);
    end if;
  else
    v_place := null;
  end if;

  v_source := case when p ? 'sourceId' then nullif(p->>'sourceId', '') else v_courant.source_id end;
  if v_source is not null and not exists (select 1 from public.source where id = v_source) then
    raise exception 'Cette source n’existe pas dans la base.';
  end if;

  v_conf := case
    when p ? 'confidence' then lower(btrim(coalesce(p->>'confidence', '')))
    else v_courant.confidence
  end;
  if v_conf not in ('certain', 'probable', 'douteux') then
    raise exception 'La fiabilité se dit certaine, probable ou douteuse.';
  end if;

  v_description := case
    when p ? 'description' then nullif(btrim(coalesce(p->>'description', '')), '')
    else v_courant.description
  end;

  update public.event
     set person_id = v_person, couple_id = v_couple, type = v_type,
         date_min = v_min, date_max = v_max, date_qualifier = v_qual, date_text = v_text,
         place_id = v_place, description = v_description, source_id = v_source, confidence = v_conf
   where id = p_id
   returning * into v_row;

  return public.event_json(v_row);
end;
$$;

/**
 * Corriger une personne. La fiche n'envoie que ce qui a été touché : ce qui n'est pas nommé ne
 * bouge pas, et un texte de date vidé rend le fait au lieu d'inventer une année.
 */
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

/**
 * Effacer une personne. Ce qu'elle portait part avec elle — ses faits, ses liens, ses surnoms, les
 * photos qui n'étaient qu'à elle — et ses notes partent aussi parce que `note` n'a pas de clé
 * étrangère et ne les suivrait pas. Une union qui n'a plus ni membre, ni enfant, ni acte n'a plus
 * de raison d'être : elle s'efface dans le même geste.
 */
create or replace function public.delete_person(p_id text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not public.can_write() then
    raise exception 'Vous consultez cet arbre sans droit de modification.' using errcode = '42501';
  end if;

  delete from public.note
   where (target_type = 'person' and target_id = p_id)
      or (target_type = 'event'
          and target_id in (select id from public.event where person_id = p_id));

  delete from public.person where id = p_id;

  perform public.prune_empty_couples();
end;
$$;

revoke execute on function
  public.prune_empty_couples(),
  public.update_event(text, jsonb),
  public.update_person(text, jsonb),
  public.delete_person(text)
from public, anon;

grant execute on function
  public.prune_empty_couples(),
  public.update_event(text, jsonb),
  public.update_person(text, jsonb),
  public.delete_person(text)
to authenticated;
