import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { CARD_GAP, CARD_H, CARD_W, type LayoutResult, type Unit } from './treeLayout';
import { lifeSpan, shortName, truncate } from './dates';
import type { Person } from '../shared/types';

interface Props {
  layout: LayoutResult;
  selectedId: string | null;
  onSelect: (personId: string) => void;
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

function Card({
  person,
  x,
  y,
  selected,
  onSelect,
}: {
  person: Person;
  x: number;
  y: number;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <g
      className={`card${selected ? ' is-selected' : ''}`}
      transform={`translate(${x} ${y})`}
      onClick={onSelect}
      role="button"
    >
      <rect width={CARD_W} height={CARD_H} rx={10} className="card-box" />
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
  { layout, selectedId, onSelect },
  ref,
) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 });
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, vx: 0, vy: 0, moved: false });
  const fitted = useRef<string>('');

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

  // L'ouverture de la fiche réduit le canevas : sans recadrage, l'arbre se retrouve tronqué.
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

    if (unit.personIds.length === 1) {
      const person = layout.personById.get(unit.personIds[0]);
      if (!person) return null;
      return (
        <Card
          key={unit.key}
          person={person}
          x={x0}
          y={unit.y}
          selected={selectedId === person.id}
          onSelect={() => handleSelect(person.id)}
        />
      );
    }

    const a = layout.personById.get(unit.personIds[0]);
    const b = layout.personById.get(unit.personIds[1]);
    if (!a || !b) return null;

    return (
      <g key={unit.key}>
        <Card
          person={a}
          x={x0}
          y={unit.y}
          selected={selectedId === a.id}
          onSelect={() => handleSelect(a.id)}
        />
        <Card
          person={b}
          x={x0 + CARD_W + CARD_GAP}
          y={unit.y}
          selected={selectedId === b.id}
          onSelect={() => handleSelect(b.id)}
        />
        <line
          className="couple-link"
          x1={x0 + CARD_W}
          y1={unit.y + CARD_H / 2}
          x2={x0 + CARD_W + CARD_GAP}
          y2={unit.y + CARD_H / 2}
        />
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
              const mid = y1 + (y2 - y1) / 2;
              const d = `M ${from.x} ${y1} V ${mid} H ${to.x} V ${y2}`;
              return <path key={`${edge.from}-${edge.to}`} d={d} className="edge" />;
            })}
          </g>
          <g className="units">{layout.units.map(renderUnit)}</g>
        </g>
      </svg>

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
