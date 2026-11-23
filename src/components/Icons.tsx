import React from 'react';

interface IconProps {
  className?: string;
}

export const HeadstoneIcon: React.FC<IconProps> = ({ className = 'w-5 h-5' }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="square"
    strokeLinejoin="miter"
    className={className}
    aria-hidden="true"
  >
    <path d="M6 20V10a6 6 0 0 1 12 0v10" />
    <line x1="3.5" y1="20" x2="20.5" y2="20" />
    <line x1="9.5" y1="10.5" x2="14.5" y2="10.5" />
    <line x1="12" y1="8" x2="12" y2="15" />
  </svg>
);

export const BookmarkRibbonIcon: React.FC<IconProps> = ({ className = 'w-4 h-4' }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="square"
    strokeLinejoin="miter"
    className={className}
    aria-hidden="true"
  >
    <path d="M6 3h12v18l-6-4-6 4V3z" />
    <line x1="9.5" y1="8" x2="14.5" y2="8" />
  </svg>
);

export const ArchiveDrawerIcon: React.FC<IconProps> = ({ className = 'w-4 h-4' }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="square"
    strokeLinejoin="miter"
    className={className}
    aria-hidden="true"
  >
    <rect x="3" y="4" width="18" height="5" />
    <path d="M4.5 9v11h15V9" />
    <line x1="9.5" y1="14" x2="14.5" y2="14" />
  </svg>
);
