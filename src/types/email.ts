// Types shared by the UI. The data comes from the Mail Worker API (see
// src/services/mailApi.ts); nothing here is demo data.

export type EmailFolder = 'inbox' | 'starred' | 'sent' | 'drafts' | 'trash';

export interface EmailAttachment {
  name: string;
  size: string;
  type: string;
}

export interface EmailMessage {
  id: string;
  senderName: string;
  senderEmail: string;
  toRecipients: string[];
  ccRecipients: string[];
  bccRecipients: string[];
  subject: string;
  snippet: string;
  /** Only filled when the full message is opened (detail endpoint). */
  bodyHtml: string;
  bodyText: string;
  timestamp: string; // ISO string from the server
  dateFormatted: string;
  isRead: boolean;
  isStarred: boolean;
  isDraft: boolean;
  folder: EmailFolder;
  attachments: EmailAttachment[];
}

export interface ComposeData {
  /** Set once the draft exists on the server. */
  id?: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  body: string;
}

export interface UserProfile {
  username: string;
  name: string | null;
  email: string;
  avatarText: string;
}
