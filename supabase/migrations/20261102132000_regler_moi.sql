-- Régler « moi » : un réglage qui appartient à une tête, pas à l'arbre.
--
-- Sur le disque, `config.json` ne pouvait dire qu'un seul « moi », puisqu'une seule personne ouvrait
-- l'application. En ligne, la mère, le cousin et Jules regardent le même arbre au même moment : la
-- personne que chacun veut retrouver d'un clic se range donc sur sa propre ligne de `family_member`,
-- et « moi » cesse d'être un réglage global qui changerait sous les doigts de l'autre.
--
-- Deux conséquences commandent le code. D'abord ceci n'est pas une écriture de l'arbre : un cousin
-- qui ne peut pas modifier une date doit quand même pouvoir se désigner lui-même, sinon « Me
-- recentrer » ne lui sert à rien — la fonction ne teste donc pas `can_write()`. Ensuite la table
-- `family_member` est fermée à `update` pour `authenticated` (le droit d'écrire s'y lit : le laisser
-- modifier sa propre ligne serait se donner l'écriture à soi-même). La fonction passe donc en
-- `security definer`, ne touche que la ligne du demandeur, et ne change jamais `can_write`.

/**
 * Se désigner dans l'arbre, ou se retirer. Un identifiant à `null` éteint le réglage ; un identifiant
 * qui ne correspond à personne est refusé plutôt qu'enregistré — un arbre centré sur une id sans
 * visage ne s'explique pas à l'écran.
 */
create or replace function public.set_me(p_person_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'Il faut être connecté pour se désigner dans l’arbre.'
      using errcode = '42501';
  end if;

  if p_person_id is not null
     and not exists (select 1 from public.person where id = p_person_id) then
    raise exception 'Cette personne n’existe plus dans la base : la personne « moi » n’est pas réglée.'
      using errcode = 'P0002';
  end if;

  update public.family_member
     set person_id = p_person_id
   where auth_uid = v_uid;

  if not found then
    raise exception 'Vous ne figurez pas encore dans cette famille : ouvrez l’invitation reçue avant de vous choisir dans l’arbre.'
      using errcode = '42501';
  end if;
end;
$$;

revoke execute on function public.set_me(text) from public, anon;
grant execute on function public.set_me(text) to authenticated;
