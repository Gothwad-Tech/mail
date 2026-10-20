// =============================================================================
// Pure helpers for the mail store: mapping an API message to the UI shape and
// small formatters. No React state here, so every hook can share them.
// =============================================================================

import type { ComposeData, EmailMessage } from '../types/email';
import { ApiError, type ApiMessage } from '../services/mailApi';

export function initials(name: string | null, username: string): string {
  const source = (name && name.trim()) || username;
  const parts = source.split(/[\s._-]+/).filter(Boolean);
  const letters = parts.length >= 2 ? parts[0][0] + parts[1][0] : source.slice(0, 2);
  return letters.toUpperCase();
}

export function formatListDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Map the API shape to the shape the UI components use. */
export function toEmailMessage(m: ApiMessage): EmailMessage {
  return {
    id: m.id,
    senderName: m.from.name || m.from.email,
    senderEmail: m.from.email,
    toRecipients: m.to,
    ccRecipients: m.cc,
    bccRecipients: m.bcc,
    subject: m.subject,
    snippet: m.snippet,
    bodyHtml: m.bodyHtml ?? '',
    bodyText: m.bodyText ?? '',
    timestamp: m.receivedAt,
    dateFormatted: formatListDate(m.receivedAt),
    isRead: m.isRead,
    isStarred: m.isStarred,
    isDraft: m.folder === 'drafts',
    folder: m.folder,
    attachments: m.attachments.map((a) => ({ name: a.name, size: formatBytes(a.size), type: a.type })),
  };
}

export function toComposeData(m: EmailMessage): ComposeData {
  return {
    id: m.id,
    to: m.toRecipients,
    cc: m.ccRecipients,
    bcc: m.bccRecipients,
    subject: m.subject,
    body: m.bodyText,
  };
}

export function errorText(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return 'Something went wrong. Please try again.';
}
