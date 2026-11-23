import React, { useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export const PWAInstallButton: React.FC = () => {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  useEffect(() => {
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    setIsInstalled(isStandalone);

    const ua = window.navigator.userAgent.toLowerCase();
    setIsIOS(/iphone|ipad|ipod/.test(ua));

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  if (isInstalled) return null;

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setIsInstalled(true);
      setDeferredPrompt(null);
    }
  };

  if (deferredPrompt) {
    return (
      <button
        type="button"
        onClick={handleInstall}
        className="min-h-[36px] rounded-[2px] border border-[#1B1A18] bg-[#ECE6D8] px-3 py-1 font-mono text-[11px] uppercase tracking-[0.08em] text-[#1B1A18] hover:bg-[#E4DDD0] whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#A6442E]"
      >
        Install Desk
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          className="min-h-[36px] rounded-[2px] border border-[#CFC7B6] bg-[#ECE6D8] px-3 py-1 font-mono text-[11px] uppercase tracking-[0.08em] text-[#57534A] hover:border-[#1B1A18] hover:text-[#1B1A18] whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#A6442E]"
        >
          Install App
        </button>

        {showIOSGuide && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-[#1B1A18]/45 p-4"
            role="dialog"
            aria-modal="true"
            onClick={() => setShowIOSGuide(false)}
          >
            <div
              className="w-full max-w-sm rounded-[2px] border border-[#CFC7B6] bg-[#F5F1E8] p-6 text-[#1B1A18]"
              style={{ boxShadow: '0 12px 32px rgba(27,26,24,0.12)' }}
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="font-serif text-xl font-medium tracking-[-0.02em]">
                Install TabGrave on iOS
              </h3>
              <ol className="mt-3 list-decimal pl-5 space-y-2 font-sans text-sm text-[#57534A]">
                <li>Tap the Share button in the Safari toolbar.</li>
                <li>Scroll down and select Add to Home Screen.</li>
                <li>Open TabGrave offline anytime from your home screen.</li>
              </ol>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="mt-5 w-full min-h-[42px] rounded-[2px] border border-[#1B1A18] bg-[#ECE6D8] px-4 py-2 font-mono text-xs uppercase tracking-[0.08em] text-[#1B1A18]"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};
