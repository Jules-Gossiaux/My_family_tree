-- Dire le refus en français. Un compte en lecture seule qui essaie d’écrire un fait se heurtait à
-- RLS et recevait un message de Postgres en anglais, quand toutes les autres écritures de l’arbre
-- disent déjà « Vous consultez cet arbre sans droit de modification. ». Celles-là étaient passées
-- entre les mailles du filet. Le garde se pose en tête, rien d’autre ne bouge : les dates, les lieux
-- tapés à la main, la naissance unique par personne restent réglés comme avant.
--
-- delete_event passe de language sql à language plpgsql : un bloc sql ne peut pas lever une
-- exception. La signature ne change pas, donc les droits accordés sur la fonction survivent.

create or replace function public.create_event(p jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_person  text := nullif(p->>'personId', '');
  v_couple  text := nullif(p->>'coupleId', '');
  v_type    text := coalesce(nullif(btrim(coalesce(p->>'type', '')), ''), 'autre');
  v_conf    text := coalesce(nullif(p->>'confidence', ''), 'certain');
  v_date    jsonb := coalesce(p->'date', '{}'::jsonb);
  v_min     text := nullif(v_date->>'min', '');
  v_max     text := nullif(v_date->>'max', '');
  v_qual    text := nullif(v_date->>'qualifier', '');
  v_text    text := nullif(v_date->>'text', '');
  v_place_id   text := nullif(p->>'placeId', '');
  v_place_name text := nullif(btrim(coalesce(p->>'placeName', '')), '');
  v_source  text := nullif(p->>'sourceId', '');
  v_description text := nullif(btrim(coalesce(p->>'description', '')), '');
  v_place   text;
  v_row     public.event;
begin
  if not public.can_write() then
    raise exception 'Vous consultez cet arbre sans droit de modification.' using errcode = '42501';
  end if;
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

  if v_type not in ('naissance', 'bapteme', 'deces', 'inhumation', 'profession', 'residence', 'autre') then
    raise exception 'Ce fait n’est pas de ceux que l’arbre sait ranger.';
  end if;
  if v_conf not in ('certain', 'probable', 'douteux') then
    raise exception 'La fiabilité se dit certaine, probable ou douteuse.';
  end if;
  if v_qual is not null
     and v_qual not in ('exact', 'about', 'before', 'after', 'between', 'unknown') then
    raise exception 'Ce qualificatif de date n’est pas un de ceux que l’arbre comprend.';
  end if;
  if (v_min is not null and v_min !~ '^[0-9]{1,9}(-[0-9]{1,2}){0,2}$')
     or (v_max is not null and v_max !~ '^[0-9]{1,9}(-[0-9]{1,2}){0,2}$') then
    raise exception 'Une date range ne se dit qu’en années, mois ou jours chiffrés.';
  end if;

  -- Une naissance et un décès ne se déclarent qu'une fois par personne : la seconde écriture est
  -- toujours une correction, et une correction se fait sur la ligne qui existe déjà.
  if v_person is not null and v_type in ('naissance', 'deces')
     and exists (select 1 from public.event where person_id = v_person and type = v_type) then
    raise exception 'Cette personne a déjà un événement « % » : modifiez-le au lieu d’en écrire un second.',
      case v_type when 'naissance' then 'Naissance' else 'Décès' end;
  end if;

  if v_source is not null and not exists (select 1 from public.source where id = v_source) then
    raise exception 'Cette source n’existe pas dans la base.';
  end if;

  -- Le lieu tapé devient une ligne, une seule par nom : « Roubaix » écrit trois fois ne doit pas
  -- faire trois lieux. Tout le reste étant validé, un refus ne laisse donc pas un lieu orphelin.
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
  end if;

  insert into public.event (
    id, person_id, couple_id, type, date_min, date_max, date_qualifier, date_text,
    place_id, description, source_id, confidence, created_at
  ) values (
    gen_random_uuid()::text, v_person, v_couple, v_type, v_min, v_max, v_qual, v_text,
    v_place, v_description, v_source, v_conf, now()::text
  ) returning * into v_row;

  return public.event_json(v_row);
end;
$$;

create or replace function public.delete_event(p_id text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not public.can_write() then
    raise exception 'Vous consultez cet arbre sans droit de modification.' using errcode = '42501';
  end if;
  -- Une note posée sur un fait effacé n'a plus de sujet : elle partirait avec lui en silence, ou
  -- resterait à citer une ligne qui n'existe plus.
  delete from public.note where target_type = 'event' and target_id = p_id;
  delete from public.event where id = p_id;
end;
$$;

revoke execute on function public.create_event(jsonb), public.delete_event(text) from public, anon;
grant execute on function public.create_event(jsonb), public.delete_event(text) to authenticated;
