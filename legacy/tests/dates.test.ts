import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseGenealogyDate } from '../server/dates';
import type { GDate } from '../shared/types';

/** Une date se lit toujours pareil : ce qu'on a compris, et ce qu'on a gardé du texte. */
function shape(date: GDate | null): [string | null, string | null, string | null] {
  if (!date) return [null, null, null];
  return [date.qualifier, date.min, date.max];
}

function parse(input: string): GDate | null {
  return parseGenealogyDate(input);
}

describe('dates généalogiques', () => {
  it('reconnaît les écritures numériques', () => {
    assert.deepEqual(shape(parse('1920')), ['exact', '1920', '1920']);
    assert.deepEqual(shape(parse('1920-03')), ['exact', '1920-03', '1920-03']);
    assert.deepEqual(shape(parse('3/1920')), ['exact', '1920-03', '1920-03']);
    assert.deepEqual(shape(parse('1920-03-14')), ['exact', '1920-03-14', '1920-03-14']);
    assert.deepEqual(shape(parse('1920/03/14')), ['exact', '1920-03-14', '1920-03-14']);
  });

  it('lit le jour avant le mois, comme en France', () => {
    assert.deepEqual(shape(parse('14/03/1920')), ['exact', '1920-03-14', '1920-03-14']);
    assert.deepEqual(shape(parse('14.3.1920')), ['exact', '1920-03-14', '1920-03-14']);
    assert.deepEqual(shape(parse('1er/2/1920')), ['exact', '1920-02-01', '1920-02-01']);
  });

  it('lit les mois écrits en français', () => {
    assert.deepEqual(shape(parse('14 mars 1920')), ['exact', '1920-03-14', '1920-03-14']);
    assert.deepEqual(shape(parse('14 Janvier 1920')), ['exact', '1920-01-14', '1920-01-14']);
    assert.deepEqual(shape(parse('juin 1930')), ['exact', '1930-06', '1930-06']);
    assert.deepEqual(shape(parse('3 déc. 1918')), ['exact', '1918-12-03', '1918-12-03']);
  });

  it('refuse une date qui ne peut pas exister', () => {
    for (const impossible of ['13/13/1920', '31/02/1920', '29/02/1921', '14/13/1920']) {
      const date = parse(impossible);
      assert.equal(date?.qualifier, 'unknown', `${impossible} ne doit jamais devenir une date`);
      assert.equal(date?.min, null);
      assert.equal(date?.max, null);
      assert.equal(date?.text, impossible);
    }
  });

  it('accepte le 29 février seulement les années bissextiles', () => {
    assert.deepEqual(shape(parse('29/02/1920')), ['exact', '1920-02-29', '1920-02-29']);
    assert.equal(parse('29/02/1921')?.qualifier, 'unknown');
  });

  it('place les qualificateurs sur la bonne borne', () => {
    assert.deepEqual(shape(parse('av. 1920')), ['before', null, '1920']);
    assert.deepEqual(shape(parse('avant 14/03/1920')), ['before', null, '1920-03-14']);
    assert.deepEqual(shape(parse('avant le 14 mars 1920')), ['before', null, '1920-03-14']);
    assert.deepEqual(shape(parse('après 1920')), ['after', '1920', null]);
    assert.deepEqual(shape(parse('vers 1920')), ['about', '1920', '1920']);
    assert.deepEqual(shape(parse('environ juin 1930')), ['about', '1930-06', '1930-06']);
    assert.deepEqual(shape(parse('~1920')), ['about', '1920', '1920']);
  });

  it('comprend les intervalles', () => {
    assert.deepEqual(shape(parse('entre 1920 et 1925')), ['between', '1920', '1925']);
    assert.deepEqual(shape(parse('entre 1920-1925')), ['between', '1920', '1925']);
    assert.deepEqual(shape(parse('1920–1925')), ['between', '1920', '1925']);
    assert.deepEqual(shape(parse('1920 .. 1925')), ['between', '1920', '1925']);
    assert.deepEqual(shape(parse('vers 1920-1925')), ['about', '1920', '1925']);
    assert.deepEqual(shape(parse('14/03/1920 - 20/05/1925')), ['between', '1920-03-14', '1925-05-20']);
  });

  it('conserve le texte quand rien n’est compris', () => {
    for (const floue of ['avant-guerre', 'inconnue', 'peu après la guerre', '19', '192?']) {
      const date = parse(floue);
      assert.deepEqual(shape(date), ['unknown', null, null], `${floue} doit rester du texte`);
      assert.equal(date?.text, floue);
    }
  });

  it('rend le texte d’origine tel qu’il a été écrit', () => {
    const date = parse('  Vers 14 mars 1920.  ');
    assert.equal(date?.text, 'Vers 14 mars 1920.');
    assert.deepEqual(shape(date), ['about', '1920-03-14', '1920-03-14']);
  });

  it('ne fabrique pas de date vide', () => {
    assert.equal(parse(''), null);
    assert.equal(parse('   '), null);
    assert.equal(parseGenealogyDate(null), null);
    assert.equal(parseGenealogyDate(undefined), null);
  });
});
