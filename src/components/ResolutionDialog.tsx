import { useEffect } from 'react';

export interface ResolutionOption {
  value: string;
  label: string;
  description: string;
  recommended?: boolean;
  disabled?: boolean;
}

interface ResolutionDialogProps {
  title: string;
  subtitle?: string;
  description: string;
  options: ResolutionOption[];
  onChoose: (value: string) => void;
  onCancel: () => void;
}

/**
 * Boîte de décision générique : un doublon de filiation n'est JAMAIS résolu
 * automatiquement. Les trois issues possibles (compléter l'union, famille
 * recomposée, adoption/lien légal) sont toujours présentées explicitement.
 */
export default function ResolutionDialog({
  title,
  subtitle,
  description,
  options,
  onChoose,
  onCancel,
}: ResolutionDialogProps) {
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onCancel]);

  return (
    <div className="modal-overlay" onMouseDown={onCancel}>
      <div
        className="modal resolution-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <span className="resolution-eyebrow">Lien à préciser</span>
          <h2>{title}</h2>
          {subtitle && <p className="modal-context">{subtitle}</p>}
        </div>

        <p className="modal-hint">{description}</p>

        <div className="resolution-options">
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`resolution-option${option.recommended ? ' is-recommended' : ''}`}
              disabled={option.disabled}
              onClick={() => onChoose(option.value)}
            >
              <span className="resolution-option-head">
                <strong>{option.label}</strong>
                {option.recommended && (
                  <span className="recommended-badge">Recommandé</span>
                )}
              </span>
              <span className="resolution-option-desc">
                {option.description}
              </span>
            </button>
          ))}
        </div>

        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            Annuler (ne rien changer)
          </button>
        </div>
      </div>
    </div>
  );
}
