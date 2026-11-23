import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import { classifyTabsOffline } from './offlineClassifier';
import type { ArchiveSection, RecommendationVerdict, TriagedTab } from '../types';

const VALID_SECTIONS = new Set<ArchiveSection>([
  '3 AM Curiosity',
  'Reference & Study',
  'Useful Someday',
  'Ready to Close',
]);

const VALID_RECOMMENDATIONS = new Set<RecommendationVerdict>([
  'Read Today',
  'File in Archive',
  'Close Forever',
]);

interface RawGeminiItem {
  url?: string;
  title?: string;
  domain?: string;
  section?: string;
  epitaphSummary?: string;
  recommendation?: string;
  recommendationReason?: string;
  readTimeMinutes?: number;
}

export interface TriageResult {
  items: TriagedTab[];
  mode: 'gemini' | 'offline' | 'missing-key-fallback';
}

function sanitizeNoEmDash(text: string): string {
  return text.replace(/[\u2014\u2013]/g, ', ').replace(/\s+,/g, ',').trim();
}

function normalizeUrlSafe(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^[a-z0-9.-]+\.[a-z]{2,}/i.test(trimmed)) return `https://${trimmed}`;
  return trimmed;
}

function extractDomainSafe(urlStr: string, fallbackDomain: string): string {
  try {
    const parsed = new URL(urlStr);
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return fallbackDomain.replace(/^www\./, '') || 'desk.note';
  }
}

function extractReadableErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : 'Unexpected error during tab triage.';
  let message = raw;
  try {
    const parsed = JSON.parse(raw) as { error?: { message?: string } };
    if (parsed?.error?.message) {
      message = parsed.error.message;
    }
  } catch {
    // Use raw message as-is
  }
  return sanitizeNoEmDash(message);
}

function isTransientError(err: unknown): boolean {
  const raw = err instanceof Error ? err.message : String(err ?? '');
  return /\b(429|500|502|503|504|UNAVAILABLE|RESOURCE_EXHAUSTED|INTERNAL)\b/i.test(raw);
}

function isNetworkFailure(err: unknown): boolean {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return true;
  if (err instanceof TypeError && /fetch|network/i.test(err.message)) return true;
  const raw = err instanceof Error ? err.message : String(err ?? '');
  return /failed to fetch|networkerror|err_internet_disconnected|load failed/i.test(raw);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function triageTabs(
  rawInput: string,
  existingUrls: string[],
  isOnline: boolean
): Promise<TriageResult> {
  const trimmed = rawInput.trim();
  const apiKey = (import.meta.env.VITE_GEMINI_API_KEY as string | undefined)?.trim();

  if (!isOnline) {
    return {
      items: classifyTabsOffline(trimmed, existingUrls),
      mode: 'offline',
    };
  }

  if (!apiKey) {
    return {
      items: classifyTabsOffline(trimmed, existingUrls),
      mode: 'missing-key-fallback',
    };
  }

  const ai = new GoogleGenAI({ apiKey });

  const systemInstruction = [
    'You are the archivist behind TabGrave, a calm reading archive and link triage desk.',
    'Parse every link, browser tab entry, or standalone reading note from the user input into structured archive records.',
    'Classify each entry into exactly one of these four sections:',
    '1. "3 AM Curiosity": late-night rabbit holes, Wikipedia dives, trivia, strange history, forum threads.',
    '2. "Reference & Study": technical documentation, MDN/API manuals, tutorials, research papers, exam or project material.',
    '3. "Useful Someday": tools, recipes, career essays, practical guides, thoughtful long-form reads.',
    '4. "Ready to Close": outdated event schedules, expired sales/promos, login/cart tabs, low-value clutter, OR duplicate links that appear more than once in the input or already exist in existingUrls.',
    'Important rules:',
    '- Preserve every item from the input, including duplicate links; classify the duplicate entry into "Ready to Close" with recommendation "Close Forever" and state clearly that it is a duplicate tab.',
    '- Never use em dashes or en dashes anywhere in titles, summaries, or reasons. Use commas, colons, or periods instead.',
    '- Never use the phrase "It is not X, it is Y" or "It\'s not X, it\'s Y".',
    '- Keep epitaphSummary to 1 or 2 plain, factual sentences explaining what the page covers.',
    '- Keep recommendationReason concise and factual (under 14 words).',
    '- Provide realistic integer readTimeMinutes (at least 1).',
  ].join('\n');

  const safeExisting = existingUrls.slice(0, 100);
  const promptParts = [
    safeExisting.length > 0
      ? `Already on ledger (treat repeats as duplicates in Ready to Close):\n${safeExisting.join('\n')}\n\n`
      : '',
    `Tab dump to triage:\n${trimmed}`,
  ].join('');

  const maxAttempts = 3;
  const backoffMs = [600, 1400];
  let response;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: promptParts,
        config: {
          systemInstruction,
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              items: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    url: {
                      type: Type.STRING,
                      description: 'Full https URL for the link, or empty string if standalone note.',
                    },
                    title: {
                      type: Type.STRING,
                      description: 'Clean, concise page title without site-name clutter.',
                    },
                    domain: {
                      type: Type.STRING,
                      description: 'Clean domain name without www prefix, e.g. developer.mozilla.org.',
                    },
                    section: {
                      type: Type.STRING,
                      enum: [
                        '3 AM Curiosity',
                        'Reference & Study',
                        'Useful Someday',
                        'Ready to Close',
                      ],
                    },
                    epitaphSummary: {
                      type: Type.STRING,
                      description: '1 to 2 plain sentences explaining what the page covers. No em dashes.',
                    },
                    recommendation: {
                      type: Type.STRING,
                      enum: ['Read Today', 'File in Archive', 'Close Forever'],
                    },
                    recommendationReason: {
                      type: Type.STRING,
                      description: 'Short factual reason for the recommendation. No em dashes.',
                    },
                    readTimeMinutes: {
                      type: Type.INTEGER,
                      description: 'Estimated reading time in minutes (integer >= 1).',
                    },
                  },
                  required: [
                    'url',
                    'title',
                    'domain',
                    'section',
                    'epitaphSummary',
                    'recommendation',
                    'recommendationReason',
                    'readTimeMinutes',
                  ],
                },
              },
            },
            required: ['items'],
          },
        },
      });
      break;
    } catch (err: unknown) {
      if (isNetworkFailure(err)) {
        return {
          items: classifyTabsOffline(trimmed, existingUrls),
          mode: 'offline',
        };
      }
      if (attempt < maxAttempts - 1 && isTransientError(err)) {
        await delay(backoffMs[attempt] ?? 1000);
        continue;
      }
      throw new Error(`Could not complete AI triage: ${extractReadableErrorMessage(err)}`);
    }
  }

  const rawText = (response?.text ?? '{}')
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();
  const parsed = JSON.parse(rawText) as { items?: RawGeminiItem[] };
  const rawItems = Array.isArray(parsed.items) ? parsed.items : [];

  const now = Date.now();
  const items: TriagedTab[] = rawItems.map((item, idx) => {
    const cleanUrl = normalizeUrlSafe(String(item.url ?? ''));
    const cleanDomain = extractDomainSafe(cleanUrl, String(item.domain ?? 'desk.note'));
    const sectionCandidate = String(item.section) as ArchiveSection;
    const section: ArchiveSection = VALID_SECTIONS.has(sectionCandidate)
      ? sectionCandidate
      : 'Useful Someday';
    const recCandidate = String(item.recommendation) as RecommendationVerdict;
    const recommendation: RecommendationVerdict = VALID_RECOMMENDATIONS.has(recCandidate)
      ? recCandidate
      : 'File in Archive';
    const readTime = Math.max(1, Math.min(180, Math.round(Number(item.readTimeMinutes) || 4)));

    return {
      id: `tab-${now}-${idx}-${Math.random().toString(36).slice(2, 7)}`,
      url: cleanUrl || `https://example.invalid/note/${idx + 1}`,
      title: sanitizeNoEmDash(String(item.title || cleanDomain || 'Untitled Link')),
      domain: cleanDomain,
      section,
      epitaphSummary: sanitizeNoEmDash(
        String(item.epitaphSummary || `Archived link from ${cleanDomain}.`)
      ),
      recommendation,
      recommendationReason: sanitizeNoEmDash(
        String(item.recommendationReason || 'Sorted into your reading ledger.')
      ),
      readTimeMinutes: readTime,
      addedAt: now + idx,
    };
  });

  return { items, mode: 'gemini' };
}
