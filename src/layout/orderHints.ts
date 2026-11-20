import type { Id } from '../domain/types';
import type { OrderHint } from './model';

const STORAGE_PREFIX = 'simple-family-tree:order-hints:';

function involves(hint: OrderHint, first: Id, second: Id): boolean {
  return (
    (hint.first === first && hint.second === second) ||
    (hint.first === second && hint.second === first)
  );
}

/**
 * Remplace la contrainte existante entre deux personnes par celle demandée.
 * Renvoie `null` si l'utilisateur avait explicitement fixé l'ordre contraire.
 */
export function swapOrder(
  hints: OrderHint[],
  first: Id,
  second: Id,
  locked = false,
): OrderHint[] | null {
  if (hints.some((hint) => hint.locked && involves(hint, first, second))) {
    return null;
  }
  return [
    ...hints.filter((hint) => !involves(hint, first, second)),
    { first, second, locked },
  ];
}

/**
 * Contrainte posée par l'utilisateur : elle REMPLACE toujours la précédente
 * entre ces deux personnes, même si elle était verrouillée. C'est ce qui
 * permet de changer d'avis autant de fois que nécessaire.
 */
export function setManualOrder(
  hints: OrderHint[],
  first: Id,
  second: Id,
): OrderHint[] {
  return [
    ...hints.filter((hint) => !involves(hint, first, second)),
    { first, second, locked: true },
  ];
}

export function loadOrderHints(familyId: string): OrderHint[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + familyId);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is OrderHint => {
        if (!item || typeof item !== 'object') return false;
        const hint = item as OrderHint;
        return (
          typeof hint.first === 'string' &&
          typeof hint.second === 'string' &&
          hint.first !== hint.second
        );
      })
      .map((hint) => ({
        first: hint.first,
        second: hint.second,
        locked: true,
      }));
  } catch {
    return [];
  }
}

export function saveOrderHints(familyId: string, hints: OrderHint[]): void {
  try {
    window.localStorage.setItem(STORAGE_PREFIX + familyId, JSON.stringify(hints));
  } catch {
    // Préférence non critique : l'ordre manuel reste actif pour la session.
  }
}
