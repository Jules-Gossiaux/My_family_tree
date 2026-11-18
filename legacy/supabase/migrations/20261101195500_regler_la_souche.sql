-- La première écriture en ligne : choisir la souche, la personne à partir de laquelle l'écran
-- descend les générations. C'est aussi le premier geste qui prouve que les droits habitent bien
-- RLS : la fonction s'exécute avec les droits de celui qui clique, donc un lecteur se voit
-- refuser la ligne tree_setting avant même d'essayer de l'écrire.

create or replace function public.set_root(p_person_id text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not public.can_write() then
    raise exception 'Vous consultez cet arbre sans droit de modification.'
      using errcode = '42501';
  end if;

  if p_person_id is not null
     and not exists (select 1 from public.person where id = p_person_id) then
    raise exception 'Cette personne ne figure pas dans l''arbre.'
      using errcode = 'P0002';
  end if;

  insert into public.tree_setting (id, root_person_id, updated_at)
  values (1, p_person_id, now()::text)
  on conflict (id) do update
    set root_person_id = excluded.root_person_id,
        updated_at = excluded.updated_at;
end;
$$;

revoke execute on function public.set_root(text) from public, anon;
grant execute on function public.set_root(text) to authenticated;
