export type ArchiveSection =
  | '3 AM Curiosity'
  | 'Reference & Study'
  | 'Useful Someday'
  | 'Ready to Close';

export type RecommendationVerdict =
  | 'Read Today'
  | 'File in Archive'
  | 'Close Forever';

export interface TriagedTab {
  id: string;
  url: string;
  title: string;
  domain: string;
  section: ArchiveSection;
  epitaphSummary: string;
  recommendation: RecommendationVerdict;
  recommendationReason: string;
  readTimeMinutes: number;
  addedAt: number;
}

export type FilterTab = 'All' | ArchiveSection;

export const ARCHIVE_SECTIONS: ArchiveSection[] = [
  '3 AM Curiosity',
  'Reference & Study',
  'Useful Someday',
  'Ready to Close',
];

export const FILTER_TABS: FilterTab[] = [
  'All',
  '3 AM Curiosity',
  'Reference & Study',
  'Useful Someday',
  'Ready to Close',
];
