/**
 * Arbitrage de proximity : la seule vraie question qui reste après le passage
 * au dessin classique.
 *
 * Une fratrie contiguë n'offre que DEUX places extérieures où un conjoint peut
 * rester hors du bloc tout en étant voisin de son partenaire. Avec trois
 * enfants mariés, on ne peut donc pas garder à la fois la fratrie intacte et
 * tous les couples collés. Deux stratégies explicites :
 *
 *  - « fratrie » : bloc intact, conjoints rejetés aux deux extrémités ;
 *  - « couple »  : chaque couple reste collé, la fratrie est coupée.
 *
 * Contrairement à l'ancien moteur (deux passes ELK + optimisation de l'ordre
 * des couches), ces deux propriétés sont ici STRUCTURELLES : elles découlent de
 * la construction des segments, pas d'une pénalité approximative. Le réglage
 * ne fait plus que choisir entre deux impossibilités, il ne « répare » rien.
 */

export type GroupingMode = 'balanced' | 'siblings' | 'couples' | 'off';

export const GROUPING_MODES: GroupingMode[] = [
  'balanced',
  'siblings',
  'couples',
  'off',
];

export const GROUPING_LABELS: Record<GroupingMode, string> = {
  balanced: 'Équilibré',
  siblings: 'Fratries d’abord',
  couples: 'Couples d’abord',
  off: 'Sans centrage',
};

export const GROUPING_HINTS: Record<GroupingMode, string> = {
  balanced:
    'Fratrie intacte tant qu’il y a au plus deux conjoints, couples collés au-delà. Enfants recentrés sous leurs parents.',
  siblings:
    'Les frères et sœurs restent toujours contigus, les conjoints sont placés aux deux extrémités du bloc.',
  couples:
    'Chaque conjoint est collé à son partenaire, même si cela coupe la fratrie.',
  off: 'Ordre de saisie seul : les enfants ne sont pas recentrés sous leurs parents.',
};

export function isGroupingMode(value: unknown): value is GroupingMode {
  return typeof value === 'string' && GROUPING_MODES.includes(value as GroupingMode);
}

export interface AlignWeights {
  /** Attraction vers le milieu du couple parental. */
  parents: number;
  /** Attraction vers le milieu des enfants. */
  children: number;
  /** Inertie : évite les oscillations entre deux balayages. */
  self: number;
}

/**
 * Poids du recentrage barycentrique. On alterne balayages haut → bas et
 * bas → haut ; « parents » domine en descendant, « children » en remontant,
 * ce qui finit par centrer chaque fratrie sous son couple.
 */
export const ALIGN_WEIGHTS: Record<GroupingMode, AlignWeights> = {
  balanced: { parents: 1.6, children: 1.2, self: 0.4 },
  siblings: { parents: 2.4, children: 0.7, self: 0.4 },
  couples: { parents: 0.8, children: 2.1, self: 0.4 },
  off: { parents: 0, children: 0, self: 1 },
};

export function shouldCenter(mode: GroupingMode): boolean {
  return mode !== 'off';
}

export type SegmentStrategy = 'siblings' | 'couples';

/**
 * `balanced` choisit la stratégie groupe par groupe : avec un ou deux conjoints
 * la fratrie peut rester intacte ; au-delà, il vaut mieux garder les couples.
 */
export function segmentStrategy(
  mode: GroupingMode,
  spouseCount: number,
): SegmentStrategy {
  if (mode === 'couples') return 'couples';
  if (mode === 'siblings') return 'siblings';
  if (mode === 'off') return 'siblings';
  return spouseCount <= 2 ? 'siblings' : 'couples';
}
