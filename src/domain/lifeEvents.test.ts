import { describe, expect, it } from 'vitest';
import {
  addEvent,
  eventsOfPerson,
  sortByEventDate,
  updateEvent,
} from './lifeEvents';
import { validateFamilyData } from './repository';
import { emptyFamily, type LifeEventInput } from './types';
import { family, person as makePerson } from '../test/factories';

describe('tri des faits de vie', () => {
  it('renvoie les faits du plus ancien au plus récent', () => {
    const subject = makePerson('Jean', { id: 'p1' });
    let data = family(subject);
    for (const date of ['20 novembre 2026', '9 septembre 1948', '11 janvier 1974']) {
      const input: LifeEventInput = {
        type: 'other',
        date,
        participants: [{ personId: subject.id, role: 'principal' }],
        citations: [],
        mediaIds: [],
      };
      data = addEvent(data, input);
    }

    const sorted = ['9 septembre 1948', '11 janvier 1974', '20 novembre 2026'];
    expect(sortByEventDate(data.events).map((event) => event.date)).toEqual(sorted);
    expect(eventsOfPerson(data, subject.id).map((event) => event.date)).toEqual(sorted);
  });
});

describe('faits sans participant', () => {
  it('peut créer, modifier et conserver un fait non rattaché', () => {
    const initial = emptyFamily();
    const created = addEvent(initial, {
      type: 'other',
      title: 'Réunion de famille',
      date: '12 juin 2026',
      participants: [],
      citations: [],
      mediaIds: [],
    });

    expect(created.events).toHaveLength(1);
    expect(created.events[0].participants).toEqual([]);

    const updated = updateEvent(created, created.events[0].id, {
      notes: 'Fait général à la famille',
    });
    expect(updated.events[0].notes).toBe('Fait général à la famille');

    const reloaded = validateFamilyData(JSON.parse(JSON.stringify(updated)));
    expect(reloaded.events).toHaveLength(1);
    expect(reloaded.events[0].participants).toEqual([]);
  });
});
