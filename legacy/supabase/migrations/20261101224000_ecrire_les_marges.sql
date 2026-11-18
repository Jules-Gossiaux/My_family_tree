-- Écrire les marges, les lieux et les sources.
--
-- Trois objets que la famille touche tous les jours : ce que l'on note en marge, la place où quelque
-- chose s'est passé, et ce qui le prouve. Les règles viennent des modules du serveur local
-- (server/notes.ts, server/places.ts, server/sources.ts) et sont recopiées, messages compris.
--
-- Deux colonnes n'ont pas de clé étrangère et la base ne protège donc pas seule ce qui s'y appuie :
-- `note.target_id` — cinq tables selon la ligne — et `source` citée par les faits et les fichiers.
-- D'où un contrôle explicite à l'écriture, et un refus de supprimer une source encore citée.

/** La note telle que la fiche la montre : son texte et ce qu'elle commente. */
create or replace function public.note_json(n public.note)
returns jsonb
language sql stable security invoker set search_path = ''
as $$
  select jsonb_build_object(
    'id', n.id,
    'body', n.body,
    'targetType', n.target_type,
    'targetId', n.target_id,
    'createdAt', n.created_at
  );
$$;

/** Un lieu, avec ce qui s'y est déjà passé — le compte qui dit s'il faut renommer plutôt qu'effacer. */
create or replace function public.place_json(p public.place)
returns jsonb
language sql stable security invoker set search_path = ''
as $$
  select jsonb_build_object(
    'id', p.id,
    'name', p.name,
    'eventCount', (select count(*) from public.event e where e.place_id = p.id),
    'mediaCount', (select count(*) from public.media m where m.place_id = p.id)
  );
$$;

/** Une source, avec ce qui la cite déjà. */
create or replace function public.source_json(s public.source)
returns jsonb
language sql stable security invoker set search_path = ''
as $$
  select jsonb_build_object(
    'id', s.id,
    'kind', s.kind,
    'label', case s.kind
      when 'acte' then 'Acte'
      when 'photo' then 'Photo'
      when 'temoignage' then 'Témoignage'
      when 'web' then 'Site web'
      when 'livre' then 'Livre'
      else s.kind
    end,
    'reference', s.reference,
    'reliability', s.reliability,
    'eventCount', (select count(*) from public.event e where e.source_id = s.id),
    'mediaCount', (select count(*) from public.media m where m.source_id = s.id)
  );
$$;

/**
 * Une note se pose sur cinq lignes, et `target_id` ne peut pas porter de clé étrangère puisqu'il
 * désigne une table différente selon la ligne : c'est donc ici que la cible est vérifiée.
 */
create or replace function public.create_note(p jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_type   text := lower(btrim(coalesce(p->>'targetType', '')));
  v_target text := nullif(btrim(coalesce(p->>'targetId', '')), '');
  v_body   text := btrim(coalesce(p->>'body', ''));
  v_label  text;
  v_row    public.note;
begin
  if not public.can_write() then
    raise exception 'Vous consultez cet arbre sans droit de modification.' using errcode = '42501';
  end if;

  if v_type not in ('person', 'couple', 'event', 'media', 'place') then
    raise exception 'Une note se pose sur : person, couple, event, media, place.';
  end if;

  v_label := case v_type
    when 'person' then 'cette personne'
    when 'couple' then 'cette union'
    when 'event' then 'ce fait'
    when 'media' then 'ce fichier'
    else 'ce lieu'
  end;

  -- La cible se cherche dans sa propre table : une id inventée ne doit pas écrire une marge
  -- que personne ne relira jamais.
  if v_target is null
     or not (
       (v_type = 'person' and exists (select 1 from public.person where id = v_target))
       or (v_type = 'couple' and exists (select 1 from public.couple where id = v_target))
       or (v_type = 'event' and exists (select 1 from public.event where id = v_target))
       or (v_type = 'media' and exists (select 1 from public.media where id = v_target))
       or (v_type = 'place' and exists (select 1 from public.place where id = v_target))
     ) then
    raise exception 'On ne note pas % : la ligne n’existe pas dans la base.', v_label;
  end if;

  if v_body = '' then
    raise exception 'Une note s’écrit : ce que l’on sait, ce que l’on suppose, ce qu’un cousin raconte.';
  end if;

  insert into public.note (id, body, target_type, target_id, created_at)
    values (gen_random_uuid()::text, v_body, v_type, v_target, now()::text)
    returning * into v_row;

  return public.note_json(v_row);
end;
$$;

/** Corriger une note garde sa date d'écriture : l'écran dit « écrite le », pas « modifiée le ». */
create or replace function public.update_note(p_id text, p jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_body text := btrim(coalesce(p->>'body', ''));
  v_row  public.note;
begin
  if not public.can_write() then
    raise exception 'Vous consultez cet arbre sans droit de modification.' using errcode = '42501';
  end if;
  if v_body = '' then
    raise exception 'Une note s’écrit : ce que l’on sait, ce que l’on suppose, ce qu’un cousin raconte.';
  end if;

  update public.note set body = v_body where id = p_id returning * into v_row;
  if v_row.id is null then
    raise exception 'Cette note n’existe pas dans la base.';
  end if;

  return public.note_json(v_row);
end;
$$;

create or replace function public.delete_note(p_id text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not public.can_write() then
    raise exception 'Vous consultez cet arbre sans droit de modification.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.note where id = p_id) then
    raise exception 'Cette note n’existe pas dans la base.';
  end if;
  delete from public.note where id = p_id;
end;
$$;

/** Renommer ne déplace aucun fait : les lignes qui pointaient ici suivent le nouveau nom. */
create or replace function public.update_place(p_id text, p jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_name  text := btrim(coalesce(p->>'name', ''));
  v_jumeau text;
  v_row   public.place;
begin
  if not public.can_write() then
    raise exception 'Vous consultez cet arbre sans droit de modification.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.place where id = p_id) then
    raise exception 'Ce lieu n’existe pas dans la base.';
  end if;
  if v_name = '' then
    raise exception 'Un lieu se nomme : une ville, un hameau, un pays.';
  end if;

  select name into v_jumeau from public.place
    where lower(name) = lower(v_name) and id <> p_id limit 1;
  if v_jumeau is not null then
    raise exception 'Un lieu porte déjà ce nom : %.', v_jumeau;
  end if;

  update public.place set name = v_name where id = p_id returning * into v_row;
  return public.place_json(v_row);
end;
$$;

/**
 * Effacer un lieu ne touche ni les faits ni les fichiers : leurs colonnes `place_id` sont en
 * `on delete set null`. Le compte rendu dit ce qui reste, parce que c'est ce que l'on veut savoir
 * avant de supprimer — un lieu mal orthographié se corrige, il ne s'efface pas.
 */
create or replace function public.delete_place(p_id text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_events integer;
  v_medias integer;
begin
  if not public.can_write() then
    raise exception 'Vous consultez cet arbre sans droit de modification.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.place where id = p_id) then
    raise exception 'Ce lieu n’existe pas dans la base.';
  end if;

  select count(*) into v_events from public.event where place_id = p_id;
  select count(*) into v_medias from public.media where place_id = p_id;

  delete from public.note where target_type = 'place' and target_id = p_id;
  delete from public.place where id = p_id;

  return jsonb_build_object('ok', true, 'events', v_events, 'media', v_medias);
end;
$$;

/** Une source nouvelle : un genre, une référence qui la distingue, une fiabilité. */
create or replace function public.create_source(p jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_kind   text := lower(btrim(coalesce(p->>'kind', '')));
  v_ref    text := btrim(coalesce(p->>'reference', ''));
  v_rel    text := lower(btrim(coalesce(nullif(p->>'reliability', ''), 'probable')));
  v_pris   text;
  v_row    public.source;
begin
  if not public.can_write() then
    raise exception 'Vous consultez cet arbre sans droit de modification.' using errcode = '42501';
  end if;

  if v_kind = '' then
    raise exception 'Une source se classe : acte, photo, témoignage, web, livre.';
  end if;
  if v_kind not in ('acte', 'photo', 'temoignage', 'web', 'livre') then
    raise exception 'Une source se classe parmi : acte, photo, temoignage, web, livre.';
  end if;
  if v_ref = '' then
    raise exception 'Une source se cite : une cote, un nom d’acte, une adresse, un titre.';
  end if;
  if v_rel not in ('certain', 'probable', 'douteux') then
    raise exception 'La fiabilité se dit certaine, probable ou douteuse.';
  end if;

  -- Deux lignes portant la même référence ne se distingueraient plus à l'écran, et le choix d'un
  -- fait deviendrait indiscernable.
  select kind into v_pris from public.source where lower(reference) = lower(v_ref) limit 1;
  if v_pris is not null then
    raise exception 'Cette référence est déjà celle d’un %.', case v_pris
      when 'acte' then 'acte'
      when 'photo' then 'photo'
      when 'temoignage' then 'témoignage'
      when 'web' then 'site web'
      else v_pris
    end;
  end if;

  insert into public.source (id, kind, reference, reliability)
    values (gen_random_uuid()::text, v_kind, v_ref, v_rel)
    returning * into v_row;

  return public.source_json(v_row);
end;
$$;

/** Corriger une référence suit les faits qui la citent : la source reste la même ligne. */
create or replace function public.update_source(p_id text, p jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_courant public.source;
  v_kind    text;
  v_ref     text;
  v_rel     text;
  v_pris    text;
  v_row     public.source;
begin
  if not public.can_write() then
    raise exception 'Vous consultez cet arbre sans droit de modification.' using errcode = '42501';
  end if;

  select * into v_courant from public.source where id = p_id;
  if v_courant.id is null then
    raise exception 'Cette source n’existe pas dans la base.';
  end if;

  v_kind := case when p ? 'kind' then lower(btrim(coalesce(p->>'kind', ''))) else v_courant.kind end;
  if v_kind not in ('acte', 'photo', 'temoignage', 'web', 'livre') then
    raise exception 'Une source se classe parmi : acte, photo, temoignage, web, livre.';
  end if;

  v_ref := case when p ? 'reference' then btrim(coalesce(p->>'reference', ''))
                else coalesce(v_courant.reference, '') end;
  if v_ref = '' then
    raise exception 'Une source se cite : une cote, un nom d’acte, une adresse, un titre.';
  end if;

  v_rel := case when p ? 'reliability' then lower(btrim(coalesce(p->>'reliability', '')))
                else v_courant.reliability end;
  if v_rel not in ('certain', 'probable', 'douteux') then
    raise exception 'La fiabilité se dit certaine, probable ou douteuse.';
  end if;

  select kind into v_pris from public.source
    where lower(reference) = lower(v_ref) and id <> p_id limit 1;
  if v_pris is not null then
    raise exception 'Cette référence est déjà celle d’un %.', case v_pris
      when 'acte' then 'acte'
      when 'photo' then 'photo'
      when 'temoignage' then 'témoignage'
      when 'web' then 'site web'
      else v_pris
    end;
  end if;

  update public.source set kind = v_kind, reference = v_ref, reliability = v_rel
    where id = p_id returning * into v_row;

  return public.source_json(v_row);
end;
$$;

/**
 * Effacer une source se refuse tant qu'on la cite : `event.source_id` et `media.source_id` n'ont pas
 * de clé étrangère, donc l'effacer quand même laisserait des faits pointant une ligne qui n'existe
 * plus. Le refus compte les citations, parce que c'est le nombre de gestes à faire avant.
 */
create or replace function public.delete_source(p_id text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_events integer;
  v_medias integer;
  v_cite   text;
begin
  if not public.can_write() then
    raise exception 'Vous consultez cet arbre sans droit de modification.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.source where id = p_id) then
    raise exception 'Cette source n’existe pas dans la base.';
  end if;

  select count(*) into v_events from public.event where source_id = p_id;
  select count(*) into v_medias from public.media where source_id = p_id;

  if v_events > 0 or v_medias > 0 then
    -- `concat_ws` passe sur ce qui est absent : une source citée par des seuls faits ne doit pas
    -- s'annoncer avec un « et » qui ne dira rien.
    v_cite := trim(
      concat_ws(' et ',
        case when v_events > 0
             then v_events::text || case when v_events > 1 then ' faits' else ' fait' end end,
        case when v_medias > 0
             then v_medias::text || case when v_medias > 1 then ' fichiers' else ' fichier' end end
      )
    );
    raise exception 'Cette source est encore citée par % : retirez la citation avant de l’effacer.', v_cite;
  end if;

  delete from public.source where id = p_id;
end;
$$;

revoke execute on function
  public.note_json(public.note),
  public.place_json(public.place),
  public.source_json(public.source),
  public.create_note(jsonb),
  public.update_note(text, jsonb),
  public.delete_note(text),
  public.update_place(text, jsonb),
  public.delete_place(text),
  public.create_source(jsonb),
  public.update_source(text, jsonb),
  public.delete_source(text)
from public, anon;

grant execute on function
  public.note_json(public.note),
  public.place_json(public.place),
  public.source_json(public.source),
  public.create_note(jsonb),
  public.update_note(text, jsonb),
  public.delete_note(text),
  public.update_place(text, jsonb),
  public.delete_place(text),
  public.create_source(jsonb),
  public.update_source(text, jsonb),
  public.delete_source(text)
to authenticated;
