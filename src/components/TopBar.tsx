import { useEffect, useState, type RefObject } from 'react';
import { personLabel } from '../domain/types';
import type { Person } from '../domain/types';
import {
  GROUPING_HINTS,
  GROUPING_LABELS,
  GROUPING_MODES,
  type GroupingMode,
} from '../layout/grouping';
import { VIEW_LABELS, VIEW_MODES, type TreeViewMode } from '../layout/views';

interface TopBarProps {
  familyName: string;
  userEmail: string | null;
  personCount: number;
  unionCount: number;
  mediaCount: number;
  search: string;
  onSearchChange: (value: string) => void;
  searchResults: Person[];
  personContext: (person: Person) => string;
  onChooseSearchResult: (person: Person) => void;
  searchInputRef: RefObject<HTMLInputElement | null>;
  viewMode: TreeViewMode;
  onViewModeChange: (mode: TreeViewMode) => void;
  grouping: GroupingMode;
  onGroupingChange: (mode: GroupingMode) => void;
  canRecenter: boolean;
  onRecenter: () => void;
  onOpenShare: () => void;
  onAddPerson: () => void;
  onOpenMedia: () => void;
  onOpenRelationship: () => void;
  onOpenSettings: () => void;
  onOpenDirectory: () => void;
  onImport: () => void;
  onExport: () => void;
  onGedcom: () => void;
  onFit: () => void;
  onPrint: () => void;
  onReset: () => void;
  onOpenCloud: () => void;
  onSignOut: () => void;
}

export default function TopBar({
  familyName,
  userEmail,
  personCount,
  unionCount,
  mediaCount,
  search,
  onSearchChange,
  searchResults,
  personContext,
  onChooseSearchResult,
  searchInputRef,
  viewMode,
  onViewModeChange,
  grouping,
  onGroupingChange,
  canRecenter,
  onRecenter,
  onOpenShare,
  onAddPerson,
  onOpenMedia,
  onOpenRelationship,
  onOpenSettings,
  onOpenDirectory,
  onImport,
  onExport,
  onGedcom,
  onFit,
  onPrint,
  onReset,
  onOpenCloud,
  onSignOut,
}: TopBarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const canReset = personCount > 0 || unionCount > 0;
  const canExport = personCount > 0;

  useEffect(() => {
    if (!menuOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [menuOpen]);

  const run = (action: () => void) => {
    setMenuOpen(false);
    action();
  };

  return (
    <header className="topbar">
      <div className="topbar-primary">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <div>
            <h1>Arbre généalogique</h1>
            <p>{familyName} · Vue globale</p>
          </div>
        </div>

        <div className="topbar-center">
          <div className="search-box">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="10.5" cy="10.5" r="6.5" />
              <path d="m15.5 15.5 4 4" />
            </svg>
            <input
              ref={searchInputRef}
              value={search}
              placeholder="Rechercher une personne…"
              aria-label="Rechercher une personne dans l’arbre"
              onChange={(event) => {
                onSearchChange(event.target.value);
                setSearchOpen(true);
              }}
              onFocus={() => setSearchOpen(true)}
              onBlur={() => window.setTimeout(() => setSearchOpen(false), 150)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && searchResults.length > 0) {
                  event.preventDefault();
                  onChooseSearchResult(searchResults[0]);
                }
                if (event.key === 'Escape') {
                  onSearchChange('');
                  setSearchOpen(false);
                  searchInputRef.current?.blur();
                }
              }}
            />
            {search && (
              <button
                type="button"
                className="search-clear"
                aria-label="Effacer la recherche"
                onClick={() => {
                  onSearchChange('');
                  setSearchOpen(false);
                  searchInputRef.current?.focus();
                }}
              >
                ×
              </button>
            )}
            {searchOpen && search.trim() !== '' && (
              <div className="search-results">
                {searchResults.length === 0 ? (
                  <p className="search-empty">Aucune personne trouvée.</p>
                ) : (
                  <>
                    <p className="search-help">
                      Entrée recentre sur le premier résultat.
                    </p>
                    {searchResults.map((result) => (
                      <button
                        key={result.id}
                        type="button"
                        className="search-result"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => {
                          setSearchOpen(false);
                          onChooseSearchResult(result);
                        }}
                      >
                        <strong>{personLabel(result)}</strong>
                        <span>{personContext(result)}</span>
                      </button>
                    ))}
                  </>
                )}
              </div>
            )}
          </div>

          <label className="grouping-control topbar-view" title="Vue de l’arbre">
            <span>Vue</span>
            <select
              value={viewMode}
              onChange={(event) =>
                onViewModeChange(event.target.value as TreeViewMode)
              }
              aria-label="Mode de vue de l’arbre"
            >
              {VIEW_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {VIEW_LABELS[mode]}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="topbar-actions">
          {canRecenter && (
            <button
              type="button"
              className="btn btn-secondary topbar-recenter"
              onClick={onRecenter}
              title="Me recentrer sur mon marqueur"
            >
              Me recentrer
            </button>
          )}
          <button
            type="button"
            className="icon-button share-toggle"
            aria-label="Partager et exporter l’arbre"
            title="Partager et exporter"
            onClick={onOpenShare}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="18" cy="5" r="2.5" />
              <circle cx="6" cy="12" r="2.5" />
              <circle cx="18" cy="19" r="2.5" />
              <path d="M8.2 10.8 15.8 6.2M8.2 13.2l7.6 4.6" />
            </svg>
          </button>
          <button
            type="button"
            className="btn btn-primary topbar-add"
            onClick={onAddPerson}
          >
            + Nouvelle personne
          </button>
          <button
            type="button"
            className="icon-button menu-toggle"
            aria-label="Ouvrir le menu de l’arbre"
            aria-expanded={menuOpen}
            aria-controls="tree-tools-drawer"
            onClick={() => setMenuOpen((open) => !open)}
          >
            <span aria-hidden="true">•••</span>
          </button>
        </div>
      </div>

      {menuOpen && (
        <div
          className="drawer-backdrop"
          onClick={() => setMenuOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside
        id="tree-tools-drawer"
        className={`header-drawer${menuOpen ? ' is-open' : ''}`}
        aria-hidden={!menuOpen}
        aria-label="Outils de l’arbre"
      >
        <div className="drawer-head">
          <div>
            <h2>Outils de l’arbre</h2>
            <p>
              {familyName} · {personCount} personne{personCount > 1 ? 's' : ''}
            </p>
            {userEmail && <p className="drawer-account">{userEmail}</p>}
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="Fermer le menu"
            onClick={() => setMenuOpen(false)}
          >
            ×
          </button>
        </div>

        <div className="drawer-groups">
          <section className="drawer-group">
            <h3>Affichage</h3>
            <label className="drawer-field">
              <span>Vue</span>
              <select
                value={viewMode}
                onChange={(event) =>
                  onViewModeChange(event.target.value as TreeViewMode)
                }
              >
                {VIEW_MODES.map((mode) => (
                  <option key={mode} value={mode}>
                    {VIEW_LABELS[mode]}
                  </option>
                ))}
              </select>
            </label>
            {viewMode === 'classic' && (
              <label className="drawer-field" title={GROUPING_HINTS[grouping]}>
                <span>Proximité</span>
                <select
                  value={grouping}
                  onChange={(event) =>
                    onGroupingChange(event.target.value as GroupingMode)
                  }
                >
                  {GROUPING_MODES.map((mode) => (
                    <option key={mode} value={mode}>
                      {GROUPING_LABELS[mode]}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <button type="button" className="drawer-item" onClick={() => run(onOpenRelationship)}>
              Lien de parenté
            </button>
            <button type="button" className="drawer-item" onClick={() => run(onFit)}>
              Ajuster la vue
            </button>
            {canRecenter && (
              <button type="button" className="drawer-item" onClick={() => run(onRecenter)}>
                Me recentrer
              </button>
            )}
          </section>

          <section className="drawer-group">
            <h3>Données</h3>
            <button type="button" className="drawer-item" onClick={() => run(onImport)}>
              Importer un arbre JSON
            </button>
            <button
              type="button"
              className="drawer-item"
              disabled={!canExport}
              onClick={() => run(onExport)}
            >
              Exporter en JSON
            </button>
            <button
              type="button"
              className="drawer-item"
              disabled={!canExport}
              onClick={() => run(onGedcom)}
            >
              Exporter en GEDCOM
            </button>
            <button type="button" className="drawer-item" onClick={() => run(onOpenSettings)}>
              Réglages
            </button>
            <button
              type="button"
              className="drawer-item drawer-item-danger"
              disabled={!canReset}
              onClick={() => run(onReset)}
            >
              Réinitialiser l’arbre
            </button>
          </section>

          <section className="drawer-group">
            <h3>Partage</h3>
            <button type="button" className="drawer-item" onClick={() => run(onOpenMedia)}>
              Photos et documents {mediaCount > 0 && `(${mediaCount})`}
            </button>
            <button type="button" className="drawer-item" onClick={() => run(onOpenDirectory)}>
              Lieux et sources
            </button>
            <button type="button" className="drawer-item" onClick={() => run(onPrint)}>
              Imprimer
            </button>
          </section>

          <section className="drawer-group">
            <h3>Compte</h3>
            <button type="button" className="drawer-item" onClick={() => run(onOpenCloud)}>
              {userEmail ? 'Changer d’arbre' : 'Se connecter'}
            </button>
            {userEmail && (
              <button
                type="button"
                className="drawer-item drawer-item-danger"
                onClick={() => run(onSignOut)}
              >
                Se déconnecter
              </button>
            )}
          </section>
        </div>
      </aside>
    </header>
  );
}
