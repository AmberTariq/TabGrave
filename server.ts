import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import type { Request, Response } from 'express';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

const VALID_SECTIONS = new Set([
  '3 AM Curiosity',
  'Reference & Study',
  'Useful Someday',
  'Ready to Close',
]);

const VALID_RECOMMENDATIONS = new Set([
  'Read Today',
  'File in Archive',
  'Close Forever',
]);

interface TriageRequestBody {
  rawInput?: unknown;
  existingUrls?: unknown;
}

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

function extractReadableErrorMessage(err: unknown): { status: number; message: string } {
  const raw = err instanceof Error ? err.message : 'Unexpected server error during tab triage.';
  let status = 502;
  let message = raw;

  try {
    const parsed = JSON.parse(raw) as { error?: { code?: number; message?: string; status?: string } };
    if (parsed?.error?.message) {
      message = parsed.error.message;
      const code = Number(parsed.error.code);
      if (code === 400 || code === 401 || code === 403 || code === 429 || code === 503) {
        status = code;
      }
    }
  } catch {
    const statusMatch = raw.match(/\b(400|401|403|404|429|500|502|503|504)\b/);
    if (statusMatch) {
      status = Number(statusMatch[1]);
    }
  }

  return { status, message: sanitizeNoEmDash(message) };
}

function isTransientError(err: unknown): boolean {
  const raw = err instanceof Error ? err.message : String(err ?? '');
  return /\b(429|500|502|503|504|UNAVAILABLE|RESOURCE_EXHAUSTED|INTERNAL)\b/i.test(raw);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function generateTriageWithRetry(
  ai: GoogleGenAI,
  promptParts: string,
  systemInstruction: string
) {
  const maxAttempts = 3;
  const backoffMs = [600, 1400];
  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await ai.models.generateContent({
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
    } catch (err: unknown) {
      lastError = err;
      if (attempt < maxAttempts - 1 && isTransientError(err)) {
        await delay(backoffMs[attempt] ?? 1000);
        continue;
      }
      throw err;
    }
  }

  throw lastError;
}

async function createApp() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ ok: true });
  });

  app.post('/api/triage', async (req: Request, res: Response) => {
    try {
      const body = (req.body ?? {}) as TriageRequestBody;
      const rawInput = typeof body.rawInput === 'string' ? body.rawInput.trim() : '';

      if (!rawInput) {
        res.status(400).json({ error: 'Please paste at least one URL, tab line, or note to triage.' });
        return;
      }

      if (rawInput.length > 40000) {
        res.status(400).json({ error: 'Input exceeds the 40,000 character batch limit. Split into smaller batches.' });
        return;
      }

      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        res.status(500).json({
          error: 'GEMINI_API_KEY is not configured on the server. Add your key in Settings > Secrets.',
        });
        return;
      }

      const existingUrls = Array.isArray(body.existingUrls)
        ? body.existingUrls.filter((u): u is string => typeof u === 'string').slice(0, 100)
        : [];

      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });

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

      const promptParts = [
        existingUrls.length > 0
          ? `Already on ledger (treat repeats as duplicates in Ready to Close):\n${existingUrls.join('\n')}\n\n`
          : '',
        `Tab dump to triage:\n${rawInput}`,
      ].join('');

      const response = await generateTriageWithRetry(ai, promptParts, systemInstruction);

      const rawText = (response?.text ?? '{}')
        .trim()
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/```$/i, '')
        .trim();
      const parsed = JSON.parse(rawText) as { items?: RawGeminiItem[] };
      const rawItems = Array.isArray(parsed.items) ? parsed.items : [];

      const now = Date.now();
      const items = rawItems.map((item, idx) => {
        const cleanUrl = normalizeUrlSafe(String(item.url ?? ''));
        const cleanDomain = extractDomainSafe(cleanUrl, String(item.domain ?? 'desk.note'));
        const section = VALID_SECTIONS.has(String(item.section))
          ? String(item.section)
          : 'Useful Someday';
        const recommendation = VALID_RECOMMENDATIONS.has(String(item.recommendation))
          ? String(item.recommendation)
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

      res.json({ items });
    } catch (err: unknown) {
      const { status, message } = extractReadableErrorMessage(err);
      console.error('[/api/triage error]:', err);
      res.status(status).json({
        error: `Could not complete AI triage: ${message}`,
      });
    }
  });

  if (!IS_PRODUCTION) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req: Request, res: Response) => {
      const indexPath = path.join(distDir, 'index.html');
      if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
      } else {
        res.status(404).send('Build output not found. Run npm run build first.');
      }
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`TabGrave desk listening on http://localhost:${PORT}`);
  });
}

createApp();
