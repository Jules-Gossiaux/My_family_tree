-- L'ecran en ligne : chaque vue de l'application se lit en une seule reponse.
--
-- Le serveur Express assemblait ces objets ligne par ligne en TypeScript. Le meme assemblage
-- vit desormais en Postgres, pour une raison de transport : un cousin en ligne ne peut pas
-- joindre l'ordinateur de Jules, et dix requetes successives depuis le navigateur coutent dix
-- allers-retours la ou une fonction en cout un.
--
-- Toutes ces fonctions sont `security invoker`, jamais `definer` : elles lisent a travers les
-- regles de lignes deja posees, donc un compte non invite recoit des tableaux vides au lieu de
-- tableaux complets. Une fonction definer ici ouvrirait une porte de sortie pour chaque table.
--
-- Les formes produites sont celles de shared/types.ts, camelCase compris : le front se change
-- lui-meme, pas les ecrans.

-- ---------------------------------------------------------------------------
-- Les briques
-- ---------------------------------------------------------------------------

-- Les quatre colonnes d'une date floue deviennent un seul objet. Une ligne sans aucune des
-- quatre ne vaut pas une date inconnue mais l'absence de date — la fiche n'affiche alors rien.
create or replace function public.gdate(
  p_min text,
  p_max text,
  p_qualifier text,
  p_text text
) returns jsonb
language sql immutable security invoker set search_path = ''
as $$
  select case
    when p_min is null and p_max is null and p_text is null then null
    else jsonb_build_object(
      'min', p_min,
      'max', p_max,
      'qualifier', coalesce(p_qualifier, 'unknown'),
      'text', p_text
    )
  end;
$$;

-- Une personne, telle que la carte de l'arbre et la fiche la veulent. `living` est deja un
-- booleen dans cette base : la traduction 0/1 du serveur SQLite n'a plus de raison d'etre.
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

-- Un fait de la vie, avec le nom du lieu et la reference de la source deja sous la main : la
-- chronologie d'une vie les affiche sans les re-demander.
create or replace function public.event_json(e public.event) returns jsonb
language sql stable security invoker set search_path = ''
as $$
  select jsonb_build_object(
    'id', e.id,
    'personId', e.person_id,
    'coupleId', e.couple_id,
    'type', e.type,
    'label', case e.type
      when 'naissance' then 'Naissance'
      when 'bapteme' then 'Baptême'
      when 'deces' then 'Décès'
      when 'inhumation' then 'Inhumation'
      when 'profession' then 'Profession'
      when 'residence' then 'Résidence'
      else 'Autre'
    end,
    'date', public.gdate(e.date_min, e.date_max, e.date_qualifier, e.date_text),
    'place', (select pl.name from public.place pl where pl.id = e.place_id),
    'placeId', e.place_id,
    'description', e.description,
    'confidence', e.confidence,
    'sourceId', e.source_id,
    'source', (select s.reference from public.source s where s.id = e.source_id),
    'sourceKind', (select s.kind from public.source s where s.id = e.source_id),
    'mediaCount', (select count(*) from public.media_event me where me.event_id = e.id)
  );
$$;

-- Un fichier, tel que la galerie le dessine. Les chemins ne sortent jamais de la base : le
-- navigateur ne recoit qu'un identifiant, et l'URL signee s'en suit cote front.
-- `key` et `thumbKey` sont les cles dans le seau prive, le prefixe `medias/` retire parce que le
-- seau s'appelle deja `medias`. Une cle sans URL signee ne donne acces a rien : le seau est prive
-- et la regle de ligne ne laisse lire qu'un compte invite.
create or replace function public.media_json(m public.media) returns jsonb
language sql stable security invoker set search_path = ''
as $$
  select jsonb_build_object(
    'id', m.id,
    'kind', m.kind,
    'mime', m.mime,
    'width', m.width,
    'height', m.height,
    'caption', m.caption,
    'documentType', m.document_type,
    'date', public.gdate(m.date_min, m.date_max, m.date_qualifier, m.date_text),
    'hasThumb', m.thumb_path is not null,
    'key', regexp_replace(m.original_path, '^medias/', ''),
    'thumbKey', case when m.thumb_path is null then null
                     else regexp_replace(m.thumb_path, '^medias/', '') end,
    'persons', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', p.id,
            'name', trim(concat_ws(' ', p.given_names, p.family_name)),
            'role', mp.role
          ) order by lower(p.family_name), lower(p.given_names)
        ),
        '[]'::jsonb
      )
        from public.media_person mp
        join public.person p on p.id = mp.person_id
       where mp.media_id = m.id
    ),
    'createdAt', m.created_at
  );
$$;

-- ---------------------------------------------------------------------------
-- Les vues
-- ---------------------------------------------------------------------------

-- Tout l'arbre d'un coup : c'est la premiere chose que le site en ligne doit savoir montrer.
create or replace function public.graph_json() returns jsonb
language sql stable security invoker set search_path = ''
as $$
  select jsonb_build_object(
    'persons', (
      select coalesce(
        jsonb_agg(public.person_json(p) order by lower(p.family_name), lower(p.given_names)),
        '[]'::jsonb
      ) from public.person p
    ),
    'couples', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', c.id,
            'partnerA', c.partner_a,
            'partnerB', c.partner_b,
            'type', c.type,
            'status', c.status,
            'start', public.gdate(c.start_date_min, c.start_date_max, c.start_date_qualifier, c.start_date_text)
          ) order by c.created_at
        ),
        '[]'::jsonb
      ) from public.couple c
    ),
    'parentChild', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', pc.id,
            'parentId', pc.parent_id,
            'childId', pc.child_id,
            'coupleId', pc.couple_id,
            'nature', pc.nature
          )
        ),
        '[]'::jsonb
      ) from public.parent_child pc
    ),
    'branches', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', b.id,
            'name', b.name,
            'color', b.color,
            'rootPersonId', b.root_person_id,
            'personCount', (select count(*) from public.person p where p.branch_id = b.id)
          ) order by lower(b.name)
        ),
        '[]'::jsonb
      ) from public.branch b
    ),
    'rootId', (select t.root_person_id from public.tree_setting t where t.id = 1),
    'dataDir', 'En ligne'
  );
$$;

-- Le dossier de vie complet d'une personne. Une id qui n'existe plus rend null : le front le
-- dit a l'ecran au lieu de dessiner une fiche vide.
create or replace function public.person_detail_json(p_id text) returns jsonb
language sql stable security invoker set search_path = ''
as $$
  select public.person_json(p) || jsonb_build_object(
    'nicknames', (
      select coalesce(jsonb_agg(v.name order by v.name), '[]'::jsonb)
        from public.name_variant v
       where v.person_id = p.id
    ),
    'events', (
      select coalesce(
        jsonb_agg(public.event_json(e) order by coalesce(e.date_min, e.date_max, '9999'), e.created_at),
        '[]'::jsonb
      ) from public.event e where e.person_id = p.id
    ),
    'parents', (
      select coalesce(
        jsonb_agg(public.person_json(pa) order by lower(pa.family_name), lower(pa.given_names)),
        '[]'::jsonb
      )
        from public.parent_child pc
        join public.person pa on pa.id = pc.parent_id
       where pc.child_id = p.id
    ),
    'siblings', (
      select coalesce(
        jsonb_agg(public.person_json(s) order by lower(s.family_name), lower(s.given_names)),
        '[]'::jsonb
      )
        from public.person s
       where s.id <> p.id
         and exists (
           select 1
             from public.parent_child a
             join public.parent_child b on b.parent_id = a.parent_id
            where a.child_id = s.id and b.child_id = p.id
         )
    ),
    'partners', (
      select coalesce(
        jsonb_agg(public.person_json(pt) order by lower(pt.family_name), lower(pt.given_names)),
        '[]'::jsonb
      )
        from public.couple c
        join public.person pt
          on pt.id = case when c.partner_a = p.id then c.partner_b else c.partner_a end
       where c.partner_a = p.id or c.partner_b = p.id
    ),
    'children', (
      select coalesce(
        jsonb_agg(public.person_json(ch) order by lower(ch.family_name), lower(ch.given_names)),
        '[]'::jsonb
      )
        from public.parent_child pc
        join public.person ch on ch.id = pc.child_id
       where pc.parent_id = p.id
    ),
    'media', (
      select coalesce(
        jsonb_agg(public.media_json(m) order by coalesce(m.date_min, m.created_at), m.created_at),
        '[]'::jsonb
      )
        from public.media m
        join public.media_person mp on mp.media_id = m.id
       where mp.person_id = p.id
    ),
    'notes', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', n.id,
            'body', n.body,
            'targetType', n.target_type,
            'targetId', n.target_id,
            'createdAt', n.created_at
          ) order by n.created_at, n.id
        ),
        '[]'::jsonb
      )
        from public.note n
       where n.target_type = 'person' and n.target_id = p.id
    )
  )
    from public.person p
   where p.id = p_id;
$$;

-- La barre du haut : combien de cases, quelle souche, qui je suis. Le « moi » ne peut plus
-- etre global des que deux personnes regardent le meme arbre — il se lit sur la ligne du
-- compte qui demande, pas dans un reglage partage.
create or replace function public.state_json() returns jsonb
language sql stable security invoker set search_path = ''
as $$
  select jsonb_build_object(
    'dataDir', 'En ligne',
    'dataDirFromEnv', false,
    'rootPersonId', (select t.root_person_id from public.tree_setting t where t.id = 1),
    'mePersonId', (select m.person_id from public.family_member m where m.auth_uid = (select auth.uid())),
    'counts', jsonb_build_object(
      'persons', (select count(*) from public.person),
      'couples', (select count(*) from public.couple),
      'media', (select count(*) from public.media),
      'mediaUnattached', (
        select count(*) from public.media m
         where not exists (select 1 from public.media_person mp where mp.media_id = m.id)
      )
    ),
    'backup', null,
    'warnings', '[]'::jsonb
  );
$$;

-- Les deux listes que les formulaires proposent avant de laisser taper.
create or replace function public.places_json() returns jsonb
language sql stable security invoker set search_path = ''
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', p.id,
        'name', p.name,
        'eventCount', (select count(*) from public.event e where e.place_id = p.id),
        'mediaCount', (select count(*) from public.media m where m.place_id = p.id)
      ) order by lower(p.name)
    ),
    '[]'::jsonb
  ) from public.place p;
$$;

create or replace function public.sources_json() returns jsonb
language sql stable security invoker set search_path = ''
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
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
      ) order by lower(s.kind), lower(coalesce(s.reference, ''))
    ),
    '[]'::jsonb
  ) from public.source s;
$$;

-- Le bac d'attente des photos : ce qui est dans le dossier sans savoir a qui parler.
create or replace function public.unattached_media_json() returns jsonb
language sql stable security invoker set search_path = ''
as $$
  select coalesce(
    jsonb_agg(public.media_json(m) order by m.created_at desc),
    '[]'::jsonb
  )
    from public.media m
   where not exists (select 1 from public.media_person mp where mp.media_id = m.id);
$$;

-- ---------------------------------------------------------------------------
-- Les privileges
-- ---------------------------------------------------------------------------

grant execute on function public.gdate(text, text, text, text) to authenticated;
grant execute on function public.person_json(public.person) to authenticated;
grant execute on function public.event_json(public.event) to authenticated;
grant execute on function public.media_json(public.media) to authenticated;
grant execute on function public.graph_json() to authenticated;
grant execute on function public.person_detail_json(text) to authenticated;
grant execute on function public.state_json() to authenticated;
grant execute on function public.places_json() to authenticated;
grant execute on function public.sources_json() to authenticated;
grant execute on function public.unattached_media_json() to authenticated;

-- `public` tient la fonction de test `net.set_last_test_log()` : sans ce retrait, n'importe
-- quel role pourrait appeler nos fonctions de lecture et lire l'arbre sans compte.
revoke execute on function public.gdate(text, text, text, text) from public, anon;
revoke execute on function public.person_json(public.person) from public, anon;
revoke execute on function public.event_json(public.event) from public, anon;
revoke execute on function public.media_json(public.media) from public, anon;
revoke execute on function public.graph_json() from public, anon;
revoke execute on function public.person_detail_json(text) from public, anon;
revoke execute on function public.state_json() from public, anon;
revoke execute on function public.places_json() from public, anon;
revoke execute on function public.sources_json() from public, anon;
revoke execute on function public.unattached_media_json() from public, anon;

-- La souche de l'arbre est un fait de la famille, pas un reglage d'ordinateur : elle quitte
-- config.json pour cette table, et le premier lecteur la trouve deja posee.
insert into public.tree_setting (id, root_person_id, updated_at)
values (1, '965dd415-3fe5-4739-93c7-ba76376ee465', now()::text)
on conflict (id) do nothing;
