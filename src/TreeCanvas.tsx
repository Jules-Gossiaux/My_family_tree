import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  CARD_GAP,
  CARD_H,
  CARD_W,
  type CrossLink,
  type LayoutResult,
  type Unit,
} from './treeLayout';
import { lifeSpan, shortName, truncate } from './dates';
import type { Branch, Person } from '../shared/types';

interface Props {
  layout: LayoutResult;
  selectedId: string | null;
  branches: Branch[];
  /** La personne que l'on est dans l'arbre, si elle a été réglée. */
  mePersonId: string | null;
  onSelect: (personId: string) => void;
  onContextMenu: (personId: string, x: number, y: number) => void;
}

export interface TreeCanvasHandle {
  focusPerson: (personId: string) => void;
  fit: () => void;
  zoomBy: (factor: number) => void;
}

interface View {
  x: number;
  y: number;
  k: number;
}

const MIN_ZOOM = 0.12;
const MAX_ZOOM = 2.4;

/** Ce que dit un trait qui n'a rien d'une descendance. */
const CROSS_LABELS: Record<CrossLink['kind'], string> = {
  parent: 'un parent que l’arbre ne peut pas placer au-dessus de son enfant',
  cycle: 'une boucle dans la famille',
  union: 'une union dont les deux cases sont ailleurs',
};

function kindsOf(links: CrossLink[]): CrossLink['kind'][] {
  return [...new Set(links.map((link) => link.kind))];
}

/** Un trait qui ne descend pas : une courbe douce, jamais l'angle droit d'une descendance. */
function crossPath(link: CrossLink): string {
  if (link.kind === 'union') {
    const bend = 38 * (link.x2 >= link.x1 ? 1 : -1);
    return `M ${link.x1} ${link.y1} C ${link.x1 + bend} ${link.y1}, ${link.x2 - bend} ${link.y2}, ${
      link.x2
    } ${link.y2}`;
  }
  const bend = 44 * (link.y2 >= link.y1 ? 1 : -1);
  return `M ${link.x1} ${link.y1} C ${link.x1} ${link.y1 + bend}, ${link.x2} ${link.y2 - bend}, ${
    link.x2
  } ${link.y2}`;
}

function Card({
  person,
  x,
  y,
  selected,
  color,
  branchName,
  onSelect,
  onContext,
}: {
  person: Person;
  x: number;
  y: number;
  selected: boolean;
  /** La teinte de la branche, ou rien : une case sans branche reste la case par défaut. */
  color: string | null;
  branchName: string | null;
  onSelect: () => void;
  onContext: (event: ReactMouseEvent) => void;
}) {
  return (
    <g
      className={`card${selected ? ' is-selected' : ''}`}
      transform={`translate(${x} ${y})`}
      onClick={onSelect}
      onContextMenu={onContext}
      role="button"
    >
      <title>{branchName ? `${shortName(person)} — ${branchName}` : shortName(person)}</title>
      <rect width={CARD_W} height={CARD_H} rx={10} className="card-box" />
      {color && (
        <rect
          className="card-branch"
          x={9}
          y={CARD_H - 6}
          width={CARD_W - 18}
          height={3}
          rx={1.5}
          fill={color}
        />
      )}
      <text className="card-name" x={CARD_W / 2} y={26}>
        {truncate(shortName(person), 18)}
      </text>
      <text className="card-dates" x={CARD_W / 2} y={45}>
        {lifeSpan(person)}
      </text>
    </g>
  );
}

const TreeCanvas = forwardRef<TreeCanvasHandle, Props>(function TreeCanvas(
  { layout, selectedId, branches, mePersonId, onSelect, onContextMenu },
  ref,
) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 });
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, vx: 0, vy: 0, moved: false });
  const fitted = useRef<string>('');

  /** Une personne se range sous une seule branche : la teinte de sa case doit se lire sans doute. */
  const branchOf = useMemo(() => {
    const byId = new Map(branches.map((branch) => [branch.id, branch]));
    return (person: Person): Branch | null => (person.branchId ? (byId.get(person.branchId) ?? null) : null);
  }, [branches]);

  // « Moi » peut désigner une personne effacée depuis : le recentrage se taisait alors sans raison.
  const me = mePersonId ? (layout.personById.get(mePersonId) ?? null) : null;

  const fit = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    const w = el.clientWidth;
    const h = el.clientHeight;
    if (w === 0 || h === 0) return;
    const k = Math.max(
      MIN_ZOOM,
      Math.min((w - 80) / layout.width, (h - 80) / layout.height, 1.15),
    );
    setView({
      k,
      x: (w - layout.width * k) / 2,
      y: (h - layout.height * k) / 2,
    });
  }, [layout.width, layout.height]);

  const focusPerson = useCallback(
    (personId: string) => {
      const unitKey = layout.unitByPerson.get(personId);
      const el = wrapRef.current;
      if (!unitKey || !el) return;
      const unit = layout.byKey.get(unitKey);
      if (!unit) return;
      const w = el.clientWidth;
      const h = el.clientHeight;
      setView((current) => {
        const k = Math.max(current.k, 0.75);
        return {
          k,
          x: w / 2 - unit.x * k,
          y: h / 2 - (unit.y + CARD_H / 2) * k,
        };
      });
    },
    [layout],
  );

  const zoomBy = useCallback((factor: number) => {
    const el = wrapRef.current;
    if (!el) return;
    const cx = el.clientWidth / 2;
    const cy = el.clientHeight / 2;
    setView((current) => {
      const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, current.k * factor));
      const ratio = k / current.k;
      return { k, x: cx - (cx - current.x) * ratio, y: cy - (cy - current.y) * ratio };
    });
  }, []);

  useImperativeHandle(ref, () => ({ focusPerson, fit, zoomBy }), [focusPerson, fit, zoomBy]);

  const signature = `${layout.rootKeys.join('|')}:${layout.units.length}`;
  useEffect(() => {
    if (layout.units.length === 0) return;
    if (fitted.current === signature) return;
    fitted.current = signature;
    fit();
  }, [signature, fit, layout.units.length]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => fit());
    });
    observer.observe(el);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [fit]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = el.getBoundingClientRect();
      const px = event.clientX - rect.left;
      const py = event.clientY - rect.top;
      setView((current) => {
        const factor = Math.exp(-event.deltaY * 0.0015);
        const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, current.k * factor));
        const ratio = k / current.k;
        return { k, x: px - (px - current.x) * ratio, y: py - (py - current.y) * ratio };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (event: PointerEvent) => {
      const dx = event.clientX - dragStart.current.x;
      const dy = event.clientY - dragStart.current.y;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) dragStart.current.moved = true;
      setView((current) => ({
        ...current,
        x: dragStart.current.vx + dx,
        y: dragStart.current.vy + dy,
      }));
    };
    const onUp = () => setDragging(false);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [dragging]);

  const onPointerDown = (event: ReactPointerEvent) => {
    if (event.button !== 0) return;
    dragStart.current = { x: event.clientX, y: event.clientY, vx: view.x, vy: view.y, moved: false };
    setDragging(true);
  };

  const handleSelect = (personId: string) => {
    if (dragStart.current.moved) return;
    onSelect(personId);
  };

  const renderUnit = (unit: Unit) => {
    const x0 = unit.x - unit.w / 2;
    const slotX = (index: number) => x0 + index * (CARD_W + CARD_GAP);

    return (
      <g key={unit.key}>
        {unit.junctions.map((junction) => (
          <line
            key={junction.coupleId}
            className="couple-link"
            x1={slotX(junction.after) + CARD_W}
            y1={unit.y + CARD_H / 2}
            x2={slotX(junction.after + 1)}
            y2={unit.y + CARD_H / 2}
          />
        ))}
        {unit.slots.map((personId, index) => {
          const person = layout.personById.get(personId);
          if (!person) return null;
          const branch = branchOf(person);
          return (
            <Card
              key={personId}
              person={person}
              x={slotX(index)}
              y={unit.y}
              selected={selectedId === personId}
              color={branch?.color ?? null}
              branchName={branch?.name ?? null}
              onSelect={() => handleSelect(personId)}
              onContext={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onSelect(personId);
                onContextMenu(personId, event.clientX, event.clientY);
              }}
            />
          );
        })}
      </g>
    );
  };

  return (
    <div className="canvas-wrap" ref={wrapRef}>
      <svg className={`canvas${dragging ? ' is-dragging' : ''}`} onPointerDown={onPointerDown}>
        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          <g className="edges">
            {layout.edges.map((edge) => {
              const from = layout.byKey.get(edge.from);
              const to = layout.byKey.get(edge.to);
              if (!from || !to) return null;
              const y1 = from.y + CARD_H;
              const y2 = to.y;
              const mid = Math.min(y1 + (y2 - y1) / 2 + edge.bus, y2 - 16);
              const d = `M ${from.x + edge.offset} ${y1} V ${mid} H ${to.x} V ${y2}`;
              return <path key={`${edge.from}-${edge.to}`} d={d} className="edge" />;
            })}
          </g>
          <g className="cross-links">
            {layout.crossLinks.map((link) => {
              const parent = layout.personById.get(link.fromId);
              const child = layout.personById.get(link.toId);
              if (!parent || !child) return null;
              return (
                <path
                  key={`${link.kind}-${link.fromId}-${link.toId}`}
                  d={crossPath(link)}
                  className={`edge-cross is-${link.kind}`}
                  onClick={() => handleSelect(link.toId)}
                >
                  <title>{`${shortName(parent)} — ${shortName(child)} : ${CROSS_LABELS[link.kind]}`}</title>
                </path>
              );
            })}
          </g>
          <g className="units">{layout.units.map(renderUnit)}</g>
        </g>
      </svg>

      {(branches.length > 0 || me) && (
        <div className="canvas-branches">
          <button
            type="button"
            className="branch-chip me-chip"
            onClick={() => {
              if (!me) return;
              onSelect(me.id);
              focusPerson(me.id);
            }}
            disabled={!me}
            title={
              me
                ? `Revenir sur ${shortName(me)}, la personne que vous êtes dans l’arbre`
                : 'Qui êtes-vous ? Le menu d’une personne — « C’est moi » — ou les Réglages le disent'
            }
          >
            <span className="branch-dot" />
            Me recentrer
          </button>
          {branches.map((branch) => {
            const root = branch.rootPersonId ? layout.personById.get(branch.rootPersonId) : null;
            const note = root
              ? `${branch.personCount} personne${branch.personCount > 1 ? 's' : ''} rangée${branch.personCount > 1 ? 's' : ''} · part de ${shortName(root)}`
              : `${branch.name} n’a encore personne dont partir`;
            return (
              <button
                key={branch.id}
                type="button"
                className="branch-chip"
                style={{ '--branch': branch.color } as CSSProperties}
                onClick={() => {
                  if (!branch.rootPersonId) return;
                  onSelect(branch.rootPersonId);
                  focusPerson(branch.rootPersonId);
                }}
                disabled={!branch.rootPersonId}
                title={note}
              >
                <span className="branch-dot" />
                {branch.name}
                <span className="branch-count">{branch.personCount}</span>
              </button>
            );
          })}
        </div>
      )}

      {layout.crossLinks.length > 0 && (
        <div className="canvas-legend">
          <svg width="24" height="6" aria-hidden="true">
            <line x1="1" y1="3" x2="23" y2="3" className="edge-cross" />
          </svg>
          <span>
            {layout.crossLinks.length} lien
            {layout.crossLinks.length > 1 ? 's' : ''} en pointillés :{' '}
            {kindsOf(layout.crossLinks)
              .map((kind) => CROSS_LABELS[kind])
              .join(', ')}
            .
          </span>
        </div>
      )}

      <div className="canvas-controls">
        <button type="button" onClick={() => zoomBy(1.25)} aria-label="Agrandir">
          +
        </button>
        <button type="button" onClick={() => zoomBy(0.8)} aria-label="Réduire">
          −
        </button>
        <button type="button" onClick={fit} aria-label="Tout afficher" className="fit">
          ⤢
        </button>
      </div>
    </div>
  );
});

export default TreeCanvas;
