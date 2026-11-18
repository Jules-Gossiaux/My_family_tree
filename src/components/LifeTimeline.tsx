import type { Id } from '../domain/types';
import { buildTimeline, type TimelineEntry } from '../domain/timeline';

interface LifeTimelineProps {
  data: Parameters<typeof buildTimeline>[0];
  personId: Id;
  onOpenEvent?: (eventId: Id) => void;
}

const TYPE_SYMBOLS: Partial<Record<TimelineEntry['type'], string>> = {
  birth: '✦',
  death: '✝',
  marriage: '◇',
  divorce: '◇',
  union: '◇',
  burial: '⚑',
  baptism: '✦',
  other: '•',
};

export default function LifeTimeline({ data, personId, onOpenEvent }: LifeTimelineProps) {
  const entries = buildTimeline(data, personId);
  if (entries.length === 0) {
    return (
      <p className="panel-note">
        Aucun fait daté. Ajoutez un fait de vie ou une union pour alimenter la frise.
      </p>
    );
  }

  return (
    <ol className="life-timeline">
      {entries.map((entry, index) => {
        const previous = entries[index - 1];
        const showYear = entry.year !== previous?.year;
        return (
          <li key={entry.key} className={`timeline-entry${entry.eventId ? ' is-clickable' : ''}`}>
            {showYear && (
              <span className="timeline-year">
                {entry.year !== undefined ? entry.year : 'Sans date'}
              </span>
            )}
            <span className="timeline-marker">{TYPE_SYMBOLS[entry.type] ?? '•'}</span>
            <div className="timeline-body">
              <strong>
                {entry.eventId ? (
                  <button type="button" onClick={() => onOpenEvent?.(entry.eventId!)}>
                    {entry.title}
                  </button>
                ) : (
                  entry.title
                )}
              </strong>
              {entry.yearLabel && <span className="timeline-date">{entry.yearLabel}</span>}
              {entry.detail && <span className="timeline-detail">{entry.detail}</span>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
