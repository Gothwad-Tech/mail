import React from 'react';
import { X } from 'lucide-react';
import { useMail } from '../context/MailContext';

export const Toast: React.FC = () => {
  const { toast, dismissToast } = useMail();

  if (!toast) return null;

  return (
    <div className="fixed bottom-20 md:bottom-6 left-4 md:left-24 z-50 flex items-center gap-3 px-4 py-3 rounded-2xl bg-[#1e1e1e] text-white shadow-2xl border border-[#383838] select-none text-xs sm:text-sm animate-in fade-in slide-in-from-bottom-2 duration-150">
      <span className="font-medium">{toast.message}</span>

      {toast.actionText && toast.onAction && (
        <button
          onClick={() => {
            toast.onAction?.();
            dismissToast();
          }}
          className="text-[#0494f4] font-bold hover:underline px-1 py-0.5"
        >
          {toast.actionText}
        </button>
      )}

      <button
        onClick={dismissToast}
        className="p-1 rounded-full hover:bg-neutral-800 text-neutral-400 hover:text-white ml-1 transition-colors"
        aria-label="Dismiss notification"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};
