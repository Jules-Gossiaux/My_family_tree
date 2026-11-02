-- Écrire les fichiers : les octets entrent par le coffre, la base n'en garde que l'adresse.
--
-- Le serveur du disque recevait les octets, les posait dans le dossier `medias` et en tirait
-- l'empreinte. Ici, le navigateur dépose lui-même le fichier dans le seau `medias` — privé, avec des
-- liens signés d'une heure — et la base n'enregistre que ce qui a été réellement reçu. D'où deux
-- temps : on demande d'abord où écrire (`plan_media_upload`, `media_thumb_key`), on déclare ensuite
-- ce qui y est (`create_media`, `set_media_thumbnail`), et la déclaration se contrôle contre la ligne
-- du coffre : un fichier qui n'est pas là, posé par un autre, ou sous une adresse inventée refuse.
--
-- Les règles de venue viennent de server/media.ts : deux genres, cinq formats reconnus, une empreinte
-- qui ne se range jamais deux fois. Le plafond en ligne est plus bas que sur le disque — 50 Mo au
-- lieu de 60, parce que c'est ce que le coffre accepte — et un refus français avant l'envoi vaut
-- mieux qu'une panne technique après trois minutes de montante.

/** L'extension que la base connaît pour un type de fichier ; rien d'autre n'entre. */
create or replace function public.media_extension(p_mime text)
returns text
language sql immutable security invoker set search_path = ''
as $$
  select case lower(btrim(coalesce(p_mime, '')))
    when 'image/jpeg'      then 'jpg'
    when 'image/png'       then 'png'
    when 'image/webp'      then 'webp'
    when 'image/gif'       then 'gif'
    when 'application/pdf' then 'pdf'
    else null
  end;
$$;

/** Le genre d'un média : deux seulement, parce que la galerie ne sait nommer que ceux-là. */
create or replace function public.checked_media_kind(p_kind text)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_kind text := lower(btrim(coalesce(p_kind, '')));
begin
  if v_kind not in ('photo', 'document') then
    raise exception 'Un média est une photo ou un document.';
  end if;
  return v_kind;
end;
$$;

/** Le dossier de l'année, jamais une année inventée : une date illisible rangée à part reste relisible. */
create or replace function public.media_year(p_taken text)
returns text
language sql stable security invoker set search_path = ''
as $$
  select coalesce(
    substring(btrim(coalesce(p_taken, '')) from '^[0-9]{4}'),
    to_char(now(), 'YYYY')
  );
$$;

/**
 * L'adresse du coffre où poser un fichier, telle que le serveur local l'écrivait :
 * `<genre>/<année>/<repère>.<extension>`, et sa vignette en face sous `vignettes/`. C'est la base qui
 * la décide, jamais celui qui envoie : sinon une ligne pourrait pointer n'importe où dans le seau.
 */
create or replace function public.media_paths(p_id text, p_kind text, p_taken text, p_mime text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_kind text;
  v_ext  text;
begin
  v_kind := public.checked_media_kind(p_kind);
  v_ext := public.media_extension(p_mime);
  if v_ext is null then
    raise exception 'Ce format n’est pas accepté pour l’instant : %. Les formats reconnus sont JPEG, PNG, WebP, GIF et PDF.',
      coalesce(nullif(btrim(coalesce(p_mime, '')), ''), 'type inconnu');
  end if;

  return jsonb_build_object(
    'kind', v_kind,
    'mime', lower(btrim(coalesce(p_mime, ''))),
    'key', (case v_kind when 'photo' then 'photos' else 'documents' end)
           || '/' || public.media_year(p_taken) || '/' || p_id || '.' || v_ext,
    'thumbKey', 'vignettes/' || public.media_year(p_taken) || '/' || p_id || '.jpg'
  );
end;
$$;

/**
 * Les quatre colonnes d'une date floue, contrôlées comme celles des faits de la vie. Ce que
 * l'analyseur du navigateur n'a pas compris arrive en « unknown » avec son texte intact.
 */
create or replace function public.checked_gdate(p jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_date jsonb := coalesce(p, '{}'::jsonb);
  v_min  text := nullif(v_date->>'min', '');
  v_max  text := nullif(v_date->>'max', '');
  v_qual text := nullif(v_date->>'qualifier', '');
  v_text text := nullif(v_date->>'text', '');
begin
  if v_qual is not null
     and v_qual not in ('exact', 'about', 'before', 'after', 'between', 'unknown') then
    raise exception 'Ce qualificatif de date n’est pas un de ceux que l’arbre comprend.';
  end if;
  if (v_min is not null and v_min !~ '^[0-9]{1,9}(-[0-9]{1,2}){0,2}$')
     or (v_max is not null and v_max !~ '^[0-9]{1,9}(-[0-9]{1,2}){0,2}$') then
    raise exception 'Une date range ne se dit qu’en années, mois ou jours chiffrés.';
  end if;

  return jsonb_build_object(
    'min', v_min, 'max', v_max, 'qualifier', coalesce(v_qual, 'unknown'), 'text', v_text
  );
end;
$$;

/** Le fichier déjà reçu une fois : la même empreinte ne peuple jamais la boîte de deux cases identiques. */
create or replace function public.media_by_fingerprint(p_sha256 text)
returns jsonb
language sql stable security invoker set search_path = ''
as $$
  select public.media_json(m)
    from public.media m
   where m.sha256 = nullif(lower(btrim(coalesce(p_sha256, ''))), '')
   limit 1;
$$;

/**
 * Où poser le fichier, et est-ce que cela sert à quelque chose. Le format et la taille se contrôlent
 * d'abord, le doublon ensuite : un fichier déjà connu envoyé sous un genre inventé reste une demande
 * illisible, et 55 Mo refusés ici valent mieux que trois minutes de montante pour rien.
 */
create or replace function public.plan_media_upload(p jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_vu      jsonb;
  v_chemins jsonb;
  v_taille  bigint := coalesce(nullif(p->>'size', '')::bigint, 0);
  v_id      text := gen_random_uuid()::text;
begin
  if not public.can_write() then
    raise exception 'Vous consultez cet arbre sans droit de modification.' using errcode = '42501';
  end if;

  v_chemins := public.media_paths(v_id, p->>'kind', p->>'taken', p->>'mime');
  if v_taille = 0 then
    raise exception 'Le fichier est vide.';
  end if;
  if v_taille > 50 * 1024 * 1024 then
    raise exception 'Ce fichier dépasse 50 Mo. Découpez le scan avant de l’importer.';
  end if;

  v_vu := public.media_by_fingerprint(p->>'sha256');
  if v_vu is not null then
    return jsonb_build_object('deduped', true, 'media', v_vu);
  end if;

  return jsonb_build_object(
    'deduped', false,
    'id', v_id,
    'key', v_chemins->>'key',
    'thumbKey', v_chemins->>'thumbKey'
  );
end;
$$;

/**
 * La ligne du fichier, autour des octets réellement reçus. Le coffre dit la taille, l'adresse est
 * recalculée ici : ce que le navigateur déclare ne suffit pas à faire exister une photo.
 */
create or replace function public.create_media(p jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id      text := lower(btrim(coalesce(p->>'id', '')));
  v_chemins jsonb;
  v_key     text;
  v_objet   jsonb;
  v_taille  bigint;
  v_sha     text := lower(btrim(coalesce(p->>'sha256', '')));
  v_pris    public.media;
  v_row     public.media;
  v_date    jsonb;
begin
  if not public.can_write() then
    raise exception 'Vous consultez cet arbre sans droit de modification.' using errcode = '42501';
  end if;

  if v_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'Ce fichier n’a pas de repère valide : rechargez la page et recommencez l’envoi.';
  end if;

  v_chemins := public.media_paths(v_id, p->>'kind', p->>'taken', p->>'mime');
  v_key := v_chemins->>'key';

  select jsonb_build_object('taille', coalesce(o.metadata->>'size', '0')::bigint)
    into v_objet
    from storage.objects o
   where o.bucket_id = 'medias'
     and o.name = v_key
     and o.owner = (select auth.uid());
  if v_objet is null then
    raise exception 'Le fichier n’a pas été reçu dans le coffre : recommencez l’envoi.';
  end if;

  v_taille := (v_objet->>'taille')::bigint;
  if v_taille = 0 then
    raise exception 'Le fichier est vide.';
  end if;
  if v_taille > 50 * 1024 * 1024 then
    raise exception 'Ce fichier dépasse 50 Mo. Découpez le scan avant de l’importer.';
  end if;

  -- La même image scannée deux fois ne doit pas remplir la boîte : l'empreinte a déjà une ligne.
  if v_sha <> '' then
    select * into v_pris from public.media where sha256 = v_sha limit 1;
    if v_pris.id is not null then
      return jsonb_build_object('deduped', true, 'media', public.media_json(v_pris));
    end if;
  end if;

  if exists (select 1 from public.media where id = v_id) then
    raise exception 'Ce fichier est déjà enregistré dans la base.';
  end if;

  v_date := public.checked_gdate(p->'date');

  insert into public.media (
    id, kind, original_path, sha256, mime, width, height,
    date_min, date_max, date_qualifier, date_text, caption, document_type, created_at
  ) values (
    v_id, v_chemins->>'kind', v_key, nullif(v_sha, ''), v_chemins->>'mime',
    nullif(p->>'width', '')::integer, nullif(p->>'height', '')::integer,
    v_date->>'min', v_date->>'max', v_date->>'qualifier', v_date->>'text',
    nullif(btrim(coalesce(p->>'caption', '')), ''),
    nullif(btrim(coalesce(p->>'documentType', '')), ''),
    now()::text
  ) returning * into v_row;

  return jsonb_build_object('deduped', false, 'media', public.media_json(v_row));
end;
$$;

/** L'adresse de la vignette d'un fichier déjà enregistré : la base la connaît mieux que l'envoi. */
create or replace function public.media_thumb_key(p_id text)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_courant public.media;
begin
  select * into v_courant from public.media where id = p_id;
  if v_courant.id is null then
    raise exception 'Média introuvable.';
  end if;

  return 'vignettes/' || public.media_year(coalesce(v_courant.date_min, v_courant.created_at))
         || '/' || v_courant.id || '.jpg';
end;
$$;

/** La vignette vient du navigateur : la base ne décode aucune image, donc n'en casse aucune. */
create or replace function public.set_media_thumbnail(p_id text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_cle   text;
  v_objet jsonb;
  v_row   public.media;
begin
  if not public.can_write() then
    raise exception 'Vous consultez cet arbre sans droit de modification.' using errcode = '42501';
  end if;

  v_cle := public.media_thumb_key(p_id);

  select jsonb_build_object('taille', coalesce(o.metadata->>'size', '0')::bigint)
    into v_objet
    from storage.objects o
   where o.bucket_id = 'medias'
     and o.name = v_cle
     and o.owner = (select auth.uid());
  if v_objet is null then
    raise exception 'La vignette n’a pas été reçue dans le coffre : recommencez l’envoi.';
  end if;
  if (v_objet->>'taille')::bigint = 0 then
    raise exception 'La vignette est vide.';
  end if;
  if (v_objet->>'taille')::bigint > 2 * 1024 * 1024 then
    raise exception 'Cette vignette est trop grosse : elle devrait tenir sous 2 Mo.';
  end if;

  update public.media set thumb_path = v_cle where id = p_id returning * into v_row;
  return public.media_json(v_row);
end;
$$;

/** Corriger la légende, le genre, le type d'acte ou la date d'un fichier : ses octets ne bougent pas. */
create or replace function public.patch_media(p_id text, p jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_date jsonb;
begin
  if not public.can_write() then
    raise exception 'Vous consultez cet arbre sans droit de modification.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.media where id = p_id) then
    raise exception 'Média introuvable.';
  end if;

  if p ? 'caption' then
    update public.media set caption = nullif(btrim(coalesce(p->>'caption', '')), '') where id = p_id;
  end if;

  if p ? 'documentType' then
    update public.media set document_type = nullif(btrim(coalesce(p->>'documentType', '')), '')
      where id = p_id;
  end if;

  if p ? 'kind' then
    update public.media set kind = public.checked_media_kind(p->>'kind') where id = p_id;
  end if;

  if p ? 'dateText' then
    v_date := public.checked_gdate(p->'date');
    update public.media
       set date_min = v_date->>'min', date_max = v_date->>'max',
           date_qualifier = v_date->>'qualifier', date_text = v_date->>'text'
      where id = p_id;
  end if;

  return (select public.media_json(m) from public.media m where m.id = p_id);
end;
$$;

/** Rattacher, c'est dire « cette personne est sur cette photo ». Rien d'autre n'est deviné. */
create or replace function public.attach_media(p_id text, p jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_ids  text[];
  v_role text := coalesce(nullif(btrim(coalesce(p->>'role', '')), ''), 'sujet');
begin
  if not public.can_write() then
    raise exception 'Vous consultez cet arbre sans droit de modification.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.media where id = p_id) then
    raise exception 'Média introuvable.';
  end if;

  select array_agg(distinct t.v) into v_ids
    from jsonb_array_elements_text(coalesce(p->'personIds', '[]'::jsonb)) as t(v);

  if exists (
    select 1 from unnest(coalesce(v_ids, array[]::text[])) as u(v)
     where not exists (select 1 from public.person p2 where p2.id = u.v)
  ) then
    raise exception 'L’une des personnes à rattacher n’est plus dans l’arbre. Rechargez la page et recommencez.';
  end if;

  insert into public.media_person (media_id, person_id, role)
    select p_id, u.v, v_role from unnest(coalesce(v_ids, array[]::text[])) as u(v)
      on conflict (media_id, person_id) do nothing;

  return (select public.media_json(m) from public.media m where m.id = p_id);
end;
$$;

/** Ne plus montrer une personne sur un fichier lui rend son portrait : un cadre vide n'est pas un portrait. */
create or replace function public.detach_media(p_media_id text, p_person_id text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not public.can_write() then
    raise exception 'Vous consultez cet arbre sans droit de modification.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.media where id = p_media_id) then
    raise exception 'Média introuvable.';
  end if;

  delete from public.media_person where media_id = p_media_id and person_id = p_person_id;
  update public.person
     set portrait_media_id = null, updated_at = now()::text
   where id = p_person_id and portrait_media_id = p_media_id;

  return (select public.media_json(m) from public.media m where m.id = p_media_id);
end;
$$;

/** Le portrait d'une personne : un fichier où elle se trouve réellement, ou rien. */
create or replace function public.set_portrait(p_person_id text, p_media_id text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_media text := nullif(btrim(coalesce(p_media_id, '')), '');
begin
  if not public.can_write() then
    raise exception 'Vous consultez cet arbre sans droit de modification.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.person where id = p_person_id) then
    raise exception 'Personne introuvable';
  end if;

  if v_media is not null
     and not exists (
       select 1 from public.media_person
        where media_id = v_media and person_id = p_person_id
     ) then
    raise exception 'Choisissez d’abord la personne sur cette photo.';
  end if;

  update public.person
     set portrait_media_id = v_media, updated_at = now()::text
   where id = p_person_id;
end;
$$;

/**
 * Effacer un fichier efface ses octets — le seul endroit de l'application où la demande détruit autre
 * chose qu'une ligne. La base rend d'abord les clés au navigateur, qui les retire du seau : effacer
 * la ligne du coffre en base laisserait les octets dessous sans plus personne pour les nommer.
 */
create or replace function public.delete_media(p_id text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_courant public.media;
  v_cles    jsonb;
begin
  if not public.can_write() then
    raise exception 'Vous consultez cet arbre sans droit de modification.' using errcode = '42501';
  end if;

  select * into v_courant from public.media where id = p_id;
  if v_courant.id is null then
    return jsonb_build_object('ok', true, 'keys', '[]'::jsonb);
  end if;

  v_cles := jsonb_build_array(v_courant.original_path)
            || case when v_courant.thumb_path is null then '[]'::jsonb
                    else jsonb_build_array(v_courant.thumb_path) end;

  delete from public.note where target_type = 'media' and target_id = p_id;
  update public.person set portrait_media_id = null, updated_at = now()::text
    where portrait_media_id = p_id;
  delete from public.media where id = p_id;

  return jsonb_build_object('ok', true, 'keys', v_cles);
end;
$$;

revoke execute on function
  public.media_extension(text),
  public.checked_media_kind(text),
  public.media_year(text),
  public.media_paths(text, text, text, text),
  public.checked_gdate(jsonb),
  public.media_by_fingerprint(text),
  public.plan_media_upload(jsonb),
  public.create_media(jsonb),
  public.media_thumb_key(text),
  public.set_media_thumbnail(text),
  public.patch_media(text, jsonb),
  public.attach_media(text, jsonb),
  public.detach_media(text, text),
  public.set_portrait(text, text),
  public.delete_media(text)
from public, anon;

grant execute on function
  public.media_extension(text),
  public.checked_media_kind(text),
  public.media_year(text),
  public.media_paths(text, text, text, text),
  public.checked_gdate(jsonb),
  public.media_by_fingerprint(text),
  public.plan_media_upload(jsonb),
  public.create_media(jsonb),
  public.media_thumb_key(text),
  public.set_media_thumbnail(text),
  public.patch_media(text, jsonb),
  public.attach_media(text, jsonb),
  public.detach_media(text, text),
  public.set_portrait(text, text),
  public.delete_media(text)
to authenticated;
