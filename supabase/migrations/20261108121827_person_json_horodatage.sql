-- L'arbre range les familles par naissance puis par ordre d'entrée dans la base : la personne
-- rendue à l'écran porte donc son created_at, sans quoi une famille neuve pourrait se glisser
-- devant les autres et tout décaler.
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
    'createdAt', p.created_at,
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

revoke execute on function public.person_json(public.person) from public, anon;
grant execute on function public.person_json(public.person) to authenticated;