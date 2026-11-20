import { describe, expect, it } from 'vitest';
import { exportGedcom, gedcomDate } from '../domain/gedcom';
import { couple, family, person } from '../test/factories';

describe('export GEDCOM', () => {
  it('convertit les dates floues sans inventer de précision', () => {
    expect(gedcomDate('12 mars 1890')).toBe('12 MAR 1890');
    expect(gedcomDate('vers 1890')).toBe('ABT 1890');
    expect(gedcomDate('avant 1914')).toBe('BEF 1914');
    expect(gedcomDate('après 1920')).toBe('AFT 1920');
    expect(gedcomDate('')).toBeUndefined();
  });

  it('exporte personnes, unions et filiations', () => {
    const mother = person('Marie', { lastName: 'Martin', birthDate: 'vers 1890' });
    const father = person('Pierre', { lastName: 'Martin' });
    const child = person('Jean', { lastName: 'Martin', birthDate: '12 mars 1912' });
    const data = couple(family(mother, father, child), mother, father, [child.id]);
    const output = exportGedcom(data);

    expect(output).toContain('0 HEAD');
    expect(output).toContain('0 TRLR');
    expect(output).toContain('1 NAME Marie /Martin/');
    expect(output).toContain('2 DATE ABT 1890');
    expect(output).toContain('2 DATE 12 MAR 1912');
    expect(output).toContain('1 HUSB @I1@');
    expect(output).toContain('1 WIFE @I2@');
    expect(output).toContain('1 CHIL @I3@');
    expect(output).toContain('1 FAMC @F1@');
  });

  it('exporte le décès même sans date connue', () => {
    const unknown = person('Sans date', { deceased: true });
    const dated = person('Avec date', { deathDate: 'vers 1980' });
    const output = exportGedcom(family(unknown, dated));

    expect(output).toContain('1 DEAT\r\n');
    expect(output).toContain('2 DATE ABT 1980');
    expect(output).not.toContain('2 DATE undefined');
  });

  it('ne produit aucune référence vide', () => {
    const data = family(person('Seul'));
    const output = exportGedcom(data);
    expect(output).not.toContain('@@');
    expect(output).not.toContain('FAMC @');
  });
});
