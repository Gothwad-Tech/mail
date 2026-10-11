import React, { useState } from 'react';
import { ArrowLeft, Trash2, Mail, Star, Printer, Forward, Reply, Send, Paperclip } from 'lucide-react';
import { useMail } from '../context/MailContext';

// Email HTML is untrusted. We render it in an iframe with:
//   - sandbox without allow-scripts/allow-same-origin -> no scripts, no access to this app.
//   - a CSP that blocks scripts, objects and frames; only images/styles are allowed.
// This keeps malicious HTML away from the Mail session and cookies.
const EMAIL_CSP =
  "default-src 'none'; img-src https: data: cid:; style-src 'unsafe-inline'; font-src https: data:; media-src https: data:";

function buildSrcDoc(html: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${EMAIL_CSP}"><base target="_blank"><style>html,body{margin:0;padding:16px;background:#fff;color:#111;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:14px;line-height:1.6;word-wrap:break-word;}img{max-width:100%;height:auto;}</style></head><body>${html}</body></html>`;
}

export const EmailDetail: React.FC = () => {
  const {
    selectedEmail,
    isLoadingSelected,
    setSelectedEmailId,
    deleteEmails,
    markAsRead,
    toggleStar,
    sendEmail,
    openCompose,
    currentFolder,
  } = useMail();

  const [replyBody, setReplyBody] = useState('');
  const [isSendingReply, setIsSendingReply] = useState(false);
  const [isReplyOpen, setIsReplyOpen] = useState(false);

  if (!selectedEmail) {
    return (
      <div className="flex-1 flex items-center justify-center h-full bg-white dark:bg-[#212121] text-neutral-400">
        <p className="text-sm">Select a conversation to read</p>
      </div>
    );
  }

  const isTrash = currentFolder === 'trash';
  // Replying to a message you sent goes back to its recipients.
  const replyTo = selectedEmail.folder === 'sent' ? selectedEmail.toRecipients : [selectedEmail.senderEmail];

  const handleSendReply = async () => {
    if (!replyBody.trim() || replyTo.length === 0) return;
    setIsSendingReply(true);
    const ok = await sendEmail({
      to: replyTo,
      cc: [],
      bcc: [],
      subject: /^re:/i.test(selectedEmail.subject) ? selectedEmail.subject : `Re: ${selectedEmail.subject}`,
      body: replyBody,
    });
    setIsSendingReply(false);
    if (ok) {
      setReplyBody('');
      setIsReplyOpen(false);
    }
  };

  const handleForward = () => {
    openCompose({
      subject: /^fwd:/i.test(selectedEmail.subject) ? selectedEmail.subject : `Fwd: ${selectedEmail.subject}`,
      body: `\n\n---------- Forwarded message ----------\nFrom: ${selectedEmail.senderEmail}\nSubject: ${selectedEmail.subject}\n\n${selectedEmail.bodyText}`,
    });
  };

  const handlePrint = () => window.print();

  const dateLabel = new Date(selectedEmail.timestamp).toLocaleString([], {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  return (
    <div className="flex-1 flex flex-col h-full bg-white dark:bg-[#212121] overflow-hidden select-none">
      {/* ----- Action bar ----- */}
      <div className="h-12 border-b border-neutral-200 dark:border-[#333333] px-3 sm:px-4 flex items-center justify-between shrink-0">
        <button
          onClick={() => setSelectedEmailId(null)}
          className="flex items-center justify-center w-10 h-10 rounded-full hover:bg-neutral-100 dark:hover:bg-[#2e2e2e] text-neutral-600 dark:text-neutral-300"
          title="Back"
          aria-label="Back to conversations list"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-1">
          <button
            onClick={() => toggleStar(selectedEmail.id)}
            className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-neutral-100 dark:hover:bg-[#2e2e2e]"
            title={selectedEmail.isStarred ? 'Unstar' : 'Star'}
            aria-label={selectedEmail.isStarred ? 'Unstar' : 'Star'}
          >
            <Star
              className={`w-4 h-4 ${selectedEmail.isStarred ? 'fill-amber-400 text-amber-400' : 'text-neutral-400'}`}
            />
          </button>
          <button
            onClick={() => markAsRead([selectedEmail.id], false)}
            className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-neutral-100 dark:hover:bg-[#2e2e2e] text-neutral-600 dark:text-neutral-300"
            title="Mark unread"
            aria-label="Mark unread"
          >
            <Mail className="w-4 h-4" />
          </button>
          <button
            onClick={handlePrint}
            className="hidden md:flex w-9 h-9 items-center justify-center rounded-full hover:bg-neutral-100 dark:hover:bg-[#2e2e2e] text-neutral-600 dark:text-neutral-300"
            title="Print"
            aria-label="Print"
          >
            <Printer className="w-4 h-4" />
          </button>
          <button
            onClick={() => deleteEmails([selectedEmail.id])}
            className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-neutral-100 dark:hover:bg-[#2e2e2e] text-neutral-600 dark:text-neutral-300"
            title={isTrash ? 'Delete forever' : 'Move to Trash'}
            aria-label={isTrash ? 'Delete forever' : 'Move to Trash'}
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* ----- Header ----- */}
      <div className="px-4 sm:px-6 pt-4 pb-3 border-b border-neutral-100 dark:border-[#2e2e2e] shrink-0">
        <h2 className="text-lg font-bold text-neutral-900 dark:text-white break-words">
          {selectedEmail.subject || '(no subject)'}
        </h2>
        <div className="mt-2 flex items-start gap-3">
          <div className="w-9 h-9 rounded-full bg-[#0494f4] text-white flex items-center justify-center font-bold text-sm shrink-0">
            {(selectedEmail.senderName || '?').charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 text-xs text-neutral-500 dark:text-neutral-400">
            <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 truncate">
              {selectedEmail.senderName}{' '}
              <span className="font-normal text-neutral-500">&lt;{selectedEmail.senderEmail}&gt;</span>
            </p>
            <p className="truncate">To: {selectedEmail.toRecipients.join(', ') || '(none)'}</p>
            {selectedEmail.ccRecipients.length > 0 && (
              <p className="truncate">Cc: {selectedEmail.ccRecipients.join(', ')}</p>
            )}
            <p>{dateLabel}</p>
          </div>
        </div>
      </div>

      {/* ----- Body ----- */}
      <div className="flex-1 min-h-0 overflow-y-auto select-text">
        {isLoadingSelected && !selectedEmail.bodyText && !selectedEmail.bodyHtml ? (
          <p className="p-6 text-sm text-neutral-500">Loading message…</p>
        ) : selectedEmail.bodyHtml ? (
          <iframe
            title="Message body"
            // No allow-scripts: scripts stay off. Popups are allowed only so links open in a new tab.
            sandbox="allow-popups allow-popups-to-escape-sandbox"
            srcDoc={buildSrcDoc(selectedEmail.bodyHtml)}
            className="w-full h-[60vh] min-h-[320px] bg-white border-0"
          />
        ) : (
          <div className="p-4 sm:p-6 text-sm leading-relaxed text-neutral-800 dark:text-neutral-200 whitespace-pre-wrap break-words select-text">
            {selectedEmail.bodyText || '(empty message)'}
          </div>
        )}

        {selectedEmail.attachments.length > 0 && (
          <div className="px-4 sm:px-6 pb-4">
            <p className="text-xs font-semibold text-neutral-500 mb-2">
              {selectedEmail.attachments.length} attachment{selectedEmail.attachments.length > 1 ? 's' : ''}
            </p>
            <div className="flex flex-wrap gap-2">
              {selectedEmail.attachments.map((att, i) => (
                <div
                  key={`${att.name}-${i}`}
                  className="flex items-center gap-2 px-3 py-2 rounded-xl border border-neutral-200 dark:border-[#383838] bg-neutral-50 dark:bg-[#282828] text-xs"
                >
                  <Paperclip className="w-3.5 h-3.5 text-[#0494f4]" />
                  <span className="font-medium text-neutral-800 dark:text-neutral-200 truncate max-w-[200px]">
                    {att.name}
                  </span>
                  <span className="text-[10px] text-neutral-400 font-mono">{att.size}</span>
                </div>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-neutral-400">
              Attachment files are not stored yet. Only their names and sizes are shown.
            </p>
          </div>
        )}
      </div>

      {/* ----- Reply / forward ----- */}
      <div className="border-t border-neutral-200 dark:border-[#333333] px-4 sm:px-6 py-3 shrink-0">
        {!isReplyOpen ? (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsReplyOpen(true)}
              disabled={replyTo.length === 0}
              className="flex items-center gap-2 px-4 py-2 rounded-full border border-neutral-200 dark:border-[#383838] text-xs font-semibold text-neutral-700 dark:text-neutral-200 hover:bg-neutral-50 dark:hover:bg-[#282828] disabled:opacity-50"
            >
              <Reply className="w-3.5 h-3.5" /> Reply
            </button>
            <button
              onClick={handleForward}
              className="flex items-center gap-2 px-4 py-2 rounded-full border border-neutral-200 dark:border-[#383838] text-xs font-semibold text-neutral-700 dark:text-neutral-200 hover:bg-neutral-50 dark:hover:bg-[#282828]"
            >
              <Forward className="w-3.5 h-3.5" /> Forward
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-neutral-500">
              Reply to <span className="font-semibold">{replyTo.join(', ')}</span>
            </p>
            <textarea
              value={replyBody}
              onChange={(e) => setReplyBody(e.target.value)}
              rows={4}
              autoFocus
              placeholder="Write your reply..."
              className="w-full p-3 rounded-xl border border-neutral-200 dark:border-[#383838] bg-white dark:bg-[#1e1e1e] text-sm text-neutral-900 dark:text-neutral-100 focus:outline-none focus:border-[#0494f4]"
            />
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setIsReplyOpen(false)}
                className="px-4 py-2 text-xs font-medium rounded-xl hover:bg-neutral-100 dark:hover:bg-[#2e2e2e]"
              >
                Cancel
              </button>
              <button
                onClick={handleSendReply}
                disabled={isSendingReply || !replyBody.trim()}
                className="flex items-center gap-2 px-5 py-2 rounded-xl bg-[#0494f4] hover:bg-[#0382d6] text-white text-xs font-bold disabled:opacity-50"
              >
                <Send className="w-3.5 h-3.5" /> {isSendingReply ? 'Sending…' : 'Send'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
