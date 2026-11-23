import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArchiveDrawerIcon,
  BookmarkRibbonIcon,
  HeadstoneIcon,
} from './components/Icons';
import { LegalModal, type LegalDocType } from './components/LegalModal';
import { PWAInstallButton } from './components/PWAInstallButton';
import { getHttpUrl, parseBookmarkHtml } from './lib/bookmarkParser';
import { triageTabs } from './lib/geminiTriage';
import {
  FILTER_TABS,
  type ArchiveSection,
  type FilterTab,
  type RecommendationVerdict,
  type TriagedTab,
} from './types';

const STORAGE_KEYS = {
  LEDGER: 'tabgrave_ledger_v1',
  CLEARED: 'tabgrave_cleared_v1',
  DRAFT: 'tabgrave_draft_v1',
} as const;

const SAMPLE_SIX_TABS = [
  'https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers - Using Service Workers - MDN Web Docs',
  'https://en.wikipedia.org/wiki/Tarrare - Tarrare - Wikipedia',
  'https://www.seriouseats.com/crispy-braised-chickpeas-with-garlic-and-rosemary-recipe - Crispy Braised Chickpeas with Garlic and Rosemary',
  'https://2023.jsconf.eu/schedule/index.html - JSConf EU 2023 Full Schedule & Speakers',
  'https://staffeng.com/guides/staff-archetypes/ - Staff Engineer Archetypes - StaffEng',
  'https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers - Using Service Workers (Duplicate Tab)',
].join('\n');

function getLedgerLink(url: string): string {
  return url.startsWith('https://example.invalid/note/') ? '' : getHttpUrl(url);
}

function formatDeskDate(date: Date): string {
  return date
    .toLocaleDateString('en-US', {
      weekday: 'short',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    })
    .replace(/,/g, '')
    .toUpperCase();
}

function getVerdictStampClass(verdict: RecommendationVerdict): string {
  switch (verdict) {
    case 'Read Today':
      return 'border-[#3B5E4D] text-[#3B5E4D]';
    case 'Close Forever':
      return 'border-[#A6442E] text-[#A6442E]';
    case 'File in Archive':
    default:
      return 'border-[#1B1A18] text-[#1B1A18]';
  }
}

function pickPriorityScore(item: TriagedTab): number {
  let score = 0;
  if (item.recommendation === 'Read Today') score += 300;
  else if (item.recommendation === 'File in Archive') score += 150;
  else score += 10;

  if (item.section === 'Reference & Study') score += 40;
  else if (item.section === 'Useful Someday') score += 30;
  else if (item.section === '3 AM Curiosity') score += 20;

  // Prefer moderate readable length over huge or empty items
  if (item.readTimeMinutes >= 3 && item.readTimeMinutes <= 15) score += 10;
  return score;
}

function loadStoredLedger(): TriagedTab[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.LEDGER);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is TriagedTab => (
        item && typeof item.id === 'string' && typeof item.url === 'string' && typeof item.title === 'string'
        && typeof item.domain === 'string' && typeof item.section === 'string'
        && typeof item.epitaphSummary === 'string' && typeof item.recommendation === 'string'
        && typeof item.recommendationReason === 'string' && Number.isFinite(item.readTimeMinutes)
        && Number.isFinite(item.addedAt)
      ))
      : [];
  } catch {
    return [];
  }
}

function loadStoredCleared(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.CLEARED);
    const num = Number(raw);
    return Number.isFinite(num) && num >= 0 ? Math.floor(num) : 0;
  } catch {
    return 0;
  }
}

function loadStoredDraft(): string {
  try {
    return localStorage.getItem(STORAGE_KEYS.DRAFT) ?? '';
  } catch {
    return '';
  }
}

export default function App() {
  const [rawInput, setRawInput] = useState<string>(loadStoredDraft);
  const [ledger, setLedger] = useState<TriagedTab[]>(loadStoredLedger);
  const [tabsCleared, setTabsCleared] = useState<number>(loadStoredCleared);
  const [activeFilter, setActiveFilter] = useState<FilterTab>('All');
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [isSorting, setIsSorting] = useState<boolean>(false);
  const [deskNotice, setDeskNotice] = useState<{
    tone: 'neutral' | 'error' | 'offline';
    message: string;
  } | null>(null);
  const [isDraggingFile, setIsDraggingFile] = useState<boolean>(false);
  const [confirmReset, setConfirmReset] = useState<boolean>(false);
  const [legalModal, setLegalModal] = useState<LegalDocType>(null);
  const [animatedBatchIds, setAnimatedBatchIds] = useState<Set<string>>(new Set());
  const [showTabShortcut, setShowTabShortcut] = useState<boolean>(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const todayLabel = useMemo(() => formatDeskDate(new Date()), []);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.LEDGER, JSON.stringify(ledger));
    } catch {
      // Ignore storage quota issues quietly
    }
  }, [ledger]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.CLEARED, String(tabsCleared));
    } catch {
      // Ignore storage quota issues quietly
    }
  }, [tabsCleared]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.DRAFT, rawInput);
    } catch {
      // Ignore storage quota issues quietly
    }
  }, [rawInput]);

  const sectionCounts = useMemo(() => {
    const counts: Record<FilterTab, number> = {
      All: ledger.length,
      '3 AM Curiosity': 0,
      'Reference & Study': 0,
      'Useful Someday': 0,
      'Ready to Close': 0,
    };
    for (const item of ledger) {
      counts[item.section as ArchiveSection] = (counts[item.section] ?? 0) + 1;
    }
    return counts;
  }, [ledger]);

  const todaysPick = useMemo<TriagedTab | null>(() => {
    if (ledger.length === 0) return null;
    let best: TriagedTab = ledger[0];
    let bestScore = pickPriorityScore(ledger[0]);
    for (let i = 1; i < ledger.length; i++) {
      const candidate = ledger[i];
      const score = pickPriorityScore(candidate);
      if (score > bestScore) {
        best = candidate;
        bestScore = score;
      }
    }
    return best;
  }, [ledger]);

  const filteredLedger = useMemo(() => {
    if (activeFilter === 'All') return ledger;
    return ledger.filter((item) => item.section === activeFilter);
  }, [ledger, activeFilter]);

  const inputLineCount = useMemo(() => {
    return rawInput
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean).length;
  }, [rawInput]);

  const handleLoadSampleTabs = () => {
    setRawInput(SAMPLE_SIX_TABS);
    setDeskNotice({
      tone: 'neutral',
      message: 'Loaded 6 sample tabs into the dump desk. Click Sort My Tabs to triage them.',
    });
    setConfirmReset(false);
  };

  const processBookmarkFile = async (file: File) => {
    if (!/\.html?$/i.test(file.name) && file.type !== 'text/html') {
      setDeskNotice({
        tone: 'error',
        message: 'Unsupported file format. Drop an exported browser .html bookmark file.',
      });
      return;
    }
    let extracted: string;
    try {
      extracted = parseBookmarkHtml(await file.text());
    } catch {
      setDeskNotice({ tone: 'error', message: 'Could not read that bookmark file. Try exporting it again.' });
      return;
    }
    if (!extracted) {
      setDeskNotice({
        tone: 'error',
        message: 'No http or https links were found inside that HTML bookmark file.',
      });
      return;
    }
    const count = extracted.split('\n').length;
    setRawInput((prev) => (prev.trim() ? `${prev.trim()}\n${extracted}` : extracted));
    setDeskNotice({
      tone: 'neutral',
      message: `Imported ${count} bookmark ${count === 1 ? 'link' : 'links'} from ${file.name}.`,
    });
  };

  const handleFileDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDraggingFile(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      await processBookmarkFile(file);
    }
  };

  const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) {
      await processBookmarkFile(file);
    }
  };

  const handleSortTabs = async () => {
    const trimmed = rawInput.trim();
    if (!trimmed || isSorting) return;

    setIsSorting(true);
    setDeskNotice(null);
    setConfirmReset(false);

    const existingUrls = ledger.map((item) => item.url).filter(Boolean);

    const applyNewItems = (items: TriagedTab[], notice: { tone: 'neutral' | 'offline'; message: string }) => {
      setAnimatedBatchIds(new Set(items.map((item) => item.id)));
      setLedger((prev) => [...items, ...prev]);
      setRawInput((current) => current === rawInput ? '' : current);
      setDeskNotice(notice);
    };

    try {
      const result = await triageTabs(trimmed, existingUrls, isOnline);

      if (result.items.length === 0) {
        setDeskNotice({
          tone: 'error',
          message: 'No sortable links or notes were identified in that text.',
        });
        return;
      }

      if (result.mode === 'offline') {
        applyNewItems(result.items, {
          tone: 'offline',
          message: `Offline Mode: sorted ${result.items.length} ${result.items.length === 1 ? 'entry' : 'entries'} locally using the built-in classifier.`,
        });
      } else if (result.mode === 'local-fallback') {
        applyNewItems(result.items, {
          tone: 'offline',
          message: `Sorted ${result.items.length} ${result.items.length === 1 ? 'entry' : 'entries'} with the built-in local classifier.`,
        });
      } else {
        applyNewItems(result.items, {
          tone: 'neutral',
          message: `Triaged ${result.items.length} ${result.items.length === 1 ? 'entry' : 'entries'} into your reading ledger.`,
        });
      }
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Could not complete tab triage. Please try again.';
      setDeskNotice({
        tone: 'error',
        message,
      });
    } finally {
      setIsSorting(false);
    }
  };

  const handleDoneReading = (id: string) => {
    setLedger((prev) => prev.filter((item) => item.id !== id));
    setTabsCleared((prev) => prev + 1);
  };

  const handleDismiss = (id: string) => {
    setLedger((prev) => prev.filter((item) => item.id !== id));
  };

  const handleResetDesk = () => {
    if (!confirmReset) {
      setConfirmReset(true);
      return;
    }
    setLedger([]);
    setTabsCleared(0);
    setRawInput('');
    setActiveFilter('All');
    setDeskNotice({
      tone: 'neutral',
      message: 'Desk cleared. Ready for a fresh stack of tabs.',
    });
    setConfirmReset(false);
    setAnimatedBatchIds(new Set());
  };

  return (
    <div className="min-h-screen flex flex-col text-[#1B1A18]">
      {/* Masthead with double archival rule */}
      <header className="mx-auto w-full max-w-[1320px] px-4 sm:px-8 pt-6">
        <div className="border-b border-[#CFC7B6] pb-[3px]">
          <div className="border-b-2 border-[#1B1A18] pb-4 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div className="flex items-center gap-3.5">
              <div className="flex h-10 w-10 items-center justify-center rounded-[2px] border border-[#1B1A18] bg-[#ECE6D8] text-[#1B1A18] shrink-0">
                <HeadstoneIcon className="w-5 h-5" />
              </div>
              <div>
                <h1 className="font-serif text-3xl sm:text-[34px] font-medium leading-none tracking-[-0.025em] text-[#1B1A18]">
                  TabGrave
                </h1>
                <p className="mt-1 font-sans text-xs text-[#57534A]">
                  Archival Reading Ledger and Link Triage Desk
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 sm:gap-4">
              <span className="font-mono text-xs tracking-[0.06em] text-[#57534A]">
                {todayLabel}
              </span>

              {/* Pill radius (999px) reserved strictly for small status tags */}
              <span
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-mono text-[11px] uppercase tracking-[0.06em] whitespace-nowrap shrink-0 ${
                  isOnline
                    ? 'border-[#3B5E4D]/50 bg-[#ECE6D8] text-[#3B5E4D]'
                    : 'border-[#A6442E]/60 bg-[#ECE6D8] text-[#A6442E]'
                }`}
              >
                <span aria-hidden="true">{isOnline ? '[+]' : '[!]'}</span>
                <span>{isOnline ? 'Desk Online' : 'Offline Mode'}</span>
              </span>

              <div className="rounded-[2px] border border-[#1B1A18] bg-[#ECE6D8] px-3 py-1 font-mono text-xs uppercase tracking-[0.06em] text-[#1B1A18] tabular-nums whitespace-nowrap shrink-0">
                Tabs Cleared: <strong className="font-semibold text-[#A6442E]">{tabsCleared}</strong>
              </div>

              <PWAInstallButton />
            </div>
          </div>
        </div>
      </header>

      {/* Main asymmetric two-column editorial desk */}
      <main className="mx-auto w-full max-w-[1320px] flex-1 px-4 sm:px-8 py-7">
        <div className="grid grid-cols-1 min-[900px]:grid-cols-[38fr_62fr] gap-8 items-start">
          {/* Left Column (38%): Tab Dump Input Desk */}
          <section
            aria-labelledby="tab-dump-heading"
            className="rounded-[2px] border border-[#CFC7B6] bg-[#ECE6D8] p-5 sm:p-6"
          >
            <div className="flex items-center justify-between gap-3 border-b border-[#CFC7B6] pb-3">
              <div className="flex items-center gap-2">
                <ArchiveDrawerIcon className="w-4 h-4 text-[#A6442E] shrink-0" />
                <h2
                  id="tab-dump-heading"
                  className="font-serif text-xl font-medium tracking-[-0.02em] text-[#1B1A18]"
                >
                  Tab Dump
                </h2>
              </div>
              <span className="font-mono text-xs text-[#57534A] tabular-nums">
                {inputLineCount} {inputLineCount === 1 ? 'line' : 'lines'}
              </span>
            </div>

            <p className="mt-3 font-sans text-sm leading-relaxed text-[#57534A]">
              Paste open URLs, copied tab lists, or rough reading notes. Drag an exported browser
              .html bookmark file onto the sheet below to extract links automatically.
            </p>

            {/* Dropzone & Plain-text Textarea */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDraggingFile(true);
              }}
              onDragLeave={() => setIsDraggingFile(false)}
              onDrop={handleFileDrop}
              className={`mt-4 rounded-[2px] border transition-colors ${
                isDraggingFile
                  ? 'border-[#A6442E] bg-[#F5F1E8]'
                  : 'border-[#CFC7B6] bg-[#F5F1E8]'
              }`}
            >
              <label htmlFor="tab-dump-textarea" className="sr-only">
                Paste URLs, tab lists, or reading notes
              </label>
              <textarea
                id="tab-dump-textarea"
                value={rawInput}
                onChange={(e) => setRawInput(e.target.value)}
                rows={11}
                placeholder={
                  'https://developer.mozilla.org/en-US/docs/...\nhttps://en.wikipedia.org/wiki/...\nCheck out that sourdough fermentation ratio note'
                }
                className="block w-full resize-y rounded-[2px] bg-transparent p-3.5 font-mono text-[13px] leading-relaxed text-[#1B1A18] placeholder:text-[#57534A]/65 focus:outline-none"
              />
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#CFC7B6] bg-[#ECE6D8]/60 px-3.5 py-2">
                <span className="font-mono text-[11px] text-[#57534A]">
                  {isDraggingFile
                    ? 'Release to import .html bookmarks'
                    : 'Supports .html bookmark drag and drop'}
                </span>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".html,.htm,text/html"
                  onChange={handleFileInputChange}
                  className="sr-only"
                  id="bookmark-file-input"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="font-mono text-[11px] uppercase tracking-[0.06em] text-[#1B1A18] underline decoration-[#CFC7B6] underline-offset-4 hover:decoration-[#1B1A18] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#A6442E]"
                >
                  Import .html
                </button>
              </div>
            </div>

            {/* Directly under textarea: Load 6 Forgotten Tabs + 10-second shortcut disclosure */}
            <div className="mt-3.5 flex flex-wrap items-center justify-between gap-2.5">
              <button
                type="button"
                onClick={handleLoadSampleTabs}
                disabled={isSorting}
                className="min-h-[44px] flex-1 min-[420px]:flex-initial rounded-[2px] border border-[#1B1A18] bg-[#F5F1E8] px-3.5 py-2 font-sans text-sm font-medium text-[#1B1A18] transition-colors hover:bg-[#E5DEC9] disabled:opacity-50 whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#A6442E]"
              >
                Load 6 Forgotten Tabs
              </button>

              <button
                type="button"
                aria-expanded={showTabShortcut}
                aria-controls="tab-shortcut-note"
                onClick={() => setShowTabShortcut((prev) => !prev)}
                className="min-h-[40px] px-1 py-1 font-mono text-xs text-[#57534A] underline decoration-[#CFC7B6] underline-offset-4 transition-colors hover:text-[#1B1A18] hover:decoration-[#1B1A18] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#A6442E]"
              >
                Need your tabs? 10-second shortcut
              </button>
            </div>

            {/* Collapsible inline archival note card */}
            <div
              id="tab-shortcut-note"
              aria-hidden={!showTabShortcut}
              className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none ${
                showTabShortcut
                  ? 'mt-3 grid-rows-[1fr] opacity-100'
                  : 'grid-rows-[0fr] opacity-0'
              }`}
            >
              <div className="overflow-hidden">
                <ol className="rounded-[2px] border border-[#CFC7B6] bg-[#ECE6D8] p-3.5 font-sans text-xs leading-relaxed text-[#57534A] space-y-2.5 list-none">
                  <li>
                    <span className="font-mono text-[11px] text-[#A6442E] mr-1.5">1.</span>
                    <strong className="font-medium text-[#1B1A18]">
                      Save all open tabs at once:
                    </strong>{' '}
                    Right-click any tab at the very top of your browser window and click Add all
                    tabs to bookmarks (or press{' '}
                    <span className="font-mono text-[11px] text-[#1B1A18]">Ctrl+Shift+D</span> on
                    Windows,{' '}
                    <span className="font-mono text-[11px] text-[#1B1A18]">Cmd+Shift+D</span> on
                    Mac).
                  </li>
                  <li className="border-t border-[#CFC7B6] pt-2.5">
                    <span className="font-mono text-[11px] text-[#A6442E] mr-1.5">2.</span>
                    <strong className="font-medium text-[#1B1A18]">
                      Export and drop here:
                    </strong>{' '}
                    Press <span className="font-mono text-[11px] text-[#1B1A18]">Ctrl+Shift+O</span>{' '}
                    (<span className="font-mono text-[11px] text-[#1B1A18]">Cmd+Option+B</span> on
                    Mac), click the top-right ⋮ menu, choose Export bookmarks, and drag that .html
                    file onto the box above.
                  </li>
                  <li className="border-t border-[#CFC7B6] pt-2.5">
                    <span className="font-mono text-[11px] text-[#A6442E] mr-1.5">3.</span>
                    <strong className="font-medium text-[#1B1A18]">
                      Or paste any links:
                    </strong>{' '}
                    Copy URLs directly from your address bar or notes and paste them one per line.
                  </li>
                </ol>
              </div>
            </div>

            {/* Primary Action Control */}
            <div className="mt-3.5">
              <button
                type="button"
                onClick={handleSortTabs}
                disabled={isSorting || !rawInput.trim()}
                className="w-full min-h-[44px] rounded-[2px] bg-[#A6442E] px-4 py-2.5 font-sans text-sm font-medium text-[#F5F1E8] transition-colors hover:bg-[#8E3825] disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1B1A18]"
              >
                {isSorting ? 'Sorting Your Tabs...' : 'Sort My Tabs'}
              </button>
            </div>

            {/* Inline Status / Error Feedback */}
            {deskNotice && (
              <div
                role={deskNotice.tone === 'error' ? 'alert' : 'status'}
                className={`mt-4 rounded-[2px] border px-3.5 py-2.5 font-sans text-xs leading-relaxed ${
                  deskNotice.tone === 'error'
                    ? 'border-[#A6442E] bg-[#F5F1E8] text-[#A6442E]'
                    : deskNotice.tone === 'offline'
                    ? 'border-[#57534A] bg-[#F5F1E8] text-[#1B1A18]'
                    : 'border-[#3B5E4D]/60 bg-[#F5F1E8] text-[#3B5E4D]'
                }`}
              >
                {deskNotice.message}
              </div>
            )}

            {/* Quiet Reset Desk Row */}
            <div className="mt-6 flex items-center justify-between border-t border-[#CFC7B6] pt-4">
              <span className="font-mono text-[11px] uppercase tracking-[0.06em] text-[#57534A]">
                Local Ledger Storage
              </span>
              {confirmReset ? (
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={handleResetDesk}
                    className="min-h-[36px] font-mono text-xs uppercase tracking-[0.06em] text-[#A6442E] underline underline-offset-4 hover:text-[#1B1A18]"
                  >
                    Confirm Reset
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmReset(false)}
                    className="min-h-[36px] font-mono text-xs uppercase tracking-[0.06em] text-[#57534A] hover:text-[#1B1A18]"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={handleResetDesk}
                  disabled={isSorting}
                  className="min-h-[36px] font-mono text-xs uppercase tracking-[0.06em] text-[#57534A] underline decoration-[#CFC7B6] underline-offset-4 hover:text-[#1B1A18] hover:decoration-[#1B1A18] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#A6442E]"
                >
                  Reset Desk
                </button>
              )}
            </div>
          </section>

          {/* Right Column (62%): Folder Tabs + Live Triaged Archive Ledger */}
          <section aria-labelledby="reading-ledger-heading" className="min-w-0">
            <h2 id="reading-ledger-heading" className="sr-only">
              Reading Ledger
            </h2>

            {/* Physical Index-Folder Tabs flush on top edge of ledger sheet */}
            <nav
              aria-label="Archive sections"
              className="flex flex-wrap items-end gap-1 px-1"
            >
              {FILTER_TABS.map((tab) => {
                const isActive = activeFilter === tab;
                const count = sectionCounts[tab];
                return (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setActiveFilter(tab)}
                    aria-pressed={isActive}
                    className={`min-h-[42px] rounded-t-[2px] px-3.5 py-2 font-sans text-xs sm:text-[13px] font-medium transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#A6442E] ${
                      isActive
                        ? 'relative z-10 -mb-px border border-[#CFC7B6] border-b-[#ECE6D8] bg-[#ECE6D8] text-[#1B1A18]'
                        : 'border border-transparent bg-transparent text-[#57534A] hover:bg-[#ECE6D8]/50 hover:text-[#1B1A18]'
                    }`}
                  >
                    <span>{tab}</span>
                    <span className="ml-1.5 font-mono text-[11px] text-[#57534A] tabular-nums">
                      {count}
                    </span>
                  </button>
                );
              })}
            </nav>

            {/* Ledger Sheet */}
            <div className="rounded-[2px] border border-[#CFC7B6] bg-[#ECE6D8] p-5 sm:p-7">
              {/* Today's Pick Checkout Slip (Double Hairline Border) */}
              <div className="rounded-[2px] border border-[#CFC7B6] p-[3px]">
                <div className="rounded-[2px] border border-[#CFC7B6] bg-[#F5F1E8] p-4 sm:p-5">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#CFC7B6] pb-3">
                    <div className="flex items-center gap-2">
                      <BookmarkRibbonIcon className="w-4 h-4 text-[#A6442E] shrink-0" />
                      <span className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-[#A6442E]">
                        Today&apos;s Pick
                      </span>
                    </div>

                    {todaysPick && (
                      <span
                        className={`rounded-[2px] border px-2 py-0.5 font-mono text-[11px] uppercase tracking-[0.08em] whitespace-nowrap ${getVerdictStampClass(
                          todaysPick.recommendation
                        )}`}
                      >
                        {todaysPick.recommendation}
                      </span>
                    )}
                  </div>

                  {todaysPick ? (
                    <div className="mt-4">
                      <h3 className="font-serif text-xl sm:text-2xl font-medium leading-snug tracking-[-0.02em] text-[#1B1A18]">
                        {todaysPick.title}
                      </h3>

                      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-xs text-[#57534A] tabular-nums">
                        <span>{todaysPick.domain}</span>
                        <span aria-hidden="true">/</span>
                        <span>{todaysPick.readTimeMinutes} min read</span>
                        <span aria-hidden="true">/</span>
                        <span>{todaysPick.section}</span>
                      </div>

                      <p className="mt-3 font-sans text-sm leading-relaxed text-[#1B1A18]">
                        {todaysPick.epitaphSummary}
                      </p>

                      <p className="mt-1.5 font-sans text-xs text-[#57534A]">
                        Note: {todaysPick.recommendationReason}
                      </p>

                      <div className="mt-4 flex flex-wrap items-center gap-3 pt-1">
                        <button
                          type="button"
                          onClick={() => handleDoneReading(todaysPick.id)}
                          className="min-h-[42px] rounded-[2px] bg-[#3B5E4D] px-4 py-2 font-sans text-sm font-medium text-[#F5F1E8] transition-colors hover:bg-[#2F4C3E] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1B1A18]"
                        >
                          Done Reading
                        </button>
                        {getLedgerLink(todaysPick.url) && (
                          <a
                            href={getLedgerLink(todaysPick.url)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="min-h-[42px] inline-flex items-center px-2 font-mono text-xs uppercase tracking-[0.06em] text-[#1B1A18] underline decoration-[#CFC7B6] underline-offset-4 hover:decoration-[#1B1A18] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#A6442E]"
                          >
                            Open Link
                          </a>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="mt-4 py-2">
                      <p className="font-serif text-lg text-[#1B1A18]">
                        No priority tab checked out yet.
                      </p>
                      <p className="mt-1 font-sans text-sm text-[#57534A]">
                        Paste your forgotten tabs on the left or select Load 6 Forgotten Tabs to begin
                        clearing your backlog.
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Ledger Rows Header */}
              <div className="mt-6 flex items-baseline justify-between border-b border-[#CFC7B6] pb-2.5">
                <h3 className="font-serif text-lg font-medium tracking-[-0.015em] text-[#1B1A18]">
                  {activeFilter === 'All' ? 'All Triaged Entries' : activeFilter}
                </h3>
                <span className="font-mono text-xs text-[#57534A] tabular-nums">
                  {filteredLedger.length} {filteredLedger.length === 1 ? 'record' : 'records'}
                </span>
              </div>

              {/* Hairline-Separated Ledger Rows */}
              {filteredLedger.length > 0 ? (
                <ul className="divide-y divide-[#CFC7B6]">
                  {filteredLedger.map((item, idx) => {
                    const shouldAnimate = animatedBatchIds.has(item.id);
                    const staggerMs = Math.min(idx, 12) * 40;
                    return (
                      <li
                        key={item.id}
                        style={shouldAnimate ? { animationDelay: `${staggerMs}ms` } : undefined}
                        className={`py-4 sm:py-5 ${shouldAnimate ? 'animate-ledger-row' : ''}`}
                      >
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                          <h4 className="font-serif text-lg font-medium leading-snug tracking-[-0.015em] text-[#1B1A18]">
                            {item.title}
                          </h4>
                          <span
                            className={`self-start rounded-[2px] border px-2 py-0.5 font-mono text-[11px] uppercase tracking-[0.08em] whitespace-nowrap shrink-0 ${getVerdictStampClass(
                              item.recommendation
                            )}`}
                          >
                            {item.recommendation}
                          </span>
                        </div>

                        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-xs text-[#57534A] tabular-nums">
                          <span className="break-all">{item.domain}</span>
                          <span aria-hidden="true">/</span>
                          <span>{item.readTimeMinutes} min read</span>
                          <span aria-hidden="true">/</span>
                          <span>{item.section}</span>
                        </div>

                        <p className="mt-2.5 font-sans text-sm leading-relaxed text-[#1B1A18]">
                          {item.epitaphSummary}
                        </p>

                        <p className="mt-1 font-sans text-xs text-[#57534A]">
                          {item.recommendationReason}
                        </p>

                        <div className="mt-3 flex items-center gap-5">
                          {getLedgerLink(item.url) && (
                            <a
                              href={getLedgerLink(item.url)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex min-h-[36px] items-center font-mono text-xs uppercase tracking-[0.06em] text-[#1B1A18] underline decoration-[#CFC7B6] underline-offset-4 hover:decoration-[#1B1A18] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#A6442E]"
                            >
                              Open Link
                            </a>
                          )}
                          <button
                            type="button"
                            onClick={() => handleDismiss(item.id)}
                            className="inline-flex min-h-[36px] items-center font-mono text-xs uppercase tracking-[0.06em] text-[#57534A] hover:text-[#A6442E] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#A6442E]"
                          >
                            Dismiss
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <div className="py-10 text-center">
                  <p className="font-serif text-lg text-[#1B1A18]">
                    {ledger.length === 0
                      ? 'The reading ledger is empty.'
                      : `No entries filed under ${activeFilter}.`}
                  </p>
                  <p className="mt-1 font-sans text-sm text-[#57534A]">
                    {ledger.length === 0
                      ? 'Use the Tab Dump desk to sort open tabs into quiet archival shelves.'
                      : 'Switch to another folder tab above to review your remaining links.'}
                  </p>
                </div>
              )}
            </div>
          </section>
        </div>
      </main>

      {/* Hairline-separated archival footer */}
      <footer className="mx-auto w-full max-w-[1320px] px-4 sm:px-8 pb-8 pt-2">
        <div className="border-t border-[#CFC7B6] pt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="font-mono text-xs text-[#57534A]">
            TabGrave Archival Reading Desk. Stored locally in your browser.
          </p>
          <div className="flex items-center gap-5">
            <button
              type="button"
              onClick={() => setLegalModal('terms')}
              className="min-h-[36px] font-mono text-xs text-[#57534A] underline decoration-[#CFC7B6] underline-offset-4 hover:text-[#1B1A18] hover:decoration-[#1B1A18] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#A6442E]"
            >
              Terms of Service
            </button>
            <button
              type="button"
              onClick={() => setLegalModal('privacy')}
              className="min-h-[36px] font-mono text-xs text-[#57534A] underline decoration-[#CFC7B6] underline-offset-4 hover:text-[#1B1A18] hover:decoration-[#1B1A18] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#A6442E]"
            >
              Privacy Policy
            </button>
          </div>
        </div>
      </footer>

      <LegalModal docType={legalModal} onClose={() => setLegalModal(null)} />
    </div>
  );
}
