import React, { useState } from 'react';
import { Download, Share, X, Smartphone } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

interface PWAInstallButtonProps {
  className?: string;
  variant?: 'primary' | 'outline' | 'compact';
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({
  className = '',
  variant = 'outline',
}) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  // If already installed in standalone mode, hide
  if (isInstalled) {
    return null;
  }

  // Chromium / Android / Desktop flow
  if (isInstallable) {
    if (variant === 'primary') {
      return (
        <button
          onClick={install}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl bg-[#0494f4] hover:bg-[#0382d6] text-white text-xs font-bold shadow-md shadow-[#0494f4]/20 transition-all ${className}`}
        >
          <Download className="w-4 h-4 shrink-0" />
          <span>Install Gothwad Mail</span>
        </button>
      );
    }

    return (
      <button
        onClick={install}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-neutral-200 dark:border-[#383838] hover:border-[#0494f4] text-xs font-semibold text-neutral-800 dark:text-neutral-200 transition-colors ${className}`}
        title="Install as Progressive Web App"
      >
        <Download className="w-3.5 h-3.5 text-[#0494f4]" />
        <span>Install App</span>
      </button>
    );
  }

  // iOS Safari flow (beforeinstallprompt is not fired by Safari WebKit)
  if (isIOS) {
    return (
      <>
        <button
          onClick={() => setShowIOSGuide(true)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-neutral-200 dark:border-[#383838] hover:border-[#0494f4] text-xs font-semibold text-neutral-800 dark:text-neutral-200 transition-colors ${className}`}
          title="Install on iPhone / iPad"
        >
          <Smartphone className="w-3.5 h-3.5 text-[#0494f4]" />
          <span>Install on iOS</span>
        </button>

        {showIOSGuide && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs select-none">
            <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-[#212121] p-5 shadow-2xl border border-neutral-200 dark:border-[#383838]">
              <div className="flex items-center justify-between pb-3 border-b border-neutral-100 dark:border-[#2f2f2f] mb-3">
                <h3 className="text-sm font-bold text-neutral-900 dark:text-white flex items-center gap-2">
                  <Smartphone className="w-4 h-4 text-[#0494f4]" />
                  Install on iPhone / iPad
                </h3>
                <button
                  onClick={() => setShowIOSGuide(false)}
                  className="p-1 rounded-full text-neutral-400 hover:text-neutral-700"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-3 text-xs text-neutral-600 dark:text-neutral-300 leading-relaxed">
                <div className="flex items-start gap-2.5 p-2.5 rounded-xl bg-neutral-50 dark:bg-[#282828]">
                  <Share className="w-4 h-4 text-[#0494f4] shrink-0 mt-0.5" />
                  <p>
                    1. Tap the <strong>Share</strong> button in your Safari bottom toolbar.
                  </p>
                </div>
                <div className="flex items-start gap-2.5 p-2.5 rounded-xl bg-neutral-50 dark:bg-[#282828]">
                  <Download className="w-4 h-4 text-[#0494f4] shrink-0 mt-0.5" />
                  <p>
                    2. Scroll down and tap <strong>Add to Home Screen</strong>.
                  </p>
                </div>
              </div>

              <button
                onClick={() => setShowIOSGuide(false)}
                className="mt-4 w-full py-2.5 rounded-xl bg-[#0494f4] text-white text-xs font-bold hover:bg-[#0382d6] transition-colors"
              >
                Got it
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};
