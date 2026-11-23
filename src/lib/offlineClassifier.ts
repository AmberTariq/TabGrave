import { extractEntriesFromRawInput } from './bookmarkParser';
import type { ArchiveSection, RecommendationVerdict, TriagedTab } from '../types';

function deriveDomain(url: string): string {
  if (!url) return 'desk.note';
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return 'local.archive';
  }
}

function deriveTitle(url: string, rawTitle: string, domain: string): string {
  if (rawTitle && rawTitle.length > 2) {
    return rawTitle.replace(/\s+/g, ' ').trim();
  }
  if (!url) return 'Untitled Desk Note';
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname
      .split('/')
      .filter(Boolean)
      .filter((seg) => !/^(en-us|docs|wiki|index\.html|article|p)$/i.test(seg));
    if (segments.length > 0) {
      const last = decodeURIComponent(segments[segments.length - 1])
        .replace(/\.(html?|php|aspx)$/i, '')
        .replace(/[-_]+/g, ' ')
        .trim();
      if (last.length > 2) {
        return last.replace(/\b\w/g, (ch) => ch.toUpperCase());
      }
    }
    return domain;
  } catch {
    return domain;
  }
}

function normalizeUrlForDuplicateCheck(url: string): string {
  if (!url) return '';
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
    const path = parsed.pathname.replace(/\/+$/, '').toLowerCase();
    return `${host}${path}${parsed.search}`;
  } catch {
    return url.toLowerCase().trim();
  }
}

export function classifyTabsOffline(
  rawInput: string,
  existingUrls: string[] = []
): TriagedTab[] {
  const entries = extractEntriesFromRawInput(rawInput);
  const seenUrls = new Set(
    existingUrls.map(normalizeUrlForDuplicateCheck).filter(Boolean)
  );
  const now = Date.now();

  return entries.map((entry, index) => {
    const domain = deriveDomain(entry.url);
    const title = deriveTitle(entry.url, entry.rawTitle, domain);
    const combined = `${entry.url} ${entry.rawTitle} ${entry.rawLine}`.toLowerCase();
    const normUrl = normalizeUrlForDuplicateCheck(entry.url);

    let isDuplicate = false;
    if (normUrl) {
      if (seenUrls.has(normUrl)) {
        isDuplicate = true;
      } else {
        seenUrls.add(normUrl);
      }
    }

    let section: ArchiveSection = 'Useful Someday';
    let recommendation: RecommendationVerdict = 'File in Archive';
    let recommendationReason = 'Practical reference worth keeping for a calm weekend review.';
    let epitaphSummary = `Saved page from ${domain} covering ${title.toLowerCase()}.`;
    let readTimeMinutes = 5;

    if (isDuplicate) {
      section = 'Ready to Close';
      recommendation = 'Close Forever';
      recommendationReason = 'Duplicate entry already recorded in your current reading ledger.';
      epitaphSummary = `Duplicate bookmark pointing to ${domain} that repeats an existing open tab. Closing this copy keeps the ledger clean.`;
      readTimeMinutes = 1;
    } else if (
      /(201\d|202[0-4]|schedule|conf|summit|webinar|sale|promo|expired|register|tickets|utm_source|login|signin|cart|checkout)/i.test(
        combined
      )
    ) {
      section = 'Ready to Close';
      recommendation = 'Close Forever';
      recommendationReason = 'Time-bound event or expired utility page with little lasting value.';
      epitaphSummary = `Dated event or transient page on ${domain} tied to a past schedule or session. Its core information is likely outdated.`;
      readTimeMinutes = 2;
    } else if (
      /(wikipedia\.org|reddit\.com|news\.ycombinator|atlasobscura|tvtropes|youtube\.com|youtu\.be|trivia|mystery|history|strange|rabbit|tarrare)/i.test(
        combined
      )
    ) {
      section = '3 AM Curiosity';
      recommendation = 'File in Archive';
      recommendationReason = 'Engaging late-night curiosity best saved for unhurried leisure reading.';
      epitaphSummary = `Curiosity entry from ${domain} exploring ${title}. Suited for off-hours reading rather than immediate task focus.`;
      readTimeMinutes = 7;
    } else if (
      /(developer\.mozilla|mdn|docs\.|documentation|api|rfc|arxiv|github\.com|stackoverflow|specification|manual|handbook|guide|tutorial|study|exam|service worker|typescript|react|python|sql)/i.test(
        combined
      )
    ) {
      section = 'Reference & Study';
      recommendation = 'Read Today';
      recommendationReason = 'Core technical documentation directly useful for active study or building.';
      epitaphSummary = `Technical reference material hosted on ${domain} detailing ${title}. Contains structured specifications and implementation guidance.`;
      readTimeMinutes = 9;
    } else if (
      /(recipe|seriouseats|nytimes\.com\/cooking|cooking|essay|career|staffeng|blog|substack|medium\.com|design|craft|book|review|notes)/i.test(
        combined
      )
    ) {
      section = 'Useful Someday';
      const isEssay = /(essay|career|staffeng|archetype|guide|notes)/i.test(combined);
      recommendation = isEssay ? 'Read Today' : 'File in Archive';
      recommendationReason = isEssay
        ? 'Focused long-form perspective worth reading during a quiet break today.'
        : 'Practical resource to keep indexed until the project or meal arises.';
      epitaphSummary = `Saved article from ${domain} on ${title}. Offers practical methods or thoughtful perspective without urgent deadlines.`;
      readTimeMinutes = isEssay ? 8 : 4;
    } else if (entry.isNoteOnly) {
      section = 'Useful Someday';
      recommendation = 'File in Archive';
      recommendationReason = 'Captured plain-text reminder kept in the archive for follow-up.';
      epitaphSummary = `Personal desk note recorded without an attached URL: ${title}.`;
      readTimeMinutes = 1;
    }

    return {
      id: `tab-${now}-${index}-${Math.random().toString(36).slice(2, 7)}`,
      url: entry.url || `https://example.invalid/note/${index + 1}`,
      title,
      domain,
      section,
      epitaphSummary,
      recommendation,
      recommendationReason,
      readTimeMinutes,
      addedAt: now + index,
    };
  });
}
