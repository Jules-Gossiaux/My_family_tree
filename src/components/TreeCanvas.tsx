import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { Id, Person } from '../domain/types';
import { branchColorOf, branchLabelsOf, type ViewSettings } from '../domain/settings';
import { roundedPath, type TreeLayout } from '../layout/layout';
import PersonCard, { type CardPortrait } from './PersonCard';
import type { AddKind } from './PersonFormDialog';

export interface FocusRequest {
  id: Id;
  token: number;
}

interface TreeCanvasProps {
  layout: TreeLayout;
  persons: Map<Id, Person>;
  selectedId: Id | null;
  fitSignal: number;
  focusRequest?: FocusRequest | null;
  matchedIds?: Set<Id>;
  portraits?: Map<Id, CardPortrait>;
  settings?: ViewSettings;
  onSelect: (id: Id | null) => void;
  onAdd: (kind: AddKind) => void;
  onDelete: (id: Id) => void;
  onSetMe: (id: Id) => void;
  onSetReference: (id: Id) => void;
  onStartBranch: (id: Id) => void;
  onAttachExisting: () => void;
  onOpenRelationship: (id: Id) => void;
  onOrderMove: (id: Id, direction: 'left' | 'right') => void;
  onResetOrder: () => void;
  hasManualOrder: boolean;
  onAddFirst: () => void;
  onImport: () => void;
}

interface ViewState {
  x: number;
  y: number;
  k: number;
}

const MIN_ZOOM = 0.12;
const MAX_ZOOM = 2.5;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

type QuickIconName = 'parent' | 'sibling' | 'child' | 'spouse' | 'delete';

/** Icônes fines de la barre d'actions, dans le style de la maquette. */
function QuickIcon({ name }: { name: QuickIconName }) {
  const common = {
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.6,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      {name === 'parent' && (
        <g {...common}>
          <path d="M12 20V5" />
          <path d="M6 11l6-6 6 6" />
        </g>
      )}
      {name === 'sibling' && (
        <g {...common}>
          <circle cx="7" cy="7" r="2.6" />
          <circle cx="17" cy="7" r="2.6" />
          <path d="M7 10v3h10v-3M12 13v7" />
        </g>
      )}
      {name === 'child' && (
        <g {...common}>
          <path d="M12 4v15" />
          <path d="M6 13l6 6 6-6" />
        </g>
      )}
      {name === 'spouse' && (
        <g {...common}>
          <path d="M12 20s-7-4.4-7-9.2A4 4 0 0 1 12 8a4 4 0 0 1 7 2.8C19 15.6 12 20 12 20Z" />
        </g>
      )}
      {name === 'delete' && (
        <g {...common}>
          <path d="M5 7h14M9 7V5h6v2M7 7l1 13h8l1-13M10 11v5M14 11v5" />
        </g>
      )}
    </svg>
  );
}

export default function TreeCanvas({
  layout,
  persons,
  selectedId,
  fitSignal,
  focusRequest,
  matchedIds,
  portraits,
  settings,
  onSelect,
  onAdd,
  onDelete,
  onSetMe,
  onSetReference,
  onStartBranch,
  onAttachExisting,
  onOpenRelationship,
  onOrderMove,
  onResetOrder,
  hasManualOrder,
  onAddFirst,
  onImport,
}: TreeCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const contentRef = useRef<SVGGElement>(null);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const [size, setSize] = useState({ width: 0, height: 0 });
  const sizeRef = useRef(size);
  sizeRef.current = size;

  const [view, setView] = useState<ViewState>({ x: 0, y: 0, k: 1 });
  const viewRef = useRef(view);
  viewRef.current = view;

  const [dragging, setDragging] = useState(false);
  const dragStart = useRef<{
    clientX: number;
    clientY: number;
    viewX: number;
    viewY: number;
  } | null>(null);

  const [contextMenu, setContextMenu] = useState<{
    personId: Id;
    x: number;
    y: number;
  } | null>(null);
  // L'impression doit être synchronisée avant que le navigateur ne figxe la
  // page : on modifie donc directement les attributs SVG, sans attendre React.
  useEffect(() => {
    let originalTransform: string | null = null;
    const enter = () => {
      const current = layoutRef.current;
      originalTransform = contentRef.current?.getAttribute('transform') ?? null;
      if (current.width > 0 && current.height > 0) {
        svgRef.current?.setAttribute(
          'viewBox',
          `0 0 ${current.width} ${current.height}`,
        );
      }
      contentRef.current?.removeAttribute('transform');
      svgRef.current?.classList.add('is-printing');
    };
    const leave = () => {
      svgRef.current?.removeAttribute('viewBox');
      if (originalTransform !== null) {
        contentRef.current?.setAttribute('transform', originalTransform);
      }
      svgRef.current?.classList.remove('is-printing');
    };
    window.addEventListener('beforeprint', enter);
    window.addEventListener('afterprint', leave);
    return () => {
      window.removeEventListener('beforeprint', enter);
      window.removeEventListener('afterprint', leave);
    };
  }, []);

  const fittedRef = useRef(false);
  const lastFitSignal = useRef(fitSignal);
  const lastFocusToken = useRef(0);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) setSize({ width: rect.width, height: rect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const fit = useCallback(() => {
    const { width, height } = sizeRef.current;
    if (width === 0 || height === 0) return;
    if (layout.width === 0 || layout.height === 0) {
      setView({ x: 0, y: 0, k: 1 });
      return;
    }
    const scale = clamp(
      Math.min(
        (width - 96) / layout.width,
        (height - 96) / layout.height,
      ),
      MIN_ZOOM,
      1.2,
    );
    setView({
      k: scale,
      x: (width - layout.width * scale) / 2,
      y: (height - layout.height * scale) / 2,
    });
  }, [layout.width, layout.height]);

  useEffect(() => {
    if (layout.nodes.length > 0 && !fittedRef.current) {
      fit();
      fittedRef.current = true;
    }
  }, [layout, fit]);

  useEffect(() => {
    if (fitSignal !== lastFitSignal.current) {
      lastFitSignal.current = fitSignal;
      fit();
    }
  }, [fitSignal, fit]);

  // Une recherche centre la vue sur la personne trouvée, sans changer le
  // zoom si l'utilisateur est déjà suffisamment proche.
  useEffect(() => {
    if (!focusRequest || focusRequest.token === lastFocusToken.current) return;
    const node = layout.nodes.find(
      (candidate) =>
        candidate.kind === 'person' && candidate.refId === focusRequest.id,
    );
    const { width, height } = sizeRef.current;
    if (!node || width === 0 || height === 0) return;
    lastFocusToken.current = focusRequest.token;
    const k = clamp(Math.max(viewRef.current.k, 0.85), MIN_ZOOM, 1.4);
    setView({
      k,
      x: width / 2 - (node.x + node.width / 2) * k,
      y: height / 2 - (node.y + node.height / 2) * k,
    });
  }, [focusRequest, layout]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      const cursorX = event.clientX - rect.left;
      const cursorY = event.clientY - rect.top;
      setView((previous) => {
        const k = clamp(
          previous.k * Math.exp(-event.deltaY * 0.0012),
          MIN_ZOOM,
          MAX_ZOOM,
        );
        const ratio = k / previous.k;
        return {
          k,
          x: cursorX - (cursorX - previous.x) * ratio,
          y: cursorY - (cursorY - previous.y) * ratio,
        };
      });
    };
    element.addEventListener('wheel', handleWheel, { passive: false });
    return () => element.removeEventListener('wheel', handleWheel);
  }, []);

  const zoomBy = (factor: number) => {
    const { width, height } = sizeRef.current;
    const centerX = width / 2;
    const centerY = height / 2;
    setView((previous) => {
      const k = clamp(previous.k * factor, MIN_ZOOM, MAX_ZOOM);
      const ratio = k / previous.k;
      return {
        k,
        x: centerX - (centerX - previous.x) * ratio,
        y: centerY - (centerY - previous.y) * ratio,
      };
    });
  };

  const handlePointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    if ((event.target as Element).closest('[data-person-card]')) return;
    dragStart.current = {
      clientX: event.clientX,
      clientY: event.clientY,
      viewX: viewRef.current.x,
      viewY: viewRef.current.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
    onSelect(null);
  };

  const handlePointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const start = dragStart.current;
    if (!start) return;
    setView((previous) => ({
      ...previous,
      x: start.viewX + event.clientX - start.clientX,
      y: start.viewY + event.clientY - start.clientY,
    }));
  };

  const handlePointerUp = (event: ReactPointerEvent<SVGSVGElement>) => {
    dragStart.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const personNodes = useMemo(
    () => layout.nodes.filter((node) => node.kind === 'person'),
    [layout],
  );

  const unionNodes = useMemo(
    () => layout.nodes.filter((node) => node.kind === 'union'),
    [layout],
  );

  const selectedNode = useMemo(
    () =>
      personNodes.find((node) => node.refId === selectedId) ?? null,
    [personNodes, selectedId],
  );

  const toolbarLeft = selectedNode
    ? clamp(
        view.x + (selectedNode.x + selectedNode.width / 2) * view.k,
        200,
        Math.max(200, size.width - 200),
      )
    : 0;
  const aboveTop = selectedNode
    ? view.y + selectedNode.y * view.k - 14
    : 0;
  // Le canvas coupe ce qui dépasse : si la carte est trop haute, la barre
  // passe dessous plutôt que de voir ses icônes tronquées.
  const placeBelow = aboveTop < 58;
  const toolbarTop = selectedNode
    ? placeBelow
      ? view.y + (selectedNode.y + selectedNode.height) * view.k + 14
      : aboveTop
    : 0;

  return (
    <div className="canvas" ref={containerRef} onClick={() => setContextMenu(null)}>
      <svg
        ref={svgRef}
        className={`tree-svg${dragging ? ' is-dragging' : ''}`}
        preserveAspectRatio="xMidYMid meet"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <g ref={contentRef} transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          {layout.edges.map((edge) => (
            <path
              key={edge.id}
              className={[
                'tree-edge',
                `edge-${edge.kind}`,
                edge.link ? `link-${edge.link}` : '',
                edge.former ? 'is-former' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              d={roundedPath(edge.points)}
            >
              {edge.title && <title>{edge.title}</title>}
            </path>
          ))}
          {unionNodes.map((node) => (
            <g
              key={node.key}
              className={`union-node${node.former ? ' is-former' : ''}`}
              transform={`translate(${node.x + node.width / 2} ${
                node.y + node.height / 2
              })`}
            >
              <circle r={node.width / 2} />
              <circle className="union-core" r="3" />
              {node.title && <title>{node.title}</title>}
            </g>
          ))}
          {personNodes.map((node) => {
            const person = persons.get(node.refId);
            if (!person) return null;
            return (
              <PersonCard
                key={node.key}
                node={node}
                person={person}
                selected={selectedId === person.id}
                matched={matchedIds?.has(person.id) ?? false}
                portrait={portraits?.get(person.id)}
                isMe={settings?.meId === person.id}
                branchColor={settings ? branchColorOf(settings, person.id) : undefined}
                branchLabel={settings ? branchLabelsOf(settings, person.id) : undefined}
                onSelect={onSelect}
                onContextMenu={(event, id) => {
                  event.preventDefault();
                  event.stopPropagation();
                  const rect = containerRef.current?.getBoundingClientRect();
                  onSelect(id);
                  setContextMenu({
                    personId: id,
                    x: event.clientX - (rect?.left ?? 0),
                    y: event.clientY - (rect?.top ?? 0),
                  });
                }}
              />
            );
          })}
        </g>
      </svg>

      {selectedNode && (
        <div
          className={`quick-toolbar${placeBelow ? ' is-below' : ''}`}
          style={{ left: toolbarLeft, top: toolbarTop }}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          role="toolbar"
          aria-label={`Actions pour ${persons.get(selectedNode.refId)?.firstName ?? 'cette personne'}`}
        >
          {(
            [
              { kind: 'parent', label: 'Parents', icon: 'parent' },
              { kind: 'sibling', label: 'Frère / Sœur', icon: 'sibling' },
              { kind: 'child', label: 'Enfant', icon: 'child' },
              { kind: 'spouse', label: 'Conjoint', icon: 'spouse' },
            ] as Array<{ kind: AddKind; label: string; icon: QuickIconName }>
          ).map((action) => (
            <button
              key={action.kind}
              type="button"
              className="quick-action"
              onClick={() => onAdd(action.kind)}
              title={`Ajouter : ${action.label.toLowerCase()}`}
            >
              <QuickIcon name={action.icon} />
              <span>{action.label}</span>
            </button>
          ))}
          <span className="quick-separator" aria-hidden="true" />
          <button
            type="button"
            className="quick-action"
            onClick={() => onOrderMove(selectedNode.refId, 'left')}
            title="Placer cette personne à gauche de son voisin"
          >
            <span className="quick-arrow" aria-hidden="true">←</span>
            <span>À gauche</span>
          </button>
          <button
            type="button"
            className="quick-action"
            onClick={() => onOrderMove(selectedNode.refId, 'right')}
            title="Placer cette personne à droite de son voisin"
          >
            <span className="quick-arrow" aria-hidden="true">→</span>
            <span>À droite</span>
          </button>
          <span className="quick-separator" aria-hidden="true" />
          <button
            type="button"
            className="quick-action quick-delete"
            onClick={() => onDelete(selectedNode.refId)}
            title="Supprimer cette personne (touche Suppr)"
          >
            <QuickIcon name="delete" />
          </button>
        </div>
      )}

      {contextMenu && (
        <div
          className="context-menu"
          style={{
            left: clamp(contextMenu.x, 8, Math.max(8, size.width - 224)),
            top: clamp(contextMenu.y, 8, Math.max(8, size.height - 300)),
          }}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="context-title">
            {persons.get(contextMenu.personId)
              ? `${persons.get(contextMenu.personId)!.firstName} ${persons.get(contextMenu.personId)!.lastName}`.trim()
              : 'Personne'}
          </div>
          <button
            type="button"
            onClick={() => {
              onSelect(contextMenu.personId);
              setContextMenu(null);
            }}
          >
            Ouvrir la fiche
          </button>
          <span className="context-separator" />
          {(
            [
              ['parent', '+ Parent'],
              ['sibling', '+ Frère / Sœur'],
              ['child', '+ Enfant'],
              ['spouse', '+ Conjoint'],
            ] as Array<[AddKind, string]>
          ).map(([kind, label]) => (
            <button
              key={kind}
              type="button"
              onClick={() => {
                onAdd(kind);
                setContextMenu(null);
              }}
            >
              {label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              onAttachExisting();
              setContextMenu(null);
            }}
            title="Relier une personne déjà dans l’arbre"
          >
            Rattacher une personne existante…
          </button>
          <span className="context-separator" />
          <button
            type="button"
            onClick={() => {
              onSetMe(contextMenu.personId);
              setContextMenu(null);
            }}
          >
            C’est moi
          </button>
          <button
            type="button"
            onClick={() => {
              onSetReference(contextMenu.personId);
              setContextMenu(null);
            }}
          >
            Personne de référence
          </button>
          <button
            type="button"
            onClick={() => {
              onStartBranch(contextMenu.personId);
              setContextMenu(null);
            }}
          >
            Créer une branche ici
          </button>
          <span className="context-separator" />
          <button
            type="button"
            onClick={() => {
              onOpenRelationship(contextMenu.personId);
              setContextMenu(null);
            }}
          >
            Calculer un lien de parenté…
          </button>
          <span className="context-separator" />
          <button
            type="button"
            className="context-danger"
            onClick={() => {
              onDelete(contextMenu.personId);
              setContextMenu(null);
            }}
          >
            Supprimer
          </button>
        </div>
      )}

      {layout.nodes.length === 0 && (
        <div className="empty-state">
          <div className="empty-illustration" aria-hidden="true">
            <span className="empty-node empty-node-top" />
            <span className="empty-link empty-link-v" />
            <span className="empty-link empty-link-h" />
            <span className="empty-node empty-node-left" />
            <span className="empty-node empty-node-right" />
          </div>
          <h2>Votre arbre est vide</h2>
          <p>
            Créez une première personne, puis ajoutez parents, fratrie, enfants
            et conjoints depuis sa fiche. Le placement se recalcule à chaque
            ajout.
          </p>
          <div className="empty-actions">
            <button type="button" className="btn btn-primary" onClick={onAddFirst}>
              Créer la première personne
            </button>
            <button type="button" className="btn btn-secondary" onClick={onImport}>
              Importer un fichier JSON
            </button>
          </div>
        </div>
      )}

      <div className="canvas-controls">
        {hasManualOrder && (
          <button
            type="button"
            className="reset-order-button"
            onClick={onResetOrder}
            title="Revenir au placement automatique"
          >
            Ordre auto
          </button>
        )}
        <button type="button" onClick={() => zoomBy(1.2)} aria-label="Zoomer">
          +
        </button>
        <span className="zoom-value">{Math.round(view.k * 100)} %</span>
        <button type="button" onClick={() => zoomBy(1 / 1.2)} aria-label="Dézoomer">
          −
        </button>
        <button type="button" className="fit-button" onClick={fit}>
          Ajuster
        </button>
      </div>

      <div className="canvas-hint">
        Vue d’ensemble · glisser pour déplacer · molette pour zoomer
      </div>
    </div>
  );
}
