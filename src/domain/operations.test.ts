import { describe, expect, it } from 'vitest';
import {
  createUnion,
  isGhostUnion,
  pruneGhostUnions,
  unionHasBiological,
  unionPartnerIds,
} from '../domain/types';
import {
  addFirstPerson,
  planRelation,
  relationsOf,
  removePerson,
  replaceUnionPartner,
  updateChildLink,
} from '../domain/operations';
import { findFiliationConflicts } from '../domain/conflicts';
import { family, couple, person } from '../test/factories';

function parentalUnion(familyId: string, motherId: string, childId: string) {
  return {
    ...createUnion(familyId, motherId, null),
    children: [{ childId, linkA: 'biological' as const, linkB: 'unknown' as const }],
  };
}

describe('règles de filiation', () => {
  it('ne fusionne jamais un doublon automatiquement : une question est posée', () => {
    const mother = person('Mère');
    const father = person('Père');
    const child = person('Enfant');
    const stepfather = person('Beau-père');
    const data = couple(
      family(mother, father, child, stepfather),
      mother,
      father,
      [child.id],
    );

    const plan = planRelation(data, {
      kind: 'child',
      personId: stepfather.id,
      related: child,
      isNew: false,
      linkType: 'biological',
    });
    expect(plan.type).toBe('ask');
    if (plan.type === 'ask') {
      expect(plan.question.type).toBe('duplicate-filiation');
    }
    // La planification ne modifie jamais les données.
    expect(data.unions).toHaveLength(1);
  });

  it('demande avant de compléter un second parent manquant', () => {
    const mother = person('Mère');
    const child = person('Enfant');
    const father = person('Père');
    const data = {
      ...family(mother, child, father),
      unions: [parentalUnion('family-test', mother.id, child.id)],
    };

    const plan = planRelation(data, {
      kind: 'spouse',
      personId: mother.id,
      related: father,
      isNew: false,
      linkType: 'biological',
    });
    expect(plan.type).toBe('ask');
    if (plan.type === 'ask') expect(plan.question.type).toBe('second-parent');
  });

  it('détecte un enfant avec deux filiations biologiques', () => {
    const a = person('A');
    const b = person('B');
    const c = person('C');
    const child = person('Enfant');
    const unionA = createUnion('family-test', a.id, b.id);
    unionA.children = [{ childId: child.id, linkA: 'biological', linkB: 'biological' }];
    const unionB = createUnion('family-test', c.id, null);
    unionB.children = [{ childId: child.id, linkA: 'biological', linkB: 'unknown' }];
    const data = { ...family(a, b, c, child), unions: [unionA, unionB] };
    expect(findFiliationConflicts(data)).toHaveLength(1);
  });

  it('une union fantôme a moins de deux branches visibles', () => {
    const a = person('A');
    const union = createUnion('family-test', a.id, null);
    expect(isGhostUnion(union)).toBe(true);
    expect(
      isGhostUnion({
        ...union,
        children: [{ childId: 'c', linkA: 'biological', linkB: 'step' }],
      }),
    ).toBe(false);
    expect(
      isGhostUnion({
        ...union,
        children: [{ childId: 'c', linkA: 'step', linkB: 'step' }],
      }),
    ).toBe(true);
    expect(pruneGhostUnions({ ...family(a), unions: [union] }).unions).toHaveLength(0);
  });

  it('conserve la personne mais retire les liens quand on la supprime', () => {
    const a = person('A');
    const b = person('B');
    const child = person('Enfant');
    const data = couple(family(a, b, child), a, b, [child.id]);
    const next = removePerson(data, b.id);
    expect(next.persons).toHaveLength(2);
    expect(next.unions[0].partnerBId).toBeNull();
    expect(unionPartnerIds(next.unions[0])).toHaveLength(1);
  });

  it('ne compte pas un beau-parent comme parent', () => {
    const a = person('A');
    const b = person('B');
    const child = person('Enfant');
    const data = couple(family(a, b, child), a, b, [child.id]);
    const next = updateChildLink(data, data.unions[0].id, child.id, 'B', 'step');
    expect(relationsOf(next, child.id).parents).toEqual([a.id]);
  });

  it('reconnaît un lien biologique', () => {
    const a = person('A');
    const b = person('B');
    const child = person('Enfant');
    const data = couple(family(a, b, child), a, b, [child.id]);
    expect(unionHasBiological(data.unions[0].children[0])).toBe(true);
  });

  it('remplace un parent sans supprimer l’enfant ni l’union', () => {
    const a = person('A');
    const b = person('B');
    const corrected = person('B corrigé');
    const child = person('Enfant');
    const data = couple(family(a, b, corrected, child), a, b, [child.id]);
    const unionId = data.unions[0].id;

    const next = replaceUnionPartner(data, unionId, 'B', corrected.id);
    expect(next.persons).toHaveLength(4);
    expect(next.unions[0].id).toBe(unionId);
    expect(next.unions[0].partnerBId).toBe(corrected.id);
    expect(next.unions[0].children[0].childId).toBe(child.id);
    expect(next.unions[0].children[0].linkB).toBe('biological');
  });

  it('vide un emplacement de conjoint en gardant les enfants', () => {
    const a = person('A');
    const b = person('B');
    const child = person('Enfant');
    const data = couple(family(a, b, child), a, b, [child.id]);
    const next = replaceUnionPartner(data, data.unions[0].id, 'B', null);
    expect(next.unions[0].partnerBId).toBeNull();
    expect(next.unions[0].children).toHaveLength(1);
    expect(next.persons).toHaveLength(3);
  });

  it('refuse de mettre la même personne des deux côtés de l’union', () => {
    const a = person('A');
    const b = person('B');
    const data = couple(family(a, b), a, b);
    expect(replaceUnionPartner(data, data.unions[0].id, 'B', a.id)).toBe(data);
  });
});

describe('ajout de la première personne', () => {
  it('crée aussi le fait de naissance par défaut', () => {
    const result = addFirstPerson(family(), {
      firstName: 'Jean',
      lastName: 'Dupont',
      gender: 'male',
      birthDate: '12 mai 1900',
    });
    expect(result.data.persons).toHaveLength(1);
    const born = result.data.persons[0];
    expect(born.defaultBirthEventId).toBeDefined();
    expect(
      result.data.events.some(
        (event) =>
          event.id === born.defaultBirthEventId &&
          event.participants[0]?.personId === born.id,
      ),
    ).toBe(true);
  });
});
