import type { MouseEvent as ReactMouseEvent } from 'react';
import type { Person, PortraitCrop } from '../domain/types';
import type { LaidOutNode } from '../layout/layout';
import { formatDates, initials, truncate } from '../utils/format';

export interface CardPortrait {
  url: string;
  crop: PortraitCrop;
}

interface PersonCardProps {
  node: LaidOutNode;
  person: Person;
  selected: boolean;
  highlighted?: boolean;
  matched?: boolean;
  portrait?: CardPortrait;
  isMe?: boolean;
  branchColor?: string;
  branchLabel?: string;
  onSelect: (id: string) => void;
  onContextMenu?: (event: ReactMouseEvent, id: string) => void;
}

export default function PersonCard({
  node,
  person,
  selected,
  highlighted = false,
  matched = false,
  portrait,
  isMe = false,
  branchColor,
  branchLabel,
  onSelect,
  onContextMenu,
}: PersonCardProps) {
  const label = truncate(
    `${person.firstName} ${person.lastName}`.trim() || 'Sans nom',
    20,
  );
  const centerY = node.height / 2;
  const clipId = `portrait-${person.id.replace(/[^a-zA-Z0-9-]/g, '')}`;
  const zoom = portrait?.crop.zoom ?? 1;
  const size = 40 * zoom;
  const imageX = 36 - (portrait?.crop.x ?? 0.5) * size;
  const imageY = centerY - (portrait?.crop.y ?? 0.5) * size;

  return (
    <g
      data-person-card
      className={`person-card${selected ? ' is-selected' : ''}${
        highlighted ? ' is-highlight' : ''
      }${matched ? ' is-match' : ''}${isMe ? ' is-me' : ''}`}
      transform={`translate(${node.x} ${node.y})`}
      onClick={(event) => {
        event.stopPropagation();
        onSelect(person.id);
      }}
      onContextMenu={(event) => onContextMenu?.(event, person.id)}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect(person.id);
        }
      }}
    >
      <title>{`${`${person.firstName} ${person.lastName}`.trim() || 'Sans nom'}${branchLabel ? ` · ${branchLabel}` : ''}${isMe ? ' · Moi' : ''}`}</title>
      <rect
        className="person-card-bg"
        width={node.width}
        height={node.height}
        rx={12}
      />
      {branchColor && (
        <rect
          className="person-branch-stripe"
          width={5}
          height={node.height}
          rx={2.5}
          fill={branchColor}
        />
      )}
      {isMe && (
        <g className="person-me-marker" aria-label="Moi">
          <circle cx={node.width - 16} cy={16} r={11} />
          <text x={node.width - 16} y={17} textAnchor="middle" dominantBaseline="central">
            M
          </text>
        </g>
      )}
      <circle className="person-avatar" cx={36} cy={centerY} r={20} />
      <text
        className="person-initials"
        x={36}
        y={centerY + 1}
        textAnchor="middle"
        dominantBaseline="central"
      >
        {initials(person)}
      </text>
      {portrait && (
        <>
          <defs>
            <clipPath id={clipId}>
              <circle cx={36} cy={centerY} r={20} />
            </clipPath>
          </defs>
          <image
            href={portrait.url}
            x={imageX}
            y={imageY}
            width={size}
            height={size}
            preserveAspectRatio="xMidYMid slice"
            clipPath={`url(#${clipId})`}
            pointerEvents="none"
          />
        </>
      )}
      <text className="person-name" x={68} y={33}>
        {label}
      </text>
      <text className="person-dates" x={68} y={55}>
        {truncate(formatDates(person), 22)}
      </text>
    </g>
  );
}
