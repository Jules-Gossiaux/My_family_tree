import { describe, expect, it } from 'vitest';
import {
  composeFuzzyDate,
  fuzzyDateShort,
  normalizeSearch,
  parseFuzzyDate,
} from '../domain/dates';

describe('analyse des dates floues', () => {
  it('conserve le texte saisi comme source de vérité', () => {
    for (const raw of ['vers 1890', 'avant 1914', '12 mars 1890', '~1900', 'après 1920']) {
      expect(parseFuzzyDate(raw).raw).toBe(raw);
    }
  });

  it('reconnaît les qualificatifs français', () => {
    expect(parseFuzzyDate('vers 1890').qualifier).toBe('vers');
    expect(parseFuzzyDate('avant 1914').qualifier).toBe('avant');
    expect(parseFuzzyDate('après 1920').qualifier).toBe('après');
    expect(parseFuzzyDate('~1900').qualifier).toBe('vers');
    expect(parseFuzzyDate('circa 1850').qualifier).toBe('vers');
  });

  it('décompose une date complète', () => {
    const parsed = parseFuzzyDate('12 mars 1890');
    expect(parsed.day).toBe('12');
    expect(parsed.month).toBe('mars');
    expect(parsed.year).toBe('1890');
  });

  it('lit les dates ISO historiques sans inventer de précision', () => {
    const parsed = parseFuzzyDate('1890-05-04');
    expect(parsed).toMatchObject({ day: '04', month: '05', year: '1890' });
  });

  it('ne confond pas un mois numérique avec un jour', () => {
    const parsed = parseFuzzyDate('3 1890');
    expect(parsed.month).toBe('03');
    expect(parsed.day).toBe('');
    expect(parsed.year).toBe('1890');
  });

  it('gère les intervalles d’années', () => {
    expect(parseFuzzyDate('entre 1890 et 1895').year).toBe('1890–1895');
  });

  it('recompose une date lisible', () => {
    expect(
      composeFuzzyDate({ qualifier: 'vers', day: '', month: '', year: '1890' }),
    ).toBe('vers 1890');
    expect(
      composeFuzzyDate({ qualifier: '', day: '12', month: '03', year: '1890' }),
    ).toBe('12/03/1890');
  });

  it('raccourcit pour les cartes en gardant qualificatif et année', () => {
    expect(fuzzyDateShort('12 mars 1890')).toBe('1890');
    expect(fuzzyDateShort('vers 1890')).toBe('vers 1890');
    expect(fuzzyDateShort('')).toBe('');
  });

  it('normalise la recherche sans accents ni casse', () => {
    expect(normalizeSearch('Élégante')).toBe(normalizeSearch('elegante'));
    expect(normalizeSearch('  Jeanne  Françoise ')).toBe('jeanne francoise');
  });
});

import { personSearchText } from '../domain/types';
import { person as makePerson } from '../test/factories';

describe('recherche par variantes de nom', () => {
  it('inclut toutes les graphies dans le texte cherchable', () => {
    const p = makePerson('Marie', {
      lastName: 'Martin',
      birthSurname: 'Petit',
      usageSurname: 'Durand',
      additionalGivenNames: 'Jeanne Claire',
      aliases: 'Mimi, Manou',
    });
    const text = normalizeSearch(personSearchText(p));
    for (const needle of ['marie', 'martin', 'petit', 'durand', 'jeanne', 'mimi', 'manou']) {
      expect(text).toContain(normalizeSearch(needle));
    }
  });
});
