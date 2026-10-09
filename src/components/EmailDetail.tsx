import React, { useState } from 'react';
import {
  ArrowLeft,
  Archive,
  Trash2,
  Mail,
  Clock,
  Star,
  Tag,
  FolderInput,
  Printer,
  MoreVertical,
  Reply,
  ReplyAll,
  Forward,
  ShieldCheck,
  ChevronDown,
  Paperclip,
  Download,
  Send,
  X,
} from 'lucide-react';
import { useMail } from '../context/MailContext';
import { EmailFolder } from '../types/email';

export const EmailDetail: React.FC = () => {
  const {
    selectedEmail,
    setSelectedEmailId,
    archiveEmails,
    deleteEmails,
    markAsRead,
    snoozeEmails,
    toggleStar,
    moveToFolder,
    addLabelToEmails,
    labels,
    sendEmail,
    showToast,
  } = useMail();

  const [isDetailsExpanded, setIsDetailsExpanded] = useState(false);
  const [isMoveMenuOpen, setIsMoveMenuOpen] = useState(false);
  const [isLabelMenuOpen, setIsLabelMenuOpen] = useState(false);
  const [isMobileMoreOpen, setIsMobileMoreOpen] = useState(false);
  const [isReplyOpen, setIsReplyOpen] = useState(false);
  const [replyMode, setReplyMode] = useState<'reply' | 'forward'>('reply');
  const [replyBody, setReplyBody] = useState('');
  const [isSendingReply, setIsSendingReply] = useState(false);

  if (!selectedEmail) {
    return (
      <div className="flex-1 flex items-center justify-center h-full bg-white dark:bg-[#212121] text-neutral-400">
        <p className="text-sm">Select a conversation to read</p>
      </div>
    );
  }

  const handleSendReply = async () => {
    if (!replyBody.trim()) return;
    setIsSendingReply(true);
    await sendEmail({
      to: [selectedEmail.senderEmail],
      cc: [],
      bcc: [],
      subject: replyMode === 'reply' ? `Re: ${selectedEmail.subject}` : `Fwd: ${selectedEmail.subject}`,
      body: replyBody,
      attachments: [],
      category: selectedEmail.category,
    });
    setReplyBody('');
    setIsReplyOpen(false);
    setIsSendingReply(false);
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-white dark:bg-[#212121] overflow-hidden select-none">
      {/* =========================================================================
          TOP ACTION BAR (Clean Mobile 4-Action Bar vs Desktop Toolbar)
      ========================================================================= */}
      <div className="h-12 border-b border-neutral-200 dark:border-[#333333] px-3 sm:px-4 flex items-center justify-between shrink-0 bg-white dark:bg-[#212121]">
        {/* Left: Back Arrow */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => setSelectedEmailId(null)}
            className="flex items-center justify-center w-10 h-10 rounded-full hover:bg-neutral-100 dark:hover:bg-[#2e2e2e] text-neutral-600 dark:text-neutral-300 transition-colors"
            title="Back"
            aria-label="Back to conversations list"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
        </div>

        {/* Right Actions: Mobile has 4 clean icons; Desktop has full toolbar */}
        <div className="flex items-center gap-1 sm:gap-2">
          <button
            onClick={() => archiveEmails([selectedEmail.id])}
            className="w-9 h-9 sm:w-10 sm:h-10 flex items-center justify-center rounded-full hover:bg-neutral-100 dark:hover:bg-[#2e2e2e] text-neutral-600 dark:text-neutral-300 transition-colors"
            title="Archive"
            aria-label="Archive conversation"
          >
            <Archive className="w-4 h-4 sm:w-4.5 sm:h-4.5" />
          </button>

          <button
            onClick={() => deleteEmails([selectedEmail.id])}
            className="w-9 h-9 sm:w-10 sm:h-10 flex items-center justify-center rounded-full hover:bg-neutral-100 dark:hover:bg-[#2e2e2e] text-neutral-600 dark:text-neutral-300 transition-colors"
            title="Delete"
            aria-label="Delete conversation"
          >
            <Trash2 className="w-4 h-4 sm:w-4.5 sm:h-4.5" />
          </button>

          <button
            onClick={() => markAsRead([selectedEmail.id], false)}
            className="w-9 h-9 sm:w-10 sm:h-10 flex items-center justify-center rounded-full hover:bg-neutral-100 dark:hover:bg-[#2e2e2e] text-neutral-600 dark:text-neutral-300 transition-colors"
            title="Mark unread"
            aria-label="Mark unread"
          >
            <Mail className="w-4 h-4 sm:w-4.5 sm:h-4.5" />
          </button>

          {/* Desktop Only Buttons: Snooze, Move, Label, Print */}
          <div className="hidden md:flex items-center gap-1">
            <button
              onClick={() => snoozeEmails([selectedEmail.id])}
              className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-neutral-100 dark:hover:bg-[#2e2e2e] text-neutral-600 dark:text-neutral-300 transition-colors"
              title="Snooze"
            >
              <Clock className="w-4.5 h-4.5" />
            </button>

            {/* Move to folder */}
            <div className="relative">
              <button
                onClick={() => setIsMoveMenuOpen(!isMoveMenuOpen)}
                className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-neutral-100 dark:hover:bg-[#2e2e2e] text-neutral-600 dark:text-neutral-300 transition-colors"
                title="Move to..."
              >
                <FolderInput className="w-4.5 h-4.5" />
              </button>
              {isMoveMenuOpen && (
                <div className="absolute left-0 top-11 w-44 bg-white dark:bg-[#262626] border border-neutral-200 dark:border-[#383838] rounded-xl shadow-lg py-1.5 z-40 text-xs">
                  {(['inbox', 'archive', 'trash', 'spam'] as EmailFolder[]).map((f) => (
                    <button
                      key={f}
                      onClick={() => {
                        moveToFolder([selectedEmail.id], f);
                        setIsMoveMenuOpen(false);
                      }}
                      className="w-full text-left px-3 py-1.5 capitalize hover:bg-neutral-100 dark:hover:bg-[#333333] text-neutral-800 dark:text-neutral-200"
                    >
                      Move to {f}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Labels */}
            <div className="relative">
              <button
                onClick={() => setIsLabelMenuOpen(!isLabelMenuOpen)}
                className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-neutral-100 dark:hover:bg-[#2e2e2e] text-neutral-600 dark:text-neutral-300 transition-colors"
                title="Labels"
              >
                <Tag className="w-4.5 h-4.5" />
              </button>
              {isLabelMenuOpen && (
                <div className="absolute left-0 top-11 w-44 bg-white dark:bg-[#262626] border border-neutral-200 dark:border-[#383838] rounded-xl shadow-lg py-1.5 z-40 text-xs">
                  {labels.map((lbl) => (
                    <button
                      key={lbl}
                      onClick={() => {
                        addLabelToEmails([selectedEmail.id], lbl);
                        setIsLabelMenuOpen(false);
                      }}
                      className="w-full text-left px-3 py-1.5 hover:bg-neutral-100 dark:hover:bg-[#333333] text-neutral-800 dark:text-neutral-200"
                    >
                      {lbl}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <button
              onClick={handlePrint}
              className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-neutral-100 dark:hover:bg-[#2e2e2e] text-neutral-600 dark:text-neutral-300 transition-colors"
              title="Print email"
            >
              <Printer className="w-4.5 h-4.5" />
            </button>

            <button
              onClick={() => toggleStar(selectedEmail.id)}
              className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-neutral-100 dark:hover:bg-[#2e2e2e] transition-colors"
              title={selectedEmail.isStarred ? 'Unstar' : 'Star'}
            >
              <Star
                className={`w-4.5 h-4.5 ${
                  selectedEmail.isStarred
                    ? 'fill-[#0494f4] text-[#0494f4]'
                    : 'text-neutral-400'
                }`}
              />
            </button>
          </div>

          {/* Mobile Overflow Menu Button */}
          <div className="relative md:hidden">
            <button
              onClick={() => setIsMobileMoreOpen(!isMobileMoreOpen)}
              className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-neutral-100 dark:hover:bg-[#2e2e2e] text-neutral-600 dark:text-neutral-300 transition-colors"
              aria-label="More options"
            >
              <MoreVertical className="w-4.5 h-4.5" />
            </button>

            {isMobileMoreOpen && (
              <div className="absolute right-0 top-10 w-48 bg-white dark:bg-[#262626] border border-neutral-200 dark:border-[#383838] rounded-xl shadow-xl py-1 z-50 text-xs">
                <button
                  onClick={() => {
                    toggleStar(selectedEmail.id);
                    setIsMobileMoreOpen(false);
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-neutral-100 dark:hover:bg-[#333333] flex items-center gap-2.5"
                >
                  <Star className={`w-4 h-4 ${selectedEmail.isStarred ? 'text-[#0494f4] fill-[#0494f4]' : ''}`} />
                  <span>{selectedEmail.isStarred ? 'Unstar' : 'Add star'}</span>
                </button>
                <button
                  onClick={() => {
                    snoozeEmails([selectedEmail.id]);
                    setIsMobileMoreOpen(false);
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-neutral-100 dark:hover:bg-[#333333] flex items-center gap-2.5"
                >
                  <Clock className="w-4 h-4" />
                  <span>Snooze</span>
                </button>
                <button
                  onClick={() => {
                    handlePrint();
                    setIsMobileMoreOpen(false);
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-neutral-100 dark:hover:bg-[#333333] flex items-center gap-2.5"
                >
                  <Printer className="w-4 h-4" />
                  <span>Print</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* =========================================================================
          EMAIL CONTENT SCROLLABLE BODY
      ========================================================================= */}
      <div className="flex-1 overflow-y-auto no-scrollbar px-3.5 sm:px-8 py-4 sm:py-6">
        {/* Subject Title */}
        <div className="mb-4 pb-3 border-b border-neutral-100 dark:border-[#2e2e2e]">
          <div className="flex items-start justify-between gap-3">
            <h2 className="text-lg sm:text-2xl font-bold text-neutral-900 dark:text-white leading-snug">
              {selectedEmail.subject}
            </h2>
            <span className="text-[10px] sm:text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded border border-neutral-200 dark:border-[#383838] text-neutral-500 shrink-0">
              {selectedEmail.category}
            </span>
          </div>

          {/* Labels */}
          {selectedEmail.labels && selectedEmail.labels.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 mt-2">
              {selectedEmail.labels.map((lbl) => (
                <span
                  key={lbl}
                  className="text-[10px] font-semibold px-2.5 py-0.5 rounded-full bg-[#0494f4]/15 text-[#0494f4]"
                >
                  {lbl}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Sender Details Header */}
        <div className="flex items-start justify-between gap-3 mb-5">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-full bg-[#0494f4] text-white flex items-center justify-center font-bold text-sm shrink-0 shadow-xs">
              {selectedEmail.senderName.substring(0, 2).toUpperCase()}
            </div>

            <div className="min-w-0">
              <div className="flex items-baseline gap-1.5 flex-wrap">
                <span className="font-bold text-sm sm:text-base text-neutral-900 dark:text-white truncate">
                  {selectedEmail.senderName}
                </span>
                <span className="text-[11px] sm:text-xs text-neutral-500 dark:text-neutral-400 truncate">
                  &lt;{selectedEmail.senderEmail}&gt;
                </span>
              </div>

              {/* "to me ▾" dropdown */}
              <button
                type="button"
                onClick={() => setIsDetailsExpanded(!isDetailsExpanded)}
                className="flex items-center gap-1 text-[11px] text-neutral-500 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200 mt-0.5"
              >
                <span>to {selectedEmail.toRecipients.join(', ')}</span>
                <ChevronDown className="w-3 h-3" />
              </button>

              {/* Expanded details */}
              {isDetailsExpanded && (
                <div className="mt-2 p-3 rounded-xl border border-neutral-200 dark:border-[#383838] bg-neutral-50 dark:bg-[#282828] text-xs space-y-1.5 shadow-xs max-w-sm">
                  <p>
                    <strong className="text-neutral-400 font-medium">From: </strong>
                    {selectedEmail.senderEmail}
                  </p>
                  <p>
                    <strong className="text-neutral-400 font-medium">To: </strong>
                    {selectedEmail.toRecipients.join(', ')}
                  </p>
                  <p>
                    <strong className="text-neutral-400 font-medium">Date: </strong>
                    {selectedEmail.dateFormatted}
                  </p>
                  <p className="flex items-center gap-1 text-[#0494f4] pt-1">
                    <ShieldCheck className="w-3.5 h-3.5" />
                    Standard TLS Encryption (Verified)
                  </p>
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <span className="text-xs text-neutral-400 tabular-nums">
              {selectedEmail.dateFormatted}
            </span>
            <button
              onClick={() => {
                setReplyMode('reply');
                setIsReplyOpen(true);
              }}
              className="p-1.5 rounded-full hover:bg-neutral-100 dark:hover:bg-[#2e2e2e] text-neutral-500"
              title="Reply"
            >
              <Reply className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Email HTML Body */}
        <div
          className="text-sm sm:text-base leading-relaxed text-neutral-800 dark:text-neutral-200 py-2 select-text"
          dangerouslySetInnerHTML={{ __html: selectedEmail.bodyHtml }}
        />

        {/* Attachments */}
        {selectedEmail.attachments && selectedEmail.attachments.length > 0 && (
          <div className="mt-6 pt-4 border-t border-neutral-100 dark:border-[#2e2e2e]">
            <h4 className="text-xs font-bold uppercase tracking-wider text-neutral-400 mb-3 flex items-center gap-1.5">
              <Paperclip className="w-3.5 h-3.5 text-[#0494f4]" />
              {selectedEmail.attachments.length} Attachment
              {selectedEmail.attachments.length > 1 ? 's' : ''}
            </h4>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
              {selectedEmail.attachments.map((att) => (
                <div
                  key={att.id}
                  className="flex items-center justify-between p-3 rounded-xl border border-neutral-200 dark:border-[#383838] bg-neutral-50 dark:bg-[#282828]"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-7 h-7 rounded-lg bg-[#0494f4]/15 flex items-center justify-center text-[#0494f4] shrink-0">
                      <Paperclip className="w-3.5 h-3.5" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-neutral-800 dark:text-neutral-200 truncate">
                        {att.name}
                      </p>
                      <p className="text-[10px] text-neutral-400 font-mono">{att.size}</p>
                    </div>
                  </div>

                  <button
                    onClick={() => showToast(`Downloaded "${att.name}"`)}
                    className="p-1.5 rounded hover:bg-neutral-200 dark:hover:bg-[#383838] text-[#0494f4]"
                    title="Download"
                  >
                    <Download className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* =========================================================================
            BOTTOM ACTION BUTTONS (Reply, Reply all, Forward)
        ========================================================================= */}
        {!isReplyOpen && (
          <div className="mt-8 pt-4 border-t border-neutral-100 dark:border-[#2e2e2e] flex flex-wrap items-center gap-2.5">
            <button
              onClick={() => {
                setReplyMode('reply');
                setIsReplyOpen(true);
              }}
              className="flex-1 sm:flex-initial flex items-center justify-center gap-2 px-5 py-2.5 rounded-full border border-neutral-300 dark:border-[#383838] hover:border-[#0494f4] dark:hover:border-[#0494f4] text-xs font-bold text-neutral-700 dark:text-neutral-200 min-h-[44px] transition-colors"
            >
              <Reply className="w-3.5 h-3.5 text-[#0494f4]" />
              Reply
            </button>

            <button
              onClick={() => {
                setReplyMode('reply');
                setIsReplyOpen(true);
              }}
              className="flex-1 sm:flex-initial flex items-center justify-center gap-2 px-5 py-2.5 rounded-full border border-neutral-300 dark:border-[#383838] hover:border-[#0494f4] dark:hover:border-[#0494f4] text-xs font-bold text-neutral-700 dark:text-neutral-200 min-h-[44px] transition-colors"
            >
              <ReplyAll className="w-3.5 h-3.5 text-[#0494f4]" />
              Reply all
            </button>

            <button
              onClick={() => {
                setReplyMode('forward');
                setIsReplyOpen(true);
              }}
              className="w-full sm:w-auto flex items-center justify-center gap-2 px-5 py-2.5 rounded-full border border-neutral-300 dark:border-[#383838] hover:border-[#0494f4] dark:hover:border-[#0494f4] text-xs font-bold text-neutral-700 dark:text-neutral-200 min-h-[44px] transition-colors"
            >
              <Forward className="w-3.5 h-3.5 text-[#0494f4]" />
              Forward
            </button>
          </div>
        )}

        {/* Inline Reply Editor */}
        {isReplyOpen && (
          <div className="mt-6 border border-neutral-200 dark:border-[#383838] rounded-2xl p-4 bg-neutral-50/50 dark:bg-[#262626]">
            <div className="flex items-center justify-between pb-2 mb-2 text-xs border-b border-neutral-200 dark:border-[#333333]">
              <span className="font-semibold text-neutral-700 dark:text-neutral-300 flex items-center gap-1.5">
                <Reply className="w-3.5 h-3.5 text-[#0494f4]" />
                {replyMode === 'reply' ? 'Reply to' : 'Forward to'} {selectedEmail.senderEmail}
              </span>
              <button
                onClick={() => setIsReplyOpen(false)}
                className="p-1 rounded text-neutral-400 hover:text-neutral-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <textarea
              value={replyBody}
              onChange={(e) => setReplyBody(e.target.value)}
              placeholder="Write your response..."
              rows={4}
              autoFocus
              className="w-full bg-white dark:bg-[#1f1f1f] border border-neutral-200 dark:border-[#383838] rounded-xl p-3 text-sm text-neutral-900 dark:text-white focus:outline-none focus:border-[#0494f4]"
            />

            <div className="flex items-center justify-between mt-3">
              <button
                onClick={handleSendReply}
                disabled={isSendingReply || !replyBody.trim()}
                className="flex items-center gap-2 px-5 py-2.5 bg-[#0494f4] hover:bg-[#0382d6] text-white text-xs font-bold rounded-xl transition-colors disabled:opacity-50 min-h-[44px]"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Send</span>
              </button>

              <button
                onClick={() => {
                  setReplyBody('');
                  setIsReplyOpen(false);
                }}
                className="p-2 rounded text-neutral-400 hover:text-neutral-600"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
