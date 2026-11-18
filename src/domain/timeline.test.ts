import { describe, expect, it } from 'vitest';
import { buildTimeline, timelineYear } from '../domain/timeline';
import { family, person } from '../test/factories';
import type { LifeEvent } from '../domain/types';

function event(id: string, date: string): LifeEvent {
  return {
    id,
    familyId: 'family-test',
    type: 'other',
    date,
    participants: [{ personId: 'p1', role: 'principal' }],
    citations: [],
    mediaIds: [],
    createdAt: 'x',
    updatedAt: 'x',
  };
}

describe('frise chronologique', () => {
  it('trie les faits par année, sans inventer de date', () => {
    expect(timelineYear('vers 1890')).toBe(1890);
    expect(timelineYear('entre 1890 et 1895')).toBe(1890);
    expect(timelineYear('12 mars 1890')).toBe(1890);
    expect(timelineYear('sans date')).toBeUndefined();
    const p = person('Jean', { id: 'p1' });
    const data = {
      ...family(p),
      events: [event('late', '1920'), event('unknown', ''), event('early', 'vers 1890')],
    };
    const entries = buildTimeline(data, p.id);
    expect(entries.map((entry) => entry.eventId)).toEqual([
      'early',
      'late',
      'unknown',
    ]);
  });

  it('inclut les unions dans la frise', () => {
    const p = person('Jean', { id: 'p1' });
    const spouse = person('Marie', { id: 'p2' });
    const data = {
      ...family(p, spouse),
      unions: [
        {
          ...dataUnion(),
          partnerAId: 'p1',
          partnerBId: 'p2',
          startDate: '1912',
        },
      ],
    };
    const entries = buildTimeline(data, p.id);
    expect(entries.some((entry) => entry.type === 'union' && entry.year === 1912)).toBe(true);
  });
});

function dataUnion() {
  return {
    id: 'u1',
    familyId: 'family-test',
    partnerAId: null,
    partnerBId: null,
    children: [],
    status: 'married' as const,
    isCurrent: true,
    createdAt: 'x',
    updatedAt: 'x',
  };
}
