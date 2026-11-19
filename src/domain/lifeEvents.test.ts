import { describe, expect, it } from 'vitest';
import { addEvent, updateEvent } from './lifeEvents';
import { validateFamilyData } from './repository';
import { emptyFamily } from './types';

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
