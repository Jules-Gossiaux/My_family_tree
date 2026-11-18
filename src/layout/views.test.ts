import { describe, expect, it } from 'vitest';
import { computeFocusedView, isTreeViewMode } from './views';
import { couple, family, person } from '../test/factories';

describe('vues alternatives', () => {
  const root = person('Racine', { id: 'root' });
  const parent = person('Parent', { id: 'parent' });
  const grandparent = person('Grand-parent', { id: 'gp' });
  const child = person('Enfant', { id: 'child' });
  const spouse = person('Conjoint', { id: 'spouse' });
  const base = family(root, parent, grandparent, child, spouse);
  const data = couple(
    couple(
      {
        ...base,
        unions: [
          {
            id: 'u1',
            familyId: 'family-test',
            partnerAId: 'gp',
            partnerBId: null,
            children: [{ childId: 'parent', linkA: 'biological', linkB: 'unknown' }],
            status: 'unknown',
            isCurrent: true,
            createdAt: 'x',
            updatedAt: 'x',
          },
          {
            id: 'u2',
            familyId: 'family-test',
            partnerAId: 'parent',
            partnerBId: null,
            children: [{ childId: 'root', linkA: 'biological', linkB: 'unknown' }],
            status: 'unknown',
            isCurrent: true,
            createdAt: 'x',
            updatedAt: 'x',
          },
        ],
      },
      person('Autre parent', { id: 'other' }),
      person('Autre parent 2', { id: 'other2' }),
      ['root'],
    ),
    root,
    spouse,
    ['child'],
  );

  it('vue ascendants : racine, parent et grand-parent', () => {
    const layout = computeFocusedView(data, 'ancestors', 'root');
    const ids = layout.nodes.map((node) => node.refId);
    expect(ids).toContain('root');
    expect(ids).toContain('parent');
    expect(ids).toContain('gp');
    expect(ids).not.toContain('child');
  });

  it('vue sablier : ascendants et descendants', () => {
    const layout = computeFocusedView(data, 'hourglass', 'root');
    const ids = layout.nodes.map((node) => node.refId);
    expect(ids).toContain('gp');
    expect(ids).toContain('child');
    expect(ids).toContain('spouse');
  });

  it('vue éventail : la personne et ses conjoints', () => {
    const layout = computeFocusedView(data, 'fan', 'root');
    const ids = layout.nodes.map((node) => node.refId);
    expect(ids).toContain('root');
    expect(ids).toContain('spouse');
    expect(ids).not.toContain('gp');
  });

  it('refuse un mode inconnu et une racine absente', () => {
    expect(isTreeViewMode('inconnu')).toBe(false);
    expect(isTreeViewMode('fan')).toBe(true);
    expect(computeFocusedView(data, 'ancestors', 'absent').nodes).toEqual([]);
  });
});
