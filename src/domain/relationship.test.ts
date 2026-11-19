import { describe, expect, it } from 'vitest';
import { relationshipBetween } from '../domain/relationship';
import { couple, family, person } from '../test/factories';

describe('calcul de parenté', () => {
  it('identifie parents et enfants', () => {
    const mother = person('Mère', { gender: 'female' });
    const child = person('Enfant');
    const data = {
      ...family(mother, child),
      unions: [{
        ...dataUnion(),
        partnerAId: mother.id,
        children: [{ childId: child.id, linkA: 'biological' as const, linkB: 'unknown' as const }],
      }],
    };
    expect(relationshipBetween(data, child.id, mother.id)?.label).toBe('Mère');
    expect(relationshipBetween(data, child.id, mother.id)?.steps).toEqual([
      'mère : Mère Test',
    ]);
    expect(relationshipBetween(data, mother.id, child.id)?.label).toBe('Fils');
  });

  it('identifie les frères et sœurs', () => {
    const mother = person('Mère', { gender: 'female' });
    const a = person('A');
    const b = person('B', { gender: 'female' });
    const data = couple(family(mother, a, b), mother, person('Père'), [a.id, b.id]);
    expect(relationshipBetween(data, a.id, b.id)?.label).toBe('Frère / Sœur');
  });

  it('identifie les cousins et les conjoints', () => {
    const gm = person('Grand-mère', { gender: 'female' });
    const parentA = person('Parent A');
    const parentB = person('Parent B');
    const cousinA = person('Cousin A');
    const cousinB = person('Cousin B');
    const spouseA = person('Conjoint A');
    const spouseB = person('Conjointe B', { gender: 'female' });
    let data = family(gm, parentA, parentB, cousinA, cousinB, spouseA, spouseB);
    data = couple(couple(data, gm, person('Grand-père'), [parentA.id, parentB.id]), parentA, spouseA, [cousinA.id]);
    data = couple(data, parentB, spouseB, [cousinB.id]);
    expect(relationshipBetween(data, cousinA.id, cousinB.id)?.label).toBe('Cousin / Cousine');
    const spouses = relationshipBetween(data, parentA.id, spouseA.id);
    expect(spouses?.label).toBe('Conjoint');
  });

  it('ne trouve rien entre deux branches sans lien', () => {
    const a = person('A');
    const b = person('B');
    expect(relationshipBetween(family(a, b), a.id, b.id)).toBeNull();
  });
});

function dataUnion() {
  return {
    id: 'u-test',
    familyId: 'family-test',
    partnerAId: null,
    partnerBId: null,
    children: [],
    status: 'unknown' as const,
    isCurrent: true,
    createdAt: 'x',
    updatedAt: 'x',
  };
}
