import { describe, expect, it } from 'vitest';
import { personChoiceLabel, personChoices } from './personChoices';
import { couple, family, person } from '../test/factories';

describe('personChoiceLabel', () => {
  it('distingue les homonymes par date, puis par parents', () => {
    const grand = person('Jules', { lastName: 'Gossiaux', id: 'grand' });
    const zig = person('zig', { lastName: '', id: 'zig' });
    const middle = person('Jules', { lastName: 'Gossiaux', id: 'middle' });
    const baby = person('Jules', {
      lastName: 'Gossiaux',
      id: 'baby',
      birthDate: '13 novembre 2009',
    });

    let data = family(grand, zig, middle, baby);
    data = couple(data, grand, zig, [middle.id]);
    data = couple(data, middle, baby, []);

    expect(personChoiceLabel(data, baby)).toContain('né 13 novembre 2009');
    expect(personChoiceLabel(data, middle)).toContain(
      'enfant de Jules Gossiaux (conjoint de zig)',
    );
    expect(personChoiceLabel(data, grand)).toContain('conjoint de zig');

    const labels = personChoices(data, [grand, middle, baby]).map((item) => item.label);
    expect(new Set(labels).size).toBe(3);
  });

  it('garde un repère stable sans date ni parent', () => {
    const a = person('Jules', { lastName: 'Gossiaux', id: 'aaa111' });
    const b = person('Jules', { lastName: 'Gossiaux', id: 'bbb222' });
    const data = family(a, b);
    const labels = personChoices(data, [a, b]).map((item) => item.label);
    expect(labels[0]).not.toBe(labels[1]);
    expect(labels[0]).toContain('sans date');
  });
});
