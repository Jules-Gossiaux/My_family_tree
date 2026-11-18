import {
  emptyFamily,
  createPerson,
  createUnion,
  type FamilyData,
  type Gender,
  type NewPersonInput,
  type Person,
} from '../domain/types';

let counter = 0;

export function person(
  firstName: string,
  overrides: Partial<NewPersonInput> & { id?: string } = {},
): Person {
  counter += 1;
  const created = createPerson('family-test', {
    firstName,
    lastName: overrides.lastName ?? 'Test',
    gender: (overrides.gender ?? 'unspecified') as Gender,
    birthDate: overrides.birthDate,
    deathDate: overrides.deathDate,
  });
  return overrides.id ? { ...created, id: overrides.id } : created;
}

export function family(...persons: Person[]): FamilyData {
  return { ...emptyFamily(), familyId: 'family-test', persons };
}

export function couple(
  data: FamilyData,
  a: Person,
  b: Person,
  children: string[] = [],
): FamilyData {
  const id = `union-${counter++}`;
  return {
    ...data,
    unions: [
      ...data.unions,
      {
        ...createUnion(data.familyId, a.id, b.id),
        id,
        children: children.map((childId) => ({
          childId,
          linkA: 'biological' as const,
          linkB: 'biological' as const,
        })),
      },
    ],
  };
}
