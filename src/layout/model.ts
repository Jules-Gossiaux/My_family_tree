import type { Id, LinkType } from '../domain/types';

/**
 * Types et constantes partagés du placement. Isolés dans ce module pour que le
 * moteur (`classic.ts`) et la façade publique (`layout.ts`) puissent se lire
 * l'un l'autre sans import circulaire.
 */

export const PERSON_W = 196;
export const PERSON_H = 80;
/** Diamètre de la pastille qui matérialise une union. */
export const UNION_SIZE = 18;

export interface Point {
  x: number;
  y: number;
}

export interface LaidOutNode {
  key: string;
  kind: 'person' | 'union';
  refId: Id;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Infobulle de la pastille d'union. */
  title?: string;
  /** Union ancienne : pastille atténuée. */
  former?: boolean;
}

export interface LaidOutEdge {
  id: string;
  kind: 'partner' | 'child';
  /** Nature de la branche de filiation (pour le style du trait). */
  link?: LinkType;
  /** Union ancienne : trait atténué. */
  former?: boolean;
  /** Infobulle portée par le trait. */
  title?: string;
  /**
   * Niveau horizontal de la branche. Deux unions dont les barres se
   * chevauchent ont des niveaux DISTINCTS : c'est ce qui empêche les traits
   * de se confondre en une ligne continue.
   */
  lane?: number;
  points: Point[];
}

export interface TreeLayout {
  nodes: LaidOutNode[];
  edges: LaidOutEdge[];
  width: number;
  height: number;
}

/** Polyligne orthogonale avec coins arrondis, pour des branches nettes. */
export function roundedPath(points: Point[], radius = 12): string {
  if (points.length < 2) return '';
  let path = `M ${fmt(points[0].x)} ${fmt(points[0].y)}`;

  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const next = points[index + 1];

    const inX = previous.x - current.x;
    const inY = previous.y - current.y;
    const outX = next.x - current.x;
    const outY = next.y - current.y;
    const inLength = Math.hypot(inX, inY);
    const outLength = Math.hypot(outX, outY);
    if (inLength < 0.5 || outLength < 0.5) continue;
    if (Math.abs(inX * outY - inY * outX) < 0.5) continue;

    const offset = Math.min(radius, inLength / 2, outLength / 2);
    const entry = {
      x: current.x + (inX / inLength) * offset,
      y: current.y + (inY / inLength) * offset,
    };
    const exit = {
      x: current.x + (outX / outLength) * offset,
      y: current.y + (outY / outLength) * offset,
    };
    path += ` L ${fmt(entry.x)} ${fmt(entry.y)} Q ${fmt(current.x)} ${fmt(current.y)} ${fmt(exit.x)} ${fmt(exit.y)}`;
  }

  const last = points[points.length - 1];
  path += ` L ${fmt(last.x)} ${fmt(last.y)}`;
  return path;
}

function fmt(value: number): string {
  return Number(value.toFixed(2)).toString();
}
