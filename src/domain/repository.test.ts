import { describe, expect, it } from 'vitest';
import {
  LocalFamilyRepository,
  parseFamilyDocument,
  serialize,
  validateFamilyData,
} from '../domain/repository';
import {
  addPlace,
  addSource,
  deletePlace,
  deleteSource,
  placeUsage,
} from '../domain/directories';
import { family, person } from '../test/factories';

describe('validation et migration des documents', () => {
  it('migre un document v1 (tableau de partenaires) en v3', () => {
    const legacy = {
      version: 1,
      familyId: 'family-test',
      persons: [
        { id: 'a', firstName: 'A', lastName: 'Test', gender: 'male', createdAt: 'x' },
        { id: 'b', firstName: 'B', lastName: 'Test', gender: 'female', createdAt: 'x' },
        { id: 'c', firstName: 'C', lastName: 'Test', gender: 'female', createdAt: 'x' },
      ],
      unions: [
        {
          id: 'u',
          partnerIds: ['a', 'b'],
          childIds: ['c'],
          createdAt: 'x',
        },
      ],
      updatedAt: 'x',
    };
    const data = validateFamilyData(legacy);
    expect(data.version).toBe(3);
    expect(data.unions[0].partnerAId).toBe('a');
    expect(data.unions[0].partnerBId).toBe('b');
    expect(data.unions[0].children[0].linkA).toBe('biological');
    expect(data.places).toEqual([]);
    expect(data.media).toEqual([]);
  });

  it('rejette les références pendantes sans perdre les personnes', () => {
    const data = validateFamilyData({
      version: 3,
      familyId: 'family-test',
      persons: [
        { id: 'a', firstName: 'A', lastName: 'T', createdAt: 'x' },
        { id: 'realchild', firstName: 'R', lastName: 'T', createdAt: 'x' },
      ],
      unions: [
        {
          id: 'u',
          partnerAId: 'a',
          partnerBId: 'inconnu',
          children: [
            { childId: 'fantome', linkA: 'biological', linkB: 'biological' },
            { childId: 'realchild', linkA: 'biological', linkB: 'unknown' },
          ],
          createdAt: 'x',
        },
      ],
      events: [
        {
          id: 'e',
          type: 'birth',
          participants: [{ personId: 'a', role: 'principal' }],
          placeId: 'lieu-inexistant',
          citations: [{ sourceId: 'source-inexistante' }],
          createdAt: 'x',
        },
      ],
      updatedAt: 'x',
    });
    expect(data.persons).toHaveLength(2);
    expect(data.unions).toHaveLength(1);
    expect(data.unions[0].partnerBId).toBeNull();
    expect(data.unions[0].children.map((child) => child.childId)).toEqual(['realchild']);
    expect(data.events[0].placeId).toBeUndefined();
    expect(data.events[0].citations).toHaveLength(0);
  });

  it('supprime les unions fantômes à la validation', () => {
    const data = validateFamilyData({
      version: 3,
      familyId: 'family-test',
      persons: [{ id: 'a', firstName: 'A', lastName: 'T', createdAt: 'x' }],
      unions: [{ id: 'u', partnerAId: 'a', partnerBId: null, createdAt: 'x' }],
      updatedAt: 'x',
    });
    expect(data.unions).toHaveLength(0);
    expect(data.persons).toHaveLength(1);
  });

  it('garde une seule notice par cote, accents et casse ignorés', () => {
    const data = validateFamilyData({
      version: 3,
      familyId: 'family-test',
      persons: [{ id: 'a', firstName: 'A', lastName: 'T', createdAt: 'x' }],
      unions: [],
      sources: [
        { id: 's1', reference: 'État civil 1890', title: 'Un', createdAt: 'x' },
        { id: 's2', reference: 'etat civil 1890', title: 'Deux', createdAt: 'x' },
      ],
      updatedAt: 'x',
    });
    expect(data.sources).toHaveLength(1);
  });

  it('importe un document complet sérialisé', async () => {
    const original = family(person('Jean'), person('Marie'));
    const parsed = await parseFamilyDocument(serialize(original));
    expect(parsed.data.persons).toHaveLength(2);
    expect(parsed.mediaRestored).toBe(0);
    expect(parsed.migratedFrom).toBeUndefined();
  });

  it('refuse un JSON invalide avec un message clair', async () => {
    await expect(parseFamilyDocument('{')).rejects.toThrow(/JSON valide/);
    await expect(parseFamilyDocument('[]')).rejects.toThrow(/arbre généalogique/);
    await expect(parseFamilyDocument('{"version":9}')).rejects.toThrow(/Version/);
  });
});

describe('gardes des répertoires', () => {
  it('refuse de supprimer un lieu cité par un fait', () => {
    const initial = family(person('Jean'));
    const withPlace = addPlace(initial, {
      name: 'Lyon',
      kind: 'city',
    });
    const withEvent = {
      ...withPlace,
      events: [
        {
          ...withPlace.events[0],
          id: 'e1',
          type: 'birth' as const,
          placeId: withPlace.places[0].id,
          participants: [{ personId: initial.persons[0].id, role: 'principal' }],
          citations: [],
          mediaIds: [],
          createdAt: 'x',
          updatedAt: 'x',
          familyId: 'family-test',
        },
      ],
    };
    expect(placeUsage(withEvent, withPlace.places[0].id).length).toBeGreaterThan(0);
    expect(deletePlace(withEvent, withPlace.places[0].id)).toBe(withEvent);
    expect(deletePlace(withPlace, withPlace.places[0].id).places).toHaveLength(0);
  });

  it('refuse de supprimer une source citée', () => {
    const base = family(person('Jean'));
    const withSource = addSource(base, {
      reference: 'AC 12',
      title: 'Registre',
      kind: 'civil',
    });
    const source = withSource.sources[0];
    const withEvent = {
      ...withSource,
      events: [
        {
          id: 'e1',
          familyId: 'family-test',
          type: 'birth' as const,
          participants: [{ personId: base.persons[0].id, role: 'principal' }],
          citations: [{ sourceId: source.id }],
          mediaIds: [],
          createdAt: 'x',
          updatedAt: 'x',
        },
      ],
    };
    expect(deleteSource(withEvent, source.id)).toBe(withEvent);
    expect(deleteSource(withSource, source.id).sources).toHaveLength(0);
  });
});

describe('copies de secours automatiques', () => {
  it('écrit une copie avant d’écraser, puis permet de restaurer', async () => {
    window.localStorage.clear();
    const errors: string[] = [];
    const repo = new LocalFamilyRepository({ onSaveError: (m) => m && errors.push(m) });
    const original = family(person('Original'), person('Deux'));
    await repo.save(original);
    const changed = family(person('Modifié'));
    await repo.save(changed);

    const backups = await repo.listBackups();
    expect(backups.length).toBe(1);
    expect(backups[0].persons).toBe(2);

    const restored = await repo.restoreBackup(backups[0].id);
    expect(restored.persons.map((p) => p.firstName)).toEqual(['Original', 'Deux']);
    expect(errors).toEqual([]);
  });

  it('limite le nombre de copies conservées', async () => {
    window.localStorage.clear();
    const repo = new LocalFamilyRepository();
    for (let i = 0; i < 7; i += 1) {
      await repo.save(family(person(`Personne ${i}`)));
    }
    expect((await repo.listBackups()).length).toBe(4);
  });

  it('signale une erreur de sauvegarde au lieu de la masquer', async () => {
    window.localStorage.clear();
    const errors: string[] = [];
    const repo = new LocalFamilyRepository({ onSaveError: (m) => m && errors.push(m) });
    const original = window.localStorage.setItem;
    window.localStorage.setItem = () => {
      throw new Error('Quota dépassé');
    };
    try {
      await expect(repo.save(family(person('A')))).rejects.toThrow();
      expect(errors.length).toBe(1);
    } finally {
      window.localStorage.setItem = original;
    }
  });
});
