import { ARCHIVE_SECTIONS, type ArchiveSection, type RecommendationVerdict, type TriagedTab } from '../types';
import { classifyTabsOffline, DUPLICATE_REASON } from './offlineClassifier';

const RECOMMENDATIONS = new Set<unknown>(['Read Today', 'File in Archive', 'Close Forever']);

type TriageResult = {
  items: TriagedTab[];
  mode: 'gemini' | 'offline' | 'local-fallback';
};

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.replace(/[\u2013\u2014]/g, ', ').trim() : '';
}

function applyAnnotations(items: TriagedTab[], annotations: unknown): TriagedTab[] | null {
  if (!Array.isArray(annotations) || annotations.length !== items.length) return null;
  const annotated = new Map<number, TriagedTab>();

  for (const annotation of annotations) {
    if (!annotation || !Number.isInteger(annotation.index)) return null;
    const index = annotation.index as number;
    if (index < 0 || index >= items.length || annotated.has(index)) return null;
    const item = items[index];
    if (item.recommendationReason === DUPLICATE_REASON) {
      annotated.set(index, item);
      continue;
    }
    const summary = cleanText(annotation.epitaphSummary);
    const reason = cleanText(annotation.recommendationReason);
    if (!ARCHIVE_SECTIONS.includes(annotation.section) || !RECOMMENDATIONS.has(annotation.recommendation)
      || !summary || !reason || !Number.isInteger(annotation.readTimeMinutes)) return null;

    annotated.set(index, {
      ...item,
      section: annotation.section as ArchiveSection,
      recommendation: annotation.recommendation as RecommendationVerdict,
      epitaphSummary: summary,
      recommendationReason: reason,
      readTimeMinutes: Math.max(1, Math.min(180, annotation.readTimeMinutes)),
    });
  }

  return items.map((item, index) => annotated.get(index) ?? item);
}

export async function triageTabs(
  rawInput: string,
  existingUrls: string[],
  isOnline: boolean,
): Promise<TriageResult> {
  const items = classifyTabsOffline(rawInput, existingUrls);
  if (!isOnline) return { items, mode: 'offline' };

  if (items.length > 0 && items.length <= 40) {
    try {
      const response = await fetch('/api/triage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries: items.map(({ url, title }) => ({ url, title })) }),
        signal: AbortSignal.timeout(20_000),
      });
      if (response.ok) {
        const payload = await response.json();
        const enriched = applyAnnotations(items, payload?.items);
        if (enriched) return { items: enriched, mode: 'gemini' };
      }
    } catch {
      return { items, mode: 'local-fallback' };
    }
  }

  return { items, mode: 'local-fallback' };
}
