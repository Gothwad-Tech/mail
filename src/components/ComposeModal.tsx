import React, { useState, useRef, useEffect } from 'react';
import {
  X,
  Minus,
  Maximize2,
  Minimize2,
  Paperclip,
  Send,
  Trash2,
  ArrowLeft,
  ChevronDown,
  List,
  Quote,
  MoreVertical,
} from 'lucide-react';
import { useMail } from '../context/MailContext';
import { EmailAttachment } from '../types/email';

export const ComposeModal: React.FC = () => {
  const {
    composeState,
    closeCompose,
    minimizeCompose,
    maximizeCompose,
    setComposeData,
    sendEmail,
    saveDraft,
    currentUser,
  } = useMail();

  const [toInput, setToInput] = useState('');
  const [showCc, setShowCc] = useState(false);
  const [showBcc, setShowBcc] = useState(false);
  const [ccInput, setCcInput] = useState('');
  const [bccInput, setBccInput] = useState('');
  const [isScheduleMenuOpen, setIsScheduleMenuOpen] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data, isOpen, isMinimized, isMaximized } = composeState;

  // Auto-save draft on changes (every 2 seconds)
  useEffect(() => {
    if (!isOpen) return;
    const timer = setTimeout(() => {
      saveDraft(data);
    }, 2000);
    return () => clearTimeout(timer);
  }, [data, isOpen, saveDraft]);

  if (!isOpen) return null;

  const handleAddRecipient = (type: 'to' | 'cc' | 'bcc', value: string) => {
    const clean = value.trim().replace(/,/g, '');
    if (!clean) return;

    if (type === 'to') {
      if (!data.to.includes(clean)) {
        setComposeData({ ...data, to: [...data.to, clean] });
      }
      setToInput('');
    } else if (type === 'cc') {
      if (!data.cc.includes(clean)) {
        setComposeData({ ...data, cc: [...data.cc, clean] });
      }
      setCcInput('');
    } else if (type === 'bcc') {
      if (!data.bcc.includes(clean)) {
        setComposeData({ ...data, bcc: [...data.bcc, clean] });
      }
      setBccInput('');
    }
  };

  const handleRemoveRecipient = (type: 'to' | 'cc' | 'bcc', val: string) => {
    if (type === 'to') {
      setComposeData({ ...data, to: data.to.filter((t) => t !== val) });
    } else if (type === 'cc') {
      setComposeData({ ...data, cc: data.cc.filter((t) => t !== val) });
    } else if (type === 'bcc') {
      setComposeData({ ...data, bcc: data.bcc.filter((t) => t !== val) });
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const newAttachments: EmailAttachment[] = Array.from(files).map((f) => ({
      id: `att-${Date.now()}-${f.name}`,
      name: f.name,
      size: `${(f.size / 1024).toFixed(1)} KB`,
      type: f.name.endsWith('.pdf') ? 'pdf' : f.name.endsWith('.png') || f.name.endsWith('.jpg') ? 'image' : 'doc',
    }));

    setComposeData({
      ...data,
      attachments: [...data.attachments, ...newAttachments],
    });
  };

  const handleSend = async (isScheduled: boolean = false) => {
    const finalTo = [...data.to];
    if (toInput.trim() && !finalTo.includes(toInput.trim())) {
      finalTo.push(toInput.trim());
    }

    if (finalTo.length === 0) {
      alert('Please specify at least one recipient.');
      return;
    }

    setIsSending(true);
    await sendEmail({
      ...data,
      to: finalTo,
      isScheduled,
    });
    setIsSending(false);
  };

  return (
    <div
      className={`fixed z-50 transition-all duration-200 shadow-2xl border border-neutral-300 dark:border-[#383838] bg-white dark:bg-[#212121] flex flex-col ${
        /* Mobile: ALWAYS 100% full screen */
        'inset-0 sm:inset-auto'
      } ${
        isMaximized
          ? 'sm:inset-6 sm:rounded-2xl'
          : isMinimized
          ? 'sm:bottom-0 sm:right-16 sm:w-72 sm:h-11 sm:rounded-t-xl sm:overflow-hidden'
          : 'sm:bottom-0 sm:right-16 sm:w-[580px] sm:h-[540px] sm:rounded-t-2xl sm:overflow-hidden'
      }`}
    >
      {/* =========================================================================
          A. MOBILE TOP BAR (Native Gmail Style)
      ========================================================================= */}
      <div className="sm:hidden h-14 px-3 bg-white dark:bg-[#212121] border-b border-neutral-200 dark:border-[#333333] flex items-center justify-between select-none">
        <div className="flex items-center gap-3">
          <button
            onClick={closeCompose}
            className="w-10 h-10 flex items-center justify-center rounded-full text-neutral-600 dark:text-neutral-300"
            aria-label="Back"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <span className="text-base font-bold text-neutral-900 dark:text-white">
            Compose
          </span>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="w-10 h-10 flex items-center justify-center rounded-full text-neutral-600 dark:text-neutral-300"
            aria-label="Attach file"
          >
            <Paperclip className="w-5 h-5" />
          </button>

          <button
            onClick={() => handleSend(false)}
            disabled={isSending}
            className="w-10 h-10 flex items-center justify-center rounded-full text-[#0494f4] disabled:opacity-50"
            aria-label="Send email"
          >
            <Send className="w-5 h-5 fill-current" />
          </button>
        </div>
      </div>

      {/* =========================================================================
          B. DESKTOP DOCK HEADER (Classic Gmail Floating Box)
      ========================================================================= */}
      <div
        className="hidden sm:flex h-11 px-4 bg-neutral-100 dark:bg-[#282828] border-b border-neutral-200 dark:border-[#333333] items-center justify-between cursor-pointer select-none"
        onClick={isMinimized ? minimizeCompose : undefined}
      >
        <span className="text-xs font-bold text-neutral-800 dark:text-neutral-200 truncate">
          {data.subject ? data.subject : 'New Message'}
        </span>

        <div className="flex items-center gap-1">
          <button
            onClick={(e) => {
              e.stopPropagation();
              minimizeCompose();
            }}
            className="p-1 rounded hover:bg-neutral-200 dark:hover:bg-[#383838] text-neutral-600 dark:text-neutral-300"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={(e) => {
              e.stopPropagation();
              maximizeCompose();
            }}
            className="p-1 rounded hover:bg-neutral-200 dark:hover:bg-[#383838] text-neutral-600 dark:text-neutral-300"
          >
            {isMaximized ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>

          <button
            onClick={(e) => {
              e.stopPropagation();
              closeCompose();
            }}
            className="p-1 rounded hover:bg-neutral-200 dark:hover:bg-[#383838] text-neutral-600 dark:text-neutral-300"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* =========================================================================
          COMPOSE FORM FIELDS
      ========================================================================= */}
      {(!isMinimized || window.innerWidth < 640) && (
        <div className="flex-1 flex flex-col overflow-hidden bg-white dark:bg-[#212121]">
          {/* From indicator on Mobile */}
          <div className="sm:hidden flex items-center px-4 py-2.5 border-b border-neutral-100 dark:border-[#2e2e2e] text-xs">
            <span className="text-neutral-400 font-medium w-12">From</span>
            <span className="font-semibold text-neutral-800 dark:text-neutral-200">
              {currentUser.email}
            </span>
          </div>

          {/* To field */}
          <div className="flex flex-wrap items-center gap-1.5 px-4 py-2 border-b border-neutral-100 dark:border-[#2e2e2e] min-h-[44px]">
            <span className="text-xs font-medium text-neutral-400 w-12 sm:w-10">To</span>

            {data.to.map((recipient) => (
              <span
                key={recipient}
                className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-[#0494f4]/15 text-[#0494f4] text-xs font-semibold"
              >
                {recipient}
                <button
                  type="button"
                  onClick={() => handleRemoveRecipient('to', recipient)}
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}

            <input
              type="email"
              value={toInput}
              onChange={(e) => setToInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ',') {
                  e.preventDefault();
                  handleAddRecipient('to', toInput);
                }
              }}
              onBlur={() => handleAddRecipient('to', toInput)}
              placeholder={data.to.length === 0 ? 'Recipients' : ''}
              className="flex-1 min-w-[120px] bg-transparent text-sm text-neutral-900 dark:text-white focus:outline-none"
            />

            <div className="flex items-center gap-2 text-xs font-semibold text-neutral-500">
              {!showCc && (
                <button type="button" onClick={() => setShowCc(true)} className="hover:text-[#0494f4]">
                  Cc
                </button>
              )}
              {!showBcc && (
                <button type="button" onClick={() => setShowBcc(true)} className="hover:text-[#0494f4]">
                  Bcc
                </button>
              )}
            </div>
          </div>

          {/* Cc field */}
          {showCc && (
            <div className="flex flex-wrap items-center gap-1.5 px-4 py-2 border-b border-neutral-100 dark:border-[#2e2e2e] min-h-[40px]">
              <span className="text-xs font-medium text-neutral-400 w-12 sm:w-10">Cc</span>
              {data.cc.map((recipient) => (
                <span
                  key={recipient}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#0494f4]/15 text-[#0494f4] text-xs font-semibold"
                >
                  {recipient}
                  <button type="button" onClick={() => handleRemoveRecipient('cc', recipient)}>
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
              <input
                type="email"
                value={ccInput}
                onChange={(e) => setCcInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ',') {
                    e.preventDefault();
                    handleAddRecipient('cc', ccInput);
                  }
                }}
                onBlur={() => handleAddRecipient('cc', ccInput)}
                placeholder="Carbon copy"
                className="flex-1 min-w-[120px] bg-transparent text-sm text-neutral-900 dark:text-white focus:outline-none"
              />
            </div>
          )}

          {/* Bcc field */}
          {showBcc && (
            <div className="flex flex-wrap items-center gap-1.5 px-4 py-2 border-b border-neutral-100 dark:border-[#2e2e2e] min-h-[40px]">
              <span className="text-xs font-medium text-neutral-400 w-12 sm:w-10">Bcc</span>
              {data.bcc.map((recipient) => (
                <span
                  key={recipient}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#0494f4]/15 text-[#0494f4] text-xs font-semibold"
                >
                  {recipient}
                  <button type="button" onClick={() => handleRemoveRecipient('bcc', recipient)}>
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
              <input
                type="email"
                value={bccInput}
                onChange={(e) => setBccInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ',') {
                    e.preventDefault();
                    handleAddRecipient('bcc', bccInput);
                  }
                }}
                onBlur={() => handleAddRecipient('bcc', bccInput)}
                placeholder="Blind carbon copy"
                className="flex-1 min-w-[120px] bg-transparent text-sm text-neutral-900 dark:text-white focus:outline-none"
              />
            </div>
          )}

          {/* Subject field */}
          <div className="px-4 py-2.5 border-b border-neutral-100 dark:border-[#2e2e2e]">
            <input
              type="text"
              value={data.subject}
              onChange={(e) => setComposeData({ ...data, subject: e.target.value })}
              placeholder="Subject"
              className="w-full bg-transparent text-sm font-medium text-neutral-900 dark:text-white focus:outline-none"
            />
          </div>

          {/* Body editor */}
          <div className="flex-1 p-4 overflow-y-auto">
            <textarea
              value={data.body}
              onChange={(e) => setComposeData({ ...data, body: e.target.value })}
              placeholder="Compose email"
              className="w-full h-full bg-transparent resize-none text-sm text-neutral-900 dark:text-neutral-100 focus:outline-none leading-relaxed"
            />
          </div>

          {/* Attached Files List */}
          {data.attachments.length > 0 && (
            <div className="px-4 py-2 border-t border-neutral-100 dark:border-[#2e2e2e] flex flex-wrap gap-2">
              {data.attachments.map((att) => (
                <div
                  key={att.id}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-neutral-200 dark:border-[#383838] bg-neutral-50 dark:bg-[#282828] text-xs"
                >
                  <Paperclip className="w-3 h-3 text-[#0494f4]" />
                  <span className="font-medium text-neutral-800 dark:text-neutral-200 truncate max-w-[120px]">
                    {att.name}
                  </span>
                  <span className="text-[10px] text-neutral-400 font-mono">{att.size}</span>
                  <button
                    onClick={() =>
                      setComposeData({
                        ...data,
                        attachments: data.attachments.filter((a) => a.id !== att.id),
                      })
                    }
                    className="p-0.5 text-neutral-400 hover:text-neutral-900"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Hidden File Input */}
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileUpload}
            multiple
            className="hidden"
          />

          {/* Desktop Bottom Toolbar */}
          <div className="hidden sm:flex px-4 py-2.5 border-t border-neutral-200 dark:border-[#333333] items-center justify-between bg-neutral-50/60 dark:bg-[#262626]">
            <div className="flex items-center gap-2">
              <div className="inline-flex rounded-xl overflow-hidden shadow-sm shadow-[#0494f4]/20">
                <button
                  type="button"
                  onClick={() => handleSend(false)}
                  disabled={isSending}
                  className="flex items-center gap-2 px-5 py-2.5 bg-[#0494f4] hover:bg-[#0382d6] text-white text-xs font-bold transition-colors disabled:opacity-50"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>Send</span>
                </button>
                <button
                  type="button"
                  onClick={() => setIsScheduleMenuOpen(!isScheduleMenuOpen)}
                  className="px-2 py-2.5 bg-[#0494f4] hover:bg-[#0382d6] border-l border-white/20 text-white"
                  title="Schedule send"
                >
                  <ChevronDown className="w-3.5 h-3.5" />
                </button>
              </div>

              {isScheduleMenuOpen && (
                <div className="absolute left-6 bottom-14 w-48 bg-white dark:bg-[#2a2a2a] border border-neutral-200 dark:border-[#383838] rounded-xl shadow-xl py-1.5 z-50 text-xs">
                  <span className="block px-3 py-1 font-semibold text-neutral-400 text-[10px] uppercase">
                    Schedule Send
                  </span>
                  <button
                    onClick={() => {
                      setIsScheduleMenuOpen(false);
                      handleSend(true);
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-neutral-100 dark:hover:bg-[#333333] flex items-center justify-between"
                  >
                    <span>Tomorrow morning</span>
                    <span className="text-[10px] text-neutral-400 font-mono">8:00 AM</span>
                  </button>
                </div>
              )}

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="p-1.5 rounded-lg hover:bg-neutral-200 dark:hover:bg-[#383838] text-[#0494f4]"
                title="Attach files"
              >
                <Paperclip className="w-4 h-4" />
              </button>
            </div>

            <button
              type="button"
              onClick={closeCompose}
              className="p-2 rounded-lg hover:bg-neutral-200 dark:hover:bg-[#383838] text-neutral-500"
              title="Discard draft"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
