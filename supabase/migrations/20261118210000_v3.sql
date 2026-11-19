-- Arbre généalogique v3 — socle Supabase.
--
-- Le document familial (v3 : persons, unions, places, sources, events, media)
-- est stocké comme un seul jsonb par famille. Ce choix est délibéré : le
-- modèle local est déjà validé, versionné et testé ; une table par entité
-- imposerait un moteur de synchronisation complexe et fragile. Les octets des
-- médias vont dans Storage sous la clé `${familyId}/${mediaId}`, exactement
-- comme dans IndexedDB aujourd'hui. Aucun changement de modèle côté client.
--
-- L'accès est isolé par famille : famille_members porte le rôle de chaque
-- utilisateur, et can_write() est la seule porte d'écriture.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Familles et membership
-- ---------------------------------------------------------------------------

create table if not exists public.families (
  id         uuid primary key default gen_random_uuid(),
  name       text not null default 'Ma famille',
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id) on delete cascade
);

create table if not exists public.family_members (
  family_id  uuid not null references public.families(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null check (role in ('admin', 'editor', 'viewer')),
  joined_at  timestamptz not null default now(),
  primary key (family_id, user_id)
);

create table if not exists public.family_documents (
  family_id  uuid primary key references public.families(id) on delete cascade,
  document   jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

create table if not exists public.invitations (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null references public.families(id) on delete cascade,
  email       text,
  role        text not null check (role in ('admin', 'editor', 'viewer')),
  token       text not null unique default encode(gen_random_bytes(24), 'hex'),
  invited_by  uuid not null references auth.users(id) on delete cascade,
  expires_at  timestamptz not null default (now() + interval '14 days'),
  accepted_at timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists idx_members_user on public.family_members(user_id);
create index if not exists idx_invitations_email on public.invitations(lower(email));

-- ---------------------------------------------------------------------------
-- Rôles : une seule fonction décide qui peut écrire.
-- ---------------------------------------------------------------------------

create or replace function public.family_role(family uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.family_members
  where family_id = family and user_id = auth.uid()
  limit 1;
$$;

create or replace function public.can_write(family uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.family_role(family) in ('admin', 'editor');
$$;

create or replace function public.can_admin(family uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.family_role(family) = 'admin';
$$;

-- Créer une famille : l'utilisateur en devient admin automatiquement.
create or replace function public.create_family(family_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_family uuid;
begin
  insert into public.families(name, created_by) values (family_name, auth.uid())
  returning id into new_family;
  insert into public.family_members(family_id, user_id, role)
  values (new_family, auth.uid(), 'admin');
  return new_family;
end;
$$;

-- Accepter un jeton : le jeton est la seule porte. N'importe quel compte connecté
-- peut l'utiliser, mais seul un admin peut en créer un (voir create_invitation).
create or replace function public.accept_invitation(invite_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  invitation public.invitations;
begin
  select * into invitation from public.invitations where token = invite_token;
  if not found then raise exception 'Jeton introuvable.'; end if;
  if invitation.accepted_at is not null then raise exception 'Jeton déjà utilisé.'; end if;
  if invitation.expires_at < now() then raise exception 'Jeton expiré.'; end if;
  insert into public.family_members(family_id, user_id, role)
  values (invitation.family_id, auth.uid(), invitation.role)
  on conflict (family_id, user_id) do update set role = excluded.role;
  update public.invitations set accepted_at = now() where id = invitation.id;
  return invitation.family_id;
end;
$$;

-- Créer un jeton : réservé aux admins de l'arbre. Le jeton est généré côté base,
-- jamais devinable côté navigateur. `p_email` reste facultatif, à titre de mémo.
create or replace function public.create_invitation(
  p_family uuid,
  p_role text default 'viewer',
  p_email text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  new_token text;
begin
  if not public.can_admin(p_family) then
    raise exception 'Seul un administrateur peut créer un jeton.';
  end if;
  if p_role not in ('admin', 'editor', 'viewer') then
    raise exception 'Rôle inconnu.';
  end if;
  insert into public.invitations(family_id, email, role, invited_by, expires_at)
  values (p_family, nullif(lower(trim(coalesce(p_email, ''))), ''), p_role,
          auth.uid(), now() + interval '90 days')
  returning token into new_token;
  return new_token;
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS : personne ne lit un arbre sans être membre ; viewer ne peut pas écrire.
-- ---------------------------------------------------------------------------

alter table public.families           enable row level security;
alter table public.family_members     enable row level security;
alter table public.family_documents   enable row level security;
alter table public.invitations        enable row level security;

-- Les policies sont droppées avant création : la migration peut être
-- réappliquée sans erreur après un correctif.
drop policy if exists "familles visibles aux membres" on public.families;
drop policy if exists "créer sa famille" on public.families;
drop policy if exists "membres lisibles" on public.family_members;
drop policy if exists "un admin gère les membres" on public.family_members;
drop policy if exists "document visible aux membres" on public.family_documents;
drop policy if exists "écriture réservée aux éditeurs" on public.family_documents;
drop policy if exists "modification réservée aux éditeurs" on public.family_documents;
drop policy if exists "jetons lisibles par les admins" on public.invitations;
drop policy if exists "invitation créée par un admin" on public.invitations;
drop policy if exists "invitation retirée par un admin" on public.invitations;
drop policy if exists "lecture des médias de sa famille" on storage.objects;
drop policy if exists "écriture des médias par un éditeur" on storage.objects;
drop policy if exists "modification des médias par un éditeur" on storage.objects;
drop policy if exists "suppression des médias par un éditeur" on storage.objects;

create policy "familles visibles aux membres"
  on public.families for select to authenticated
  using (exists (
    select 1 from public.family_members m
    where m.family_id = id and m.user_id = auth.uid()
  ));

create policy "créer sa famille"
  on public.families for insert to authenticated
  with check (created_by = auth.uid());

create policy "membres lisibles"
  on public.family_members for select to authenticated
  using (user_id = auth.uid() or public.can_admin(family_id));

create policy "un admin gère les membres"
  on public.family_members for all to authenticated
  using (public.can_admin(family_id))
  with check (public.can_admin(family_id));

create policy "document visible aux membres"
  on public.family_documents for select to authenticated
  using (exists (
    select 1 from public.family_members m
    where m.family_id = family_id and m.user_id = auth.uid()
  ));

create policy "écriture réservée aux éditeurs"
  on public.family_documents for insert to authenticated
  with check (public.can_write(family_id));

create policy "modification réservée aux éditeurs"
  on public.family_documents for update to authenticated
  using (public.can_write(family_id))
  with check (public.can_write(family_id));

create policy "jetons lisibles par les admins"
  on public.invitations for select to authenticated
  using (public.can_admin(family_id));

create policy "invitation créée par un admin"
  on public.invitations for insert to authenticated
  with check (public.can_admin(family_id) and invited_by = auth.uid());

create policy "invitation retirée par un admin"
  on public.invitations for delete to authenticated
  using (public.can_admin(family_id));

-- ---------------------------------------------------------------------------
-- Storage : un bucket privé, une clé par famille et par média.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit)
values ('family-media', 'family-media', false, 62914560)
on conflict (id) do nothing;

create policy "lecture des médias de sa famille"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'family-media'
    and exists (
      select 1 from public.family_members m
      where m.family_id = (storage.foldername(name))[1]::uuid and m.user_id = auth.uid()
    )
  );

create policy "écriture des médias par un éditeur"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'family-media'
    and public.can_write((storage.foldername(name))[1]::uuid)
  );

-- `upload(..., { upsert: true })` exécute un UPDATE sur un objet existant :
-- sans cette policy, réimporter une photo déjà présente échouerait en 403.
create policy "modification des médias par un éditeur"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'family-media'
    and public.can_write((storage.foldername(name))[1]::uuid)
  )
  with check (
    bucket_id = 'family-media'
    and public.can_write((storage.foldername(name))[1]::uuid)
  );

create policy "suppression des médias par un éditeur"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'family-media'
    and public.can_write((storage.foldername(name))[1]::uuid)
  );
