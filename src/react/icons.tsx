import type { ReactElement } from 'react';

const base = {
  width: 16,
  height: 16,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
} as const;

export const UndoIcon = (): ReactElement => (
  <svg {...base}>
    <path d="M6 3.5 3 6.5l3 3" />
    <path d="M3 6.5h6.5a3.5 3.5 0 0 1 0 7H7" />
  </svg>
);

export const RedoIcon = (): ReactElement => (
  <svg {...base}>
    <path d="m10 3.5 3 3-3 3" />
    <path d="M13 6.5H6.5a3.5 3.5 0 0 0 0 7H9" />
  </svg>
);

export const PlusIcon = (): ReactElement => (
  <svg {...base}>
    <path d="M8 3.5v9M3.5 8h9" />
  </svg>
);

export const MoreIcon = (): ReactElement => (
  <svg {...base} fill="currentColor" stroke="none">
    <circle cx="3.5" cy="8" r="1.25" />
    <circle cx="8" cy="8" r="1.25" />
    <circle cx="12.5" cy="8" r="1.25" />
  </svg>
);

export const PencilIcon = (): ReactElement => (
  <svg {...base}>
    <path d="m10.5 3 2.5 2.5-7.5 7.5H3v-2.5L10.5 3Z" />
  </svg>
);

export const CheckIcon = (): ReactElement => (
  <svg {...base} strokeWidth={2}>
    <path d="m3.5 8.5 3 3 6-7" />
  </svg>
);

export const LockIcon = (): ReactElement => (
  <svg {...base}>
    <rect x="3.5" y="7" width="9" height="6" rx="1.5" />
    <path d="M5.5 7V5.5a2.5 2.5 0 0 1 5 0V7" />
  </svg>
);
