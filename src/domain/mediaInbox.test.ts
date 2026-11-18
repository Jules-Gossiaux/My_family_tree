import { describe, expect, it } from 'vitest';
import { validateFamilyData } from '../domain/repository';
import { family, person } from '../test/factories';

describe('médias partagés', () => {
  it('conserve l’empreinte d’un média à la validation', () => {
    const data = family(person('Jean'));
    const validated = validateFamilyData({
      ...data,
      media: [
        {
          id: 'm1',
          familyId: data.familyId,
          kind: 'photo',
          key: 'family-test/m1',
          fileName: 'photo.jpg',
          mimeType: 'image/jpeg',
          fingerprint: 'abc123',
          personIds: [data.persons[0].id],
          citations: [],
          createdAt: 'x',
          updatedAt: 'x',
        },
      ],
    });
    expect(validated.media[0].fingerprint).toBe('abc123');
  });

  it('accepte un document sans empreinte (import v3 antérieur)', () => {
    const data = family(person('Jean'));
    const validated = validateFamilyData({
      ...data,
      media: [
        {
          id: 'm1',
          familyId: data.familyId,
          kind: 'document',
          key: 'family-test/m1',
          fileName: 'acte.pdf',
          mimeType: 'application/pdf',
          personIds: [],
          citations: [],
          createdAt: 'x',
          updatedAt: 'x',
        },
      ],
    });
    expect(validated.media[0].fingerprint).toBeUndefined();
  });
});
