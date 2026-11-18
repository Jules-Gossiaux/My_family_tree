import { describe, expect, it } from 'vitest';
import {
  LocalSettingsStore,
  branchColorOf,
  branchesOf,
  createBranch,
  normalizeSettings,
} from '../domain/settings';

describe('réglages personnels', () => {
  it('isole le marqueur « Moi » par profil', () => {
    window.localStorage.clear();
    const alice = new LocalSettingsStore('alice');
    const bob = new LocalSettingsStore('bob');
    alice.save({ meId: 'p1', branches: [] });
    bob.save({ meId: 'p2', branches: [] });
    expect(alice.load().meId).toBe('p1');
    expect(bob.load().meId).toBe('p2');
  });

  it('une personne peut appartenir à plusieurs branches', () => {
    const first = { ...createBranch('Paternelle', []), memberIds: ['p1'] };
    const second = { ...createBranch('Maternelle', [first]), memberIds: ['p1', 'p2'] };
    const settings = normalizeSettings({ branches: [first, second] });
    expect(branchesOf(settings, 'p1')).toHaveLength(2);
    expect(branchColorOf(settings, 'p1')).toBe(first.color);
    expect(branchesOf(settings, 'p2')).toHaveLength(1);
  });

  it('assainit les réglages corrompus', () => {
    const settings = normalizeSettings({
      meId: 42,
      branches: [
        { id: 'b1', name: '', color: 'rouge', memberIds: ['p1', 'p1', 4] },
        { id: 'b1', name: 'Doublon' },
      ],
    });
    expect(settings.meId).toBeUndefined();
    expect(settings.branches).toHaveLength(1);
    expect(settings.branches[0].name).toBe('Branche');
    expect(settings.branches[0].memberIds).toEqual(['p1']);
    expect(settings.branches[0].color).toMatch(/^#/);
  });
});
