import React, { useEffect } from 'react';

export type LegalDocType = 'terms' | 'privacy' | null;

interface LegalModalProps {
  docType: LegalDocType;
  onClose: () => void;
}

export const LegalModal: React.FC<LegalModalProps> = ({ docType, onClose }) => {
  useEffect(() => {
    if (!docType) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [docType, onClose]);

  if (!docType) return null;

  const isTerms = docType === 'terms';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#1B1A18]/45 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="legal-modal-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl rounded-[2px] border border-[#CFC7B6] bg-[#F5F1E8] p-6 sm:p-8 text-[#1B1A18] max-h-[85vh] overflow-y-auto"
        style={{ boxShadow: '0 12px 32px rgba(27,26,24,0.12)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-[#CFC7B6] pb-4">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-[#57534A]">
              Archival Desk Notice
            </p>
            <h2
              id="legal-modal-title"
              className="mt-1 font-serif text-2xl font-medium tracking-[-0.02em] text-[#1B1A18]"
            >
              {isTerms ? 'Terms of Service' : 'Privacy Policy'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[40px] rounded-[2px] border border-[#CFC7B6] bg-[#ECE6D8] px-3 py-1.5 font-mono text-xs uppercase tracking-[0.08em] text-[#1B1A18] hover:border-[#1B1A18] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#A6442E]"
          >
            Close
          </button>
        </div>

        <div className="mt-5 space-y-4 font-sans text-sm leading-relaxed text-[#1B1A18]">
          {isTerms ? (
            <>
              <p>
                TabGrave is provided as a personal link triage desk and reading ledger. You remain solely
                responsible for the URLs, bookmark files, and notes you paste or import into the workspace.
              </p>
              <p>
                Automated triage recommendations (Read Today, File in Archive, or Close Forever) and read
                time estimates are editorial aids generated from link titles, domains, and accompanying notes.
                Always verify external pages before discarding important bookmarks.
              </p>
              <p>
                When you open a triaged link, your browser navigates directly to the third-party website
                outside this ledger. TabGrave does not endorse, host, or monitor external destinations.
              </p>
              <p className="font-mono text-xs text-[#57534A] pt-2 border-t border-[#CFC7B6]">
                Effective Date: November 23, 2026. Provided as is without warranty.
              </p>
            </>
          ) : (
            <>
              <p>
                Your triaged reading ledger and cleared tab count are stored locally in your browser using
                localStorage. Clearing your browser storage or selecting Reset Desk removes those saved
                records immediately.
              </p>
              <p>
                When you click Sort My Tabs while online with an API key configured, the text pasted
                into the Tab Dump ledger is sent directly from your browser to the Gemini API solely
                to classify links and generate concise summaries. No account registration, tracking
                cookies, or advertising profiles are used.
              </p>
              <p>
                When your device is offline, TabGrave runs its local classifier directly inside your browser
                so your pasted links and imported HTML bookmark files never leave your device.
              </p>
              <p className="font-mono text-xs text-[#57534A] pt-2 border-t border-[#CFC7B6]">
                Last Updated: November 23, 2026. Zero third-party analytics or ad trackers.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
