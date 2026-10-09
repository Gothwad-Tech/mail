import React, { useEffect, useState } from 'react';
import { WifiOff } from 'lucide-react';

export const OfflineIndicator: React.FC = () => {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

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

  if (isOnline) return null;

  return (
    <div className="fixed bottom-20 md:bottom-6 left-4 z-50 flex items-center gap-2.5 px-4 py-2.5 rounded-2xl bg-neutral-900 text-white border border-neutral-700 shadow-xl text-xs select-none animate-in fade-in slide-in-from-bottom-2">
      <WifiOff className="w-4 h-4 text-[#0494f4]" />
      <span>Offline Mode — Cached local data is being used.</span>
    </div>
  );
};
