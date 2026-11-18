-- L'arbre en ligne : la base partagée par la famille.
--
-- Les douze tables reprennent server/schema.sql table par table : memes noms, memes colonnes,
-- memes cles de texte, memes dates laissees en texte. Ce qui change est dit en face de chaque
-- changement, et rien ici ne depend de l'outil qui ira lire ou ecrire ces lignes.

-- ---------------------------------------------------------------------------
-- Les douze tables de l'arbre
-- ---------------------------------------------------------------------------

-- La branche et la personne se citent l'une l'autre : SQLite s'en contente, Postgres exige que
-- la table reference existe avant la contrainte. La branche se cree donc sans sa cle de racine,
-- qui recoit sa contrainte une fois la personne creee.
create table branch (
  id             text primary key,
  name           text not null,
  color          text not null default '#C9A961',
  -- La personne dont part la branche : elle reste rangee meme quand la personne est effacee.
  root_person_id text,
  created_at     text not null
);

create table person (
  id                text primary key,
  given_names       text not null default '',
  family_name       text not null default '',
  birth_name        text,
  sex               text not null default '?' check (sex in ('M', 'F', 'X', '?')),
  -- Boolean ici, pas 0 et 1 : le front manipule deja un booleen, c'est le serveur SQLite qui
  -- traduisait dans les deux sens. La traduction n'a plus de raison d'etre.
  living            boolean not null default true,
  summary           text,
  portrait_media_id text,
  branch_id         text references branch(id) on delete set null,
  created_at        text not null,
  updated_at        text not null
);

create index idx_person_branch on person(branch_id);

alter table branch
  add constraint branch_root_person foreign key (root_person_id) references person(id) on delete set null;

create table name_variant (
  id        text primary key,
  person_id text not null references person(id) on delete cascade,
  name      text not null,
  type      text not null default 'surnom' check (type in ('alias', 'orthographe', 'surnom'))
);

create index idx_name_variant_person on name_variant(person_id);

create table place (
  id              text primary key,
  name            text not null,
  lat             double precision,
  lon             double precision,
  parent_place_id text references place(id) on delete set null
);

-- Table nommee « couple » et non « union » : UNION est un mot reserve SQL.
-- Les deux partenaires sont laisses en NULL par la suppression d'une personne : le couple
-- continue de dire de quelle union viennent ses enfants.
create table couple (
  id                   text primary key,
  partner_a            text references person(id) on delete set null,
  partner_b            text references person(id) on delete set null,
  type                 text not null default 'inconnu',
  status               text not null default 'en_cours',
  start_date_min       text,
  start_date_max       text,
  start_date_qualifier text,
  start_date_text      text,
  end_date_min         text,
  end_date_max         text,
  end_date_qualifier   text,
  end_date_text        text,
  place_id             text references place(id) on delete set null,
  created_at           text not null
);

create index idx_couple_a on couple(partner_a);
create index idx_couple_b on couple(partner_b);

create table parent_child (
  id        text primary key,
  parent_id text not null references person(id) on delete cascade,
  child_id  text not null references person(id) on delete cascade,
  couple_id text references couple(id) on delete set null,
  nature    text not null default 'biologique',
  certainty text not null default 'probable',
  unique (parent_id, child_id)
);

create index idx_pc_parent on parent_child(parent_id);
create index idx_pc_child on parent_child(child_id);
create index idx_pc_couple on parent_child(couple_id);

create table event (
  id             text primary key,
  person_id      text references person(id) on delete cascade,
  couple_id      text references couple(id) on delete cascade,
  type           text not null,
  date_min       text,
  date_max       text,
  date_qualifier text,
  date_text      text,
  place_id       text references place(id) on delete set null,
  description    text,
  source_id      text,
  confidence     text not null default 'probable',
  created_at     text not null
);

create index idx_event_person on event(person_id);
create index idx_event_couple on event(couple_id);

create table media (
  id             text primary key,
  kind           text not null default 'photo' check (kind in ('photo', 'document')),
  original_path  text not null,
  thumb_path     text,
  sha256         text,
  mime           text,
  width          integer,
  height         integer,
  date_min       text,
  date_max       text,
  date_qualifier text,
  date_text      text,
  caption        text,
  place_id       text references place(id) on delete set null,
  source_id      text,
  document_type  text,
  created_at     text not null
);

create table media_person (
  media_id  text not null references media(id) on delete cascade,
  person_id text not null references person(id) on delete cascade,
  role      text not null default 'sujet',
  crop_x    double precision,
  crop_y    double precision,
  crop_size double precision,
  primary key (media_id, person_id)
);

create table media_event (
  media_id text not null references media(id) on delete cascade,
  event_id text not null references event(id) on delete cascade,
  primary key (media_id, event_id)
);

create table note (
  id          text primary key,
  body        text not null,
  target_type text not null,
  target_id   text not null,
  created_at  text not null
);

create index idx_note_target on note(target_type, target_id);

create table source (
  id          text primary key,
  kind        text not null,
  reference   text,
  reliability text not null default 'probable'
);

-- ---------------------------------------------------------------------------
-- Qui entre, et ce que la personne est dans l'arbre
-- ---------------------------------------------------------------------------

-- La liste d'autorisation est une table et non un reglage du tableau de bord : elle suit la
-- base, elle se relit, et « qui peut ecrire » se decide a la ligne pres.
-- person_id dit qui l'on est : c'est le « moi » de chacun, qui ne peut plus etre global des
-- que deux personnes regardent le meme arbre.
create table family_member (
  auth_uid   uuid primary key,
  email      text not null unique,
  person_id  text references person(id) on delete set null,
  can_write  boolean not null default false,
  created_at text not null
);

-- Une seule souche pour toute la famille : c'est un fait de l'arbre, pas un point de vue.
create table tree_setting (
  id             integer primary key default 1 check (id = 1),
  root_person_id text references person(id) on delete set null,
  updated_at     text not null
);

-- ---------------------------------------------------------------------------
-- Les droits
-- ---------------------------------------------------------------------------

-- Security invoker, pas definer : cette fonction lit family_member, dont la regle propre ne
-- laisse voir que la ligne de celui qui demande. Elle ne peut donc pas servir de porte de
-- sortie. Un definer ici ferait de can_write() un endpoint public contournant les droits.
create function is_member() returns boolean
language sql stable security invoker set search_path = ''
as $$
  select exists (
    select 1 from public.family_member m where m.auth_uid = (select auth.uid())
  );
$$;

create function can_write() returns boolean
language sql stable security invoker set search_path = ''
as $$
  select exists (
    select 1 from public.family_member m
    where m.auth_uid = (select auth.uid()) and m.can_write
  );
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'person', 'branch', 'name_variant', 'place', 'couple', 'parent_child',
    'event', 'media', 'media_person', 'media_event', 'note', 'source', 'tree_setting'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    -- La famille complete est le sujet de l'application : tout membre lit tout. Le filtre n'est
    -- pas la ligne mais le compte, et il vient de family_member -- retirer un membre coupe la
    -- lecture a la requete suivante, sans attendre que son jeton expire.
    -- Chaque test est ecrit en sous-requete non correlee pour que Postgres l'evalue une fois
    -- par instruction au lieu d'une fois par ligne.
    execute format($f$ create policy "lecture" on public.%I for select to authenticated using ((select public.is_member())) $f$, t);
    execute format($f$ create policy "ajout" on public.%I for insert to authenticated with check ((select public.can_write())) $f$, t);
    execute format($f$ create policy "modification" on public.%I for update to authenticated using ((select public.can_write())) with check ((select public.can_write())) $f$, t);
    execute format($f$ create policy "effacement" on public.%I for delete to authenticated using ((select public.can_write())) $f$, t);
  end loop;
end $$;

-- La liste des membres ne se lit pas en passant : chacun voit sa propre ligne, et l'ajout,
-- l'ecriture et le retrait de membres ne se font que par les scripts de migration ou le
-- tableau de bord, jamais depuis le navigateur.
alter table public.family_member enable row level security;
create policy "chacun se voit" on public.family_member
  for select to authenticated using (auth_uid = (select auth.uid()));

-- Les fichiers de la famille : bucket prive, donc passe par une URL signee delivree a un
-- compte invite. Sans regle ici, le bucket serait illisible meme pour son proprietaire.
-- Le role `authenticated` recoit les quatre verbes : un depot qui remplace un fichier
-- existant (upsert) a besoin de lire et de modifier, pas seulement d'inserer.
insert into storage.buckets (id, name, public)
values ('medias', 'medias', false)
on conflict (id) do nothing;

create policy "medias lecture" on storage.objects
  for select to authenticated using (bucket_id = 'medias' and (select public.is_member()));
create policy "medias depot" on storage.objects
  for insert to authenticated with check (bucket_id = 'medias' and (select public.can_write()));
create policy "medias remplacement" on storage.objects
  for update to authenticated using (bucket_id = 'medias' and (select public.can_write()));
create policy "medias effacement" on storage.objects
  for delete to authenticated using (bucket_id = 'medias' and (select public.can_write()));

-- Dernier etage, distinct des droits de lignes : les privileges de role. Une table creee par
-- un script SQL peut rester fermee au role du front selon le reglage de l'API de donnees.
-- `anon` ne recoit rien : sans compte, il n'y a pas d'arbre a lire.
grant select, insert, update, delete on all tables in schema public to authenticated;

-- Supabase accorde par defaut plus que ce qu'on demande : la lecture au role `anon` et tous les
-- verbes au role `authenticated`, y compris sur la liste des membres. Les regles de lignes
-- filtraient deja ces acces a zero ligne, mais un privilege de trop dort : une vue, une politique
-- ajoutee plus tard, et il se reveille. On le ferme a la source.
revoke all on public.person, public.branch, public.name_variant, public.place, public.couple,
  public.parent_child, public.event, public.media, public.media_person, public.media_event,
  public.note, public.source, public.family_member, public.tree_setting from anon;
revoke insert, update, delete on public.family_member from authenticated;
revoke all on all tables in schema storage from anon;
