export type EmailCategory = 'primary' | 'social' | 'promotions' | 'updates' | 'forums';

export type EmailFolder =
  | 'inbox'
  | 'starred'
  | 'snoozed'
  | 'sent'
  | 'drafts'
  | 'important'
  | 'scheduled'
  | 'all'
  | 'spam'
  | 'trash'
  | 'archive';

export interface EmailAttachment {
  id: string;
  name: string;
  size: string;
  type: 'pdf' | 'image' | 'csv' | 'archive' | 'doc';
  url?: string;
}

export interface EmailMessage {
  id: string;
  threadId: string;
  senderName: string;
  senderEmail: string;
  senderAvatar?: string;
  toRecipients: string[];
  ccRecipients?: string[];
  bccRecipients?: string[];
  subject: string;
  snippet: string;
  bodyHtml: string;
  bodyText: string;
  timestamp: string; // ISO string or human formatted
  dateFormatted: string;
  isRead: boolean;
  isStarred: boolean;
  isSnoozed: boolean;
  isArchived: boolean;
  isDeleted: boolean;
  isDraft: boolean;
  isSpam: boolean;
  isImportant?: boolean;
  category: EmailCategory;
  folder: EmailFolder;
  labels: string[];
  attachments?: EmailAttachment[];
  security?: {
    isEncrypted: boolean;
    spfVerified: boolean;
    dkimVerified: boolean;
  };
}

export interface ComposeData {
  id?: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  body: string;
  attachments: EmailAttachment[];
  category: EmailCategory;
  isScheduled?: boolean;
  scheduledTime?: string;
}

export interface SupabaseConfig {
  url: string;
  anonKey: string;
  isConnected: boolean;
  lastSync?: string;
  autoSync: boolean;
}

export interface UserProfile {
  name: string;
  email: string;
  avatarText: string;
  storageUsedGb: number;
  storageTotalGb: number;
}
