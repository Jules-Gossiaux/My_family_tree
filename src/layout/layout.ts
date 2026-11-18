import { isGhostUnion, type FamilyData, type Id } from '../domain/types';
import { computeClassicLayout } from './classic';
import type { GroupingMode } from './grouping';

export {
  PERSON_W,
  PERSON_H,
  UNION_SIZE,
  roundedPath,
  type Point,
  type LaidOutNode,
  type LaidOutEdge,
  type TreeLayout,
} from './model';

/**
 * Empreinte de la structure du graphe. Les champs de texte d'une fiche
 * (nom, dates, notes) n'influencent pas le placement : on évite ainsi de
 * relancer le calcul à chaque frappe dans le formulaire.
 */
export function structureKey(data: FamilyData): string {
  return JSON.stringify({
    persons: data.persons.map((person: { id: Id }) => person.id),
    unions: data.unions
      .filter((union) => !isGhostUnion(union))
      .map((union) => [
        union.id,
        union.partnerAId,
        union.partnerBId,
        union.isCurrent,
        union.children.map((child) => [
          child.childId,
          child.linkA,
          child.linkB,
        ]),
      ]),
  });
}

/**
 * Façade publique du placement. Le dessin est produit par `classic.ts` :
 * générations, fratries contiguës, couples et branches calculés avec la
 * sémantique familiale. Aucune racine, aucune personne centrale : toutes les
 * composantes sont placées par le même algorithme, la vue est identique pour
 * chaque membre.
 *
 * La fonction reste asynchrone pour ne pas changer le contrat de l'interface,
 * mais le calcul est désormais synchrone et déterministe (plus de moteur ELK
 * chargé à la demande, plus de seconde passe).
 */
export async function computeLayout(
  data: FamilyData,
  mode: GroupingMode = 'balanced',
): Promise<import('./model').TreeLayout> {
  return computeClassicLayout(data, mode);
}
