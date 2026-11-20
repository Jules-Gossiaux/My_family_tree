import { now } from './id';
import { biologicalUnionIds, completeUnionWithParent } from './conflicts';
import { cleanupPersonReferences, syncDefaultLifeEvents } from './lifeEvents';
import {
  createPerson,
  createUnion,
  freeSlot,
  isFiliationLink,
  isGhostUnion,
  pruneGhostUnions,
  linkInSlot,
  linkOfPartner,
  partnerInSlot,
  slotOfPartner as slotOf,
  touch,
  unionHasBiological,
  unionHasFiliation,
  unionPartnerIds,
  withLinkInSlot,
  withPartnerInSlot,
  type FamilyData,
  type Id,
  type LinkType,
  type MutationResult,
  type NewPersonInput,
  type Person,
  type Union,
  type UnionChild,
  type UnionMetaInput,
  type UnionSlot,
} from './types';

export type RelationKind = 'parent' | 'sibling' | 'child' | 'spouse';

export function getPerson(data: FamilyData, id: Id): Person | undefined {
  return data.persons.find((person) => person.id === id);
}

export function getUnion(data: FamilyData, id: Id): Union | undefined {
  return data.unions.find((union) => union.id === id);
}

/** Unions où la personne est l'un des deux partenaires. */
export function partnerUnionsOf(data: FamilyData, personId: Id): Union[] {
  return data.unions.filter((union) => slotOf(union, personId) !== null);
}

/** Unions dont la personne est l'enfant (union de naissance, hors beau-parent). */
export function birthUnionsOf(data: FamilyData, personId: Id): Union[] {
  return data.unions.filter((union) =>
    union.children.some(
      (child) => child.childId === personId && unionHasFiliation(child),
    ),
  );
}

export function primaryBirthUnionOf(
  data: FamilyData,
  personId: Id,
): Union | undefined {
  const unions = birthUnionsOf(data, personId);
  return (
    unions.find((union) =>
      union.children.some(
        (child) => child.childId === personId && unionHasBiological(child),
      ),
    ) ?? unions[0]
  );
}

/** Toutes les unions qui parlent de cette personne (comme parent ou enfant). */
export function unionsOfPerson(data: FamilyData, personId: Id): Union[] {
  return data.unions.filter(
    (union) =>
      slotOf(union, personId) !== null ||
      union.children.some((child) => child.childId === personId),
  );
}

export interface Relations {
  parents: Id[];
  spouses: Id[];
  children: Id[];
  siblings: Id[];
}

export function relationsOf(data: FamilyData, personId: Id): Relations {
  const birthUnions = birthUnionsOf(data, personId);
  const ownUnions = partnerUnionsOf(data, personId);
  return {
    parents: unique(
      birthUnions.flatMap((union) => {
        const child = union.children.find((c) => c.childId === personId);
        if (!child) return [];
        return unionPartnerIds(union).filter((id) =>
          isFiliationLink(linkOfPartner(union, id, child) ?? 'step'),
        );
      }),
    ),
    spouses: unique(
      ownUnions.flatMap((union) =>
        unionPartnerIds(union).filter((id) => id !== personId),
      ),
    ),
    children: unique(
      ownUnions.flatMap((union) =>
        union.children
          .filter((child) =>
            isFiliationLink(linkOfPartner(union, personId, child) ?? 'step'),
          )
          .map((child) => child.childId),
      ),
    ),
    siblings: unique(
      birthUnions.flatMap((union) =>
        union.children
          .filter(
            (child) => child.childId !== personId && unionHasFiliation(child),
          )
          .map((child) => child.childId),
      ),
    ),
  };
}

function ancestorsOf(data: FamilyData, personId: Id): Set<Id> {
  const visited = new Set<Id>();
  const queue: Id[] = [personId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const union of birthUnionsOf(data, current)) {
      const child = union.children.find((c) => c.childId === current);
      if (!child) continue;
      for (const parentId of unionPartnerIds(union)) {
        if (!isFiliationLink(linkOfPartner(union, parentId, child) ?? 'step')) {
          continue;
        }
        if (!visited.has(parentId)) {
          visited.add(parentId);
          queue.push(parentId);
        }
      }
    }
  }
  return visited;
}

function descendantsOf(data: FamilyData, personId: Id): Set<Id> {
  const visited = new Set<Id>();
  const queue: Id[] = [personId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const union of partnerUnionsOf(data, current)) {
      for (const child of union.children) {
        if (!isFiliationLink(linkOfPartner(union, current, child) ?? 'step')) {
          continue;
        }
        if (!visited.has(child.childId)) {
          visited.add(child.childId);
          queue.push(child.childId);
        }
      }
    }
  }
  return visited;
}

/**
 * Personnes déjà présentes que l'on peut relier sans créer de cycle ni de
 * doublon. Les cousins restent candidats au mariage : ils ne sont ni
 * ancêtres ni descendants l'un de l'autre.
 */
export function linkCandidates(
  data: FamilyData,
  kind: RelationKind,
  personId: Id,
): Person[] {
  if (!getPerson(data, personId)) return [];
  const relations = relationsOf(data, personId);
  const excluded = new Set<Id>([personId]);
  if (kind === 'spouse') relations.spouses.forEach((id) => excluded.add(id));
  if (kind === 'parent') relations.parents.forEach((id) => excluded.add(id));
  if (kind === 'child') relations.children.forEach((id) => excluded.add(id));
  if (kind === 'sibling') relations.siblings.forEach((id) => excluded.add(id));

  const ancestors = ancestorsOf(data, personId);
  const descendants = descendantsOf(data, personId);

  return data.persons.filter((person) => {
    if (excluded.has(person.id)) return false;
    if (kind === 'parent' && descendants.has(person.id)) return false;
    if (kind === 'child' && ancestors.has(person.id)) return false;
    if (
      (kind === 'spouse' || kind === 'sibling') &&
      (ancestors.has(person.id) || descendants.has(person.id))
    ) {
      return false;
    }
    return true;
  });
}

export function addFirstPerson(
  data: FamilyData,
  input: NewPersonInput,
): MutationResult {
  const person = createPerson(data.familyId, input);
  return {
    data: syncDefaultLifeEvents(
      touch({ ...data, persons: [...data.persons, person] }),
    ),
    personId: person.id,
  };
}

// ---------------------------------------------------------------------------
// Ajouts de relations : planification + résolution explicite des doublons
// ---------------------------------------------------------------------------

export interface RelationRequest {
  kind: RelationKind;
  /** Personne depuis laquelle l'action est lancée. */
  personId: Id;
  /** Nouvelle personne (pas encore enregistrée) ou personne existante. */
  related: Person;
  isNew: boolean;
  /** `undefined` = choix automatique, `null` = forcer une nouvelle union. */
  targetUnionId?: Id | null;
  /** Nature du lien de filiation demandé. */
  linkType: LinkType;
  unionMeta?: Partial<UnionMetaInput>;
}

export interface SecondParentQuestion {
  type: 'second-parent';
  request: RelationRequest;
  unionId: Id;
  childIds: Id[];
  slot: UnionSlot;
}

export interface DuplicateFiliationQuestion {
  type: 'duplicate-filiation';
  request: RelationRequest;
  childId: Id;
  keepUnionId: Id;
  incomingUnionId: Id;
  newParentId: Id | null;
  canComplete: boolean;
  /** Mutation naïve calculée mais PAS encore appliquée. */
  proposal: FamilyData;
}

export type RelationQuestion =
  | SecondParentQuestion
  | DuplicateFiliationQuestion;

export type ConflictResolution =
  | 'complete'
  | 'separate'
  | 'step'
  | 'adoptive'
  | 'legal';

export type RelationPlan =
  | { type: 'apply'; result: MutationResult }
  | { type: 'ask'; question: RelationQuestion };

/**
 * Point d'entrée unique des quatre ajouts. Ne modifie JAMAIS les données :
 * soit il produit directement une mutation sûre, soit il renvoie une question
 * à poser à l'utilisateur. C'est ce qui garantit « toujours demander ».
 */
export function planRelation(
  data: FamilyData,
  request: RelationRequest,
): RelationPlan {
  if (!getPerson(data, request.personId) || request.related.id === request.personId) {
    return {
      type: 'apply',
      result: { data, personId: request.personId },
    };
  }

  // Cas 1 : on ajoute un conjoint alors qu'une union parentale de cette
  // personne a encore un slot vide. C'est exactement le piège « Hector →
  // Clémentine → Jeanne-Françoise ». On demande AVANT de créer quoi que ce soit.
  if (request.kind === 'spouse') {
    const incomplete = findIncompleteParentalUnion(data, request.personId);
    const slot = incomplete ? freeSlot(incomplete) : null;
    if (incomplete && slot) {
      return {
        type: 'ask',
        question: {
          type: 'second-parent',
          request,
          unionId: incomplete.id,
          childIds: incomplete.children
            .filter(unionHasFiliation)
            .map((child) => child.childId),
          slot,
        },
      };
    }
  }

  const proposal = buildProposal(data, request);
  const duplicate = detectNewDuplicate(data, proposal, request);
  if (duplicate) return { type: 'ask', question: duplicate };

  return {
    type: 'apply',
    result: { data: proposal, personId: request.related.id },
  };
}

/** Applique le choix fait dans la boîte de dialogue de résolution. */
export function resolveRelation(
  data: FamilyData,
  question: RelationQuestion,
  choice: ConflictResolution,
): MutationResult {
  const request = question.request;
  const personId = request.related.id;

  if (question.type === 'second-parent') {
    if (choice === 'separate' || choice === 'step') {
      const unions = addSpouse(
        data,
        request.personId,
        request.related.id,
        request.unionMeta,
      );
      return { data: withPersons(data, unions, request), personId };
    }
    const link: LinkType =
      choice === 'legal'
        ? 'legal'
        : choice === 'adoptive'
          ? 'adoptive'
          : 'biological';
    const completed = completeUnionWithParent(
      data,
      question.unionId,
      request.related.id,
      question.childIds,
      link,
    );
    const withMeta = applyUnionMeta(completed, question.unionId, request.unionMeta);
    return {
      data: withPersons(withMeta, withMeta.unions, request),
      personId,
    };
  }

  if (choice === 'complete' && question.canComplete && question.newParentId) {
    const completed = completeUnionWithParent(
      data,
      question.keepUnionId,
      question.newParentId,
      [question.childId],
    );
    const withMeta = applyUnionMeta(
      completed,
      question.keepUnionId,
      request.unionMeta,
    );
    return {
      data: withPersons(withMeta, withMeta.unions, request),
      personId,
    };
  }

  // Le couple reste distinct : on garde la mutation mais on transforme le
  // lien surnuméraire en beau-parent / adoption / lien légal.
  const mode: 'step' | 'adoptive' | 'legal' =
    choice === 'legal' ? 'legal' : choice === 'adoptive' ? 'adoptive' : 'step';
  const unions = question.proposal.unions.map((union) => {
    if (union.id !== question.incomingUnionId) return union;
    return {
      ...union,
      children: union.children.map((child) =>
        child.childId === question.childId
          ? downgradeProposal(child, mode)
          : child,
      ),
      updatedAt: now(),
    };
  });
  return {
    data: pruneGhostUnions(touch({ ...question.proposal, unions })),
    personId,
  };
}

function downgradeProposal(
  child: UnionChild,
  mode: 'step' | 'adoptive' | 'legal',
): UnionChild {
  if (mode === 'step') return { ...child, linkA: 'step', linkB: 'step' };
  const convert = (link: LinkType): LinkType =>
    link === 'biological' ? (mode === 'legal' ? 'legal' : 'adoptive') : link;
  return { ...child, linkA: convert(child.linkA), linkB: convert(child.linkB) };
}

function detectNewDuplicate(
  before: FamilyData,
  after: FamilyData,
  request: RelationRequest,
): DuplicateFiliationQuestion | null {
  for (const childId of touchedChildIds(request)) {
    const beforeIds = biologicalUnionIds(before, childId);
    const afterUnions = after.unions.filter((union) =>
      union.children.some(
        (child) => child.childId === childId && unionHasBiological(child),
      ),
    );
    // Un conflit déjà présent dans les données ne doit pas bloquer un ajout
    // sans rapport : il est traité séparément par le bandeau « doublons ».
    if (afterUnions.length < 2 || beforeIds.size >= afterUnions.length) continue;

    const keep =
      afterUnions.find((union) => beforeIds.has(union.id)) ?? afterUnions[0];
    const incoming = afterUnions.find((union) => union.id !== keep.id);
    if (!incoming) continue;

    const keepPartners = unionPartnerIds(keep);
    const newParentId =
      unionPartnerIds(incoming).find((id) => !keepPartners.includes(id)) ?? null;
    return {
      type: 'duplicate-filiation',
      request,
      childId,
      keepUnionId: keep.id,
      incomingUnionId: incoming.id,
      newParentId,
      canComplete: freeSlot(keep) !== null && newParentId !== null,
      proposal: after,
    };
  }
  return null;
}

function touchedChildIds(request: RelationRequest): Id[] {
  switch (request.kind) {
    case 'parent':
      return [request.personId];
    case 'child':
    case 'sibling':
      return [request.related.id, request.personId];
    case 'spouse':
      return [];
  }
}

function findIncompleteParentalUnion(
  data: FamilyData,
  personId: Id,
): Union | undefined {
  return data.unions.find(
    (union) =>
      slotOf(union, personId) !== null &&
      freeSlot(union) !== null &&
      union.children.some(unionHasFiliation),
  );
}

function buildProposal(data: FamilyData, request: RelationRequest): FamilyData {
  const { kind, personId, related, linkType, targetUnionId, unionMeta } = request;
  let unions: Union[];
  switch (kind) {
    case 'parent':
      unions = addParent(data, personId, related.id, linkType);
      break;
    case 'sibling':
      unions = addSibling(data, personId, related.id, linkType);
      break;
    case 'child':
      unions = addChild(data, personId, related.id, linkType, targetUnionId);
      break;
    case 'spouse':
      unions = addSpouse(data, personId, related.id, unionMeta);
      break;
  }
  return withPersons(data, unions, request);
}

function withPersons(
  base: FamilyData,
  unions: Union[],
  request: RelationRequest,
): FamilyData {
  return syncDefaultLifeEvents(
    pruneGhostUnions(
      touch({
        ...base,
        persons:
          request.isNew && !getPerson(base, request.related.id)
            ? [...base.persons, request.related]
            : base.persons,
        unions,
      }),
    ),
  );
}

/**
 * Construit une liaison union → enfant. Quand l'autre slot est vide, on note
 * « biological » : le second parent existe mais n'est pas encore renseigné.
 * Un lien « step » des deux côtés ne dessine aucune branche.
 */
function makeChildEntry(
  childId: Id,
  ownLink: LinkType,
  ownSlot: UnionSlot,
  otherPartnerExists: boolean,
): UnionChild {
  const otherLink: LinkType =
    ownLink === 'step'
      ? 'step'
      : otherPartnerExists
        ? ownLink
        : 'biological';
  return ownSlot === 'A'
    ? { childId, linkA: ownLink, linkB: otherLink }
    : { childId, linkA: otherLink, linkB: ownLink };
}

function addParent(
  data: FamilyData,
  childId: Id,
  parentId: Id,
  linkType: LinkType,
): Union[] {
  const incomplete = birthUnionsOf(data, childId).find(
    (union) => freeSlot(union) !== null,
  );
  if (incomplete) {
    const slot = freeSlot(incomplete)!;
    return data.unions.map((union) =>
      union.id === incomplete.id
        ? {
            ...withPartnerInSlot(union, slot, parentId),
            children: union.children.map((child) =>
              unionHasFiliation(child) && linkInSlot(child, slot) !== 'step'
                ? withLinkInSlot(child, slot, linkType)
                : child,
            ),
            status: union.status === 'unknown' ? 'partnered' : union.status,
            updatedAt: now(),
          }
        : union,
    );
  }
  return [
    ...data.unions,
    createUnion(data.familyId, parentId, null, [
      makeChildEntry(childId, linkType, 'A', false),
    ]),
  ];
}

function addSibling(
  data: FamilyData,
  personId: Id,
  siblingId: Id,
  linkType: LinkType,
): Union[] {
  const birth = primaryBirthUnionOf(data, personId);
  if (birth) {
    const own = birth.children.find((child) => child.childId === personId);
    const entry: UnionChild = own
      ? { childId: siblingId, linkA: own.linkA, linkB: own.linkB }
      : makeChildEntry(siblingId, linkType, 'A', false);
    return data.unions.map((union) =>
      union.id === birth.id
        ? {
            ...union,
            children: [
              ...union.children.filter((child) => child.childId !== siblingId),
              entry,
            ],
            updatedAt: now(),
          }
        : union,
    );
  }
  return [
    ...data.unions,
    createUnion(data.familyId, null, null, [
      makeChildEntry(personId, linkType, 'A', false),
      makeChildEntry(siblingId, linkType, 'A', false),
    ]),
  ];
}

function addChild(
  data: FamilyData,
  parentId: Id,
  childId: Id,
  linkType: LinkType,
  targetUnionId?: Id | null,
): Union[] {
  const ownUnions = partnerUnionsOf(data, parentId);
  const explicit = targetUnionId ? getUnion(data, targetUnionId) : undefined;
  const target =
    targetUnionId === null
      ? undefined
      : explicit && slotOf(explicit, parentId) !== null
        ? explicit
        : targetUnionId
          ? undefined
          : ownUnions.length === 1
            ? ownUnions[0]
            : undefined;

  if (target) {
    const slot = slotOf(target, parentId)!;
    const otherSlot: UnionSlot = slot === 'A' ? 'B' : 'A';
    const entry = makeChildEntry(
      childId,
      linkType,
      slot,
      partnerInSlot(target, otherSlot) !== null,
    );
    const exists = target.children.some((child) => child.childId === childId);
    return data.unions.map((union) =>
      union.id === target.id
        ? {
            ...union,
            children: exists
              ? union.children.map((child) =>
                  child.childId === childId
                    ? { ...child, linkA: entry.linkA, linkB: entry.linkB }
                    : child,
                )
              : [...union.children, entry],
            updatedAt: now(),
          }
        : union,
    );
  }
  return [
    ...data.unions,
    createUnion(data.familyId, parentId, null, [
      makeChildEntry(childId, linkType, 'A', false),
    ]),
  ];
}

/**
 * Nouvelle union de couple. Les enfants déjà connus du premier conjoint sont
 * enregistrés comme « beau-parent » : aucune branche de filiation n'apparaît,
 * mais la fiche garde trace du lien social (famille recomposée).
 */
function addSpouse(
  data: FamilyData,
  personId: Id,
  spouseId: Id,
  meta?: Partial<UnionMetaInput>,
): Union[] {
  const stepChildren: UnionChild[] = [];
  const seen = new Set<Id>();
  for (const union of partnerUnionsOf(data, personId)) {
    for (const child of union.children) {
      if (!unionHasFiliation(child) || seen.has(child.childId)) continue;
      seen.add(child.childId);
      stepChildren.push({ childId: child.childId, linkA: 'step', linkB: 'step' });
    }
  }

  const makeCurrent = meta?.isCurrent ?? true;
  const unions = data.unions.map((union) => {
    if (
      makeCurrent &&
      unionPartnerIds(union).length === 2 &&
      (slotOf(union, personId) !== null || slotOf(union, spouseId) !== null)
    ) {
      return { ...union, isCurrent: false, updatedAt: now() };
    }
    return union;
  });

  return [
    ...unions,
    createUnion(data.familyId, personId, spouseId, stepChildren, meta),
  ];
}

// ---------------------------------------------------------------------------
// Édition directe (fiche personne)
// ---------------------------------------------------------------------------

export function updatePerson(
  data: FamilyData,
  personId: Id,
  patch: Partial<NewPersonInput>,
): FamilyData {
  // Un `undefined` explicite signifie « effacer ce champ » : on ne peut donc
  // pas tester seulement `!== undefined`, sinon une date saisie puis vidée
  // resterait bloquée dans la fiche.
  const has = (key: keyof NewPersonInput) =>
    Object.prototype.hasOwnProperty.call(patch, key);
  const updated = touch({
    ...data,
    persons: data.persons.map((person) =>
      person.id === personId
        ? {
            ...person,
            ...(has('firstName') ? { firstName: patch.firstName ?? '' } : {}),
            ...(has('lastName') ? { lastName: patch.lastName ?? '' } : {}),
            ...(has('birthSurname')
              ? { birthSurname: patch.birthSurname?.trim() || undefined }
              : {}),
            ...(has('usageSurname')
              ? { usageSurname: patch.usageSurname?.trim() || undefined }
              : {}),
            ...(has('additionalGivenNames')
              ? { additionalGivenNames: patch.additionalGivenNames?.trim() || undefined }
              : {}),
            ...(has('aliases')
              ? { aliases: patch.aliases?.trim() || undefined }
              : {}),
            ...(has('gender') && patch.gender ? { gender: patch.gender } : {}),
            ...(has('birthDate') ? { birthDate: patch.birthDate || undefined } : {}),
            ...(has('deathDate') ? { deathDate: patch.deathDate || undefined } : {}),
            ...(has('deceased')
              ? {
                  deceased: patch.deceased === true || undefined,
                  ...(patch.deceased === false ? { deathDate: undefined } : {}),
                }
              : {}),
            ...(has('address')
              ? { address: patch.address?.trim() || undefined }
              : {}),
            ...(has('phone') ? { phone: patch.phone?.trim() || undefined } : {}),
            ...(has('email') ? { email: patch.email?.trim() || undefined } : {}),
            ...(has('cemetery')
              ? { cemetery: patch.cemetery?.trim() || undefined }
              : {}),
            ...(has('notes') ? { notes: patch.notes?.trim() || undefined } : {}),
            updatedAt: now(),
          }
        : person,
    ),
  });
  return syncDefaultLifeEvents(updated);
}

export function updateUnion(
  data: FamilyData,
  unionId: Id,
  patch: Partial<UnionMetaInput>,
): FamilyData {
  const target = getUnion(data, unionId);
  if (!target) return data;
  const makeCurrent = patch.isCurrent === true;
  return touch({
    ...data,
    unions: data.unions.map((union) => {
      if (union.id === unionId) {
        return { ...union, ...patch, updatedAt: now() };
      }
      if (makeCurrent && unionPartnerIds(union).length === 2) {
        const shares = unionPartnerIds(union).some(
          (id) => unionPartnerIds(target).includes(id),
        );
        if (shares) return { ...union, isCurrent: false, updatedAt: now() };
      }
      return union;
    }),
  });
}

/**
 * Remplace (ou vide) un des deux emplacements d'une union.
 *
 * Utilisé quand on s'est trompé de parent ou de conjoint. Les enfants et
 * leurs liens restent attachés à l'union : on ne supprime aucune personne et
 * on ne fusionne rien automatiquement. Si le remplacement crée une seconde
 * filiation biologique pour un enfant, le mécanisme existant de détection
 * des conflits la signalera pour que l'utilisateur choisisse.
 */
export function replaceUnionPartner(
  data: FamilyData,
  unionId: Id,
  slot: UnionSlot,
  partnerId: Id | null,
): FamilyData {
  const union = getUnion(data, unionId);
  if (!union) return data;
  const field = slot === 'A' ? 'partnerAId' : 'partnerBId';
  const otherField = slot === 'A' ? 'partnerBId' : 'partnerAId';
  if (partnerId === union[field]) return data;
  if (partnerId && (partnerId === union[otherField] || !getPerson(data, partnerId))) {
    return data;
  }
  const unions = data.unions
    .map((candidate) =>
      candidate.id === unionId
        ? { ...candidate, [field]: partnerId, updatedAt: now() }
        : candidate,
    )
    .filter((candidate) => !isGhostUnion(candidate));
  return touch({ ...data, unions });
}

export function updateChildLink(
  data: FamilyData,
  unionId: Id,
  childId: Id,
  slot: UnionSlot,
  link: LinkType,
): FamilyData {
  return pruneGhostUnions(
    touch({
      ...data,
      unions: data.unions.map((union) =>
        union.id === unionId
          ? {
              ...union,
              children: union.children.map((child) =>
                child.childId === childId
                  ? withLinkInSlot(child, slot, link)
                  : child,
              ),
              updatedAt: now(),
            }
          : union,
      ),
    }),
  );
}

export function removeChildLink(
  data: FamilyData,
  unionId: Id,
  childId: Id,
): FamilyData {
  const unions = data.unions
    .map((union) =>
      union.id === unionId
        ? {
            ...union,
            children: union.children.filter((child) => child.childId !== childId),
            updatedAt: now(),
          }
        : union,
    )
    .filter((union) => !isGhostUnion(union));
  return touch({ ...data, unions });
}

export function removeUnion(data: FamilyData, unionId: Id): FamilyData {
  return touch({
    ...data,
    unions: data.unions.filter((union) => union.id !== unionId),
  });
}

export function removePerson(data: FamilyData, personId: Id): FamilyData {
  const persons = data.persons.filter((person) => person.id !== personId);
  const valid = new Set(persons.map((person) => person.id));
  const unions = data.unions
    .map((union) => ({
      ...union,
      partnerAId:
        union.partnerAId && valid.has(union.partnerAId)
          ? union.partnerAId
          : null,
      partnerBId:
        union.partnerBId && valid.has(union.partnerBId)
          ? union.partnerBId
          : null,
      children: union.children.filter((child) => valid.has(child.childId)),
      updatedAt: now(),
    }))
    // Après la suppression d'un parent, une union peut n'avoir plus aucun
    // partenaire. Si elle ne porte qu'un seul enfant, elle ne représente plus
    // ni couple ni fratrie : on la retire au lieu de laisser une branche morte.
    .filter((union) => !isGhostUnion(union));
  return touch(cleanupPersonReferences({ ...data, persons, unions }, personId));
}

function applyUnionMeta(
  data: FamilyData,
  unionId: Id,
  meta?: Partial<UnionMetaInput>,
): FamilyData {
  if (!meta) return data;
  return updateUnion(data, unionId, meta);
}

function unique(ids: Id[]): Id[] {
  return Array.from(new Set(ids));
}
