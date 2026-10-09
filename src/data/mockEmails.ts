import { EmailMessage } from '../types/email';

export const INITIAL_EMAILS: EmailMessage[] = [
  {
    id: 'msg-001',
    threadId: 'thread-001',
    senderName: 'Supabase Platform',
    senderEmail: 'notifications@supabase.io',
    toRecipients: ['pwngtwd@gmail.com'],
    subject: 'Project "gothwad-mail" database initialized & PostgreSQL ready',
    snippet: 'Your Supabase instance is provisioned with PostgreSQL 15, Row Level Security, and Realtime Webhooks ready for Gothwad Mail...',
    bodyHtml: `
      <div style="font-family: inherit; line-height: 1.6;">
        <p>Hi Pawan,</p>
        <p>Great news! Your database instance for <strong>Gothwad Mail</strong> has been successfully set up on Supabase Cloud.</p>
        <div style="background-color: rgba(4, 148, 244, 0.08); border: 1px solid rgba(4, 148, 244, 0.3); padding: 16px; border-radius: 8px; margin: 16px 0;">
          <h4 style="margin: 0 0 8px 0; color: #0494f4; font-size: 15px; font-weight: 600;">Instance Status: Active & Operational</h4>
          <p style="margin: 0 0 6px 0; font-size: 13px;">Region: ap-south-1 (Mumbai / Asia)</p>
          <p style="margin: 0 0 6px 0; font-size: 13px;">Database: PostgreSQL 15.2 with Realtime replication</p>
          <p style="margin: 0; font-size: 13px;">Tables tracked: <code>emails</code>, <code>attachments</code>, <code>labels</code>, <code>drafts</code></p>
        </div>
        <p>You can run your initial migration script directly inside the SQL Editor or sync your local client using your Project URL and Anon API key.</p>
        <p>Feel free to configure the database credentials inside the <strong>Gothwad Mail Settings &gt; Supabase</strong> panel.</p>
        <p style="margin-top: 24px; color: #6b7280; font-size: 13px;">Best regards,<br/>The Supabase Database Infrastructure Team</p>
      </div>
    `,
    bodyText: 'Your Supabase instance is provisioned with PostgreSQL 15, Row Level Security, and Realtime Webhooks ready for Gothwad Mail...',
    timestamp: '2026-10-09T05:15:00Z',
    dateFormatted: '5:15 AM',
    isRead: false,
    isStarred: true,
    isSnoozed: false,
    isArchived: false,
    isDeleted: false,
    isDraft: false,
    isSpam: false,
    isImportant: true,
    category: 'primary',
    folder: 'inbox',
    labels: ['Supabase Dev', 'Work'],
    attachments: [
      {
        id: 'att-1',
        name: 'supabase_schema_gothwad_mail.sql',
        size: '14.2 KB',
        type: 'doc',
      },
      {
        id: 'att-2',
        name: 'architecture_diagram.pdf',
        size: '1.8 MB',
        type: 'pdf',
      },
    ],
    security: {
      isEncrypted: true,
      spfVerified: true,
      dkimVerified: true,
    },
  },
  {
    id: 'msg-002',
    threadId: 'thread-002',
    senderName: 'GitHub Notifications',
    senderEmail: 'notifications@github.com',
    toRecipients: ['pwngtwd@gmail.com'],
    subject: '[gothwad/mail-app] PR #42 merged: "Mobile responsive viewport & gesture navigation"',
    snippet: 'Pull request #42 has been successfully merged into main branch by Pawan Gothwad with 0 conflicts...',
    bodyHtml: `
      <div style="font-family: inherit; line-height: 1.6;">
        <p>Hello @pwngtwd,</p>
        <p>Pull Request <strong>#42: Mobile responsive viewport & gesture navigation</strong> has been approved and merged into <code>main</code> branch.</p>
        <ul style="margin: 12px 0; padding-left: 20px; font-size: 14px;">
          <li>Add bottom tab bar with 48px touch targets</li>
          <li>Implement slide-in navigation drawer for folders & labels</li>
          <li>Strict theme compliance with #0494f4 and dark mode #212121</li>
          <li>Keyboard shortcuts (c, j, k, e, #, s) enabled for desktop</li>
        </ul>
        <p style="margin-top: 16px;">All automated CI tests passed (14/14 checks verified).</p>
        <p style="color: #6b7280; font-size: 13px;">GitHub Actions automated build pipeline</p>
      </div>
    `,
    bodyText: 'Pull request #42 has been successfully merged into main branch by Pawan Gothwad with 0 conflicts...',
    timestamp: '2026-10-09T04:40:00Z',
    dateFormatted: '4:40 AM',
    isRead: false,
    isStarred: false,
    isSnoozed: false,
    isArchived: false,
    isDeleted: false,
    isDraft: false,
    isSpam: false,
    isImportant: true,
    category: 'updates',
    folder: 'inbox',
    labels: ['Work'],
    security: {
      isEncrypted: true,
      spfVerified: true,
      dkimVerified: true,
    },
  },
  {
    id: 'msg-003',
    threadId: 'thread-003',
    senderName: 'Vercel Deployment',
    senderEmail: 'deployments@vercel.com',
    toRecipients: ['pwngtwd@gmail.com'],
    subject: 'Production build successful: gothwad-mail.app is live on edge network',
    snippet: 'Deployment gothwad-mail-git-main was deployed to Production in 24 seconds with SSL certificate active...',
    bodyHtml: `
      <div style="font-family: inherit; line-height: 1.6;">
        <p>Your production deployment is ready.</p>
        <p><strong>Deployment URL:</strong> <a href="#" style="color: #0494f4;">https://gothwad-mail.app</a></p>
        <p><strong>Domain Status:</strong> SSL TLS 1.3 Active, Global Anycast Edge CDN</p>
        <div style="margin: 16px 0; padding: 12px; background-color: rgba(4, 148, 244, 0.05); border-radius: 6px;">
          <p style="margin: 0; font-size: 13px;">Performance Score: 100/100 | First Contentful Paint: 0.3s</p>
        </div>
      </div>
    `,
    bodyText: 'Deployment gothwad-mail-git-main was deployed to Production in 24 seconds with SSL certificate active...',
    timestamp: '2026-10-09T03:20:00Z',
    dateFormatted: '3:20 AM',
    isRead: true,
    isStarred: false,
    isSnoozed: false,
    isArchived: false,
    isDeleted: false,
    isDraft: false,
    isSpam: false,
    category: 'updates',
    folder: 'inbox',
    labels: ['Supabase Dev'],
    security: {
      isEncrypted: true,
      spfVerified: true,
      dkimVerified: true,
    },
  },
  {
    id: 'msg-004',
    threadId: 'thread-004',
    senderName: 'Devendra Sharma',
    senderEmail: 'devendra.sharma@techcorp.io',
    toRecipients: ['pwngtwd@gmail.com'],
    subject: 'Review on Gothwad Mail Architecture & Supabase Schema sync',
    snippet: 'Pawan bhai, I reviewed the database ER diagram. The way we decoupled the Supabase backend with offline local storage is brilliant...',
    bodyHtml: `
      <div style="font-family: inherit; line-height: 1.6;">
        <p>Hey Pawan,</p>
        <p>I reviewed the database ER diagram you drafted for Gothwad Mail. The table structure with <code>emails</code>, <code>attachments</code>, and <code>labels</code> looks super clean.</p>
        <p>Here are two quick suggestions for the next iteration:</p>
        <ol style="margin: 12px 0; padding-left: 20px;">
          <li>We can use Supabase Database Webhooks so whenever a new email arrives in the table, it triggers an instant real-time push to the web app.</li>
          <li>For the mobile view, having the bottom navigation bar and the floating blue compose action button is really smooth.</li>
        </ol>
        <p>Let me know when you want to connect over a quick sync call today.</p>
        <p>Cheers,<br/>Devendra</p>
      </div>
    `,
    bodyText: 'Pawan bhai, I reviewed the database ER diagram. The way we decoupled the Supabase backend with offline local storage is brilliant...',
    timestamp: '2026-10-08T18:30:00Z',
    dateFormatted: 'Oct 8',
    isRead: false,
    isStarred: true,
    isSnoozed: false,
    isArchived: false,
    isDeleted: false,
    isDraft: false,
    isSpam: false,
    isImportant: true,
    category: 'primary',
    folder: 'inbox',
    labels: ['Personal', 'Work'],
    attachments: [
      {
        id: 'att-3',
        name: 'database_review_notes.pdf',
        size: '420 KB',
        type: 'pdf',
      },
    ],
    security: {
      isEncrypted: true,
      spfVerified: true,
      dkimVerified: true,
    },
  },
  {
    id: 'msg-005',
    threadId: 'thread-005',
    senderName: 'Figma Team',
    senderEmail: 'updates@figma.com',
    toRecipients: ['pwngtwd@gmail.com'],
    subject: 'New comments on "Gothwad Mail - Desktop & Mobile Design System"',
    snippet: '3 new comments were added to your file. "The color theme #0494f4 combined with dark #212121 gives a sharp Google-grade feel!"...',
    bodyHtml: `
      <div style="font-family: inherit; line-height: 1.6;">
        <p>Hi Pawan,</p>
        <p>New design tokens and feedback have been added to your board:</p>
        <blockquote style="margin: 16px 0; padding: 12px 16px; border-left: 3px solid #0494f4; background-color: rgba(4, 148, 244, 0.05);">
          "The contrast between pure white #ffffff in light mode and #212121 in dark mode is clean and avoids any eye fatigue. Touch targets on mobile meet the 44px standard."
        </blockquote>
        <p><a href="#" style="color: #0494f4; text-decoration: underline;">View design file in Figma &rarr;</a></p>
      </div>
    `,
    bodyText: '3 new comments were added to your file. The color theme #0494f4 combined with dark #212121 gives a sharp Google-grade feel...',
    timestamp: '2026-10-08T14:15:00Z',
    dateFormatted: 'Oct 8',
    isRead: true,
    isStarred: false,
    isSnoozed: false,
    isArchived: false,
    isDeleted: false,
    isDraft: false,
    isSpam: false,
    category: 'social',
    folder: 'inbox',
    labels: ['Personal'],
    security: {
      isEncrypted: true,
      spfVerified: true,
      dkimVerified: true,
    },
  },
  {
    id: 'msg-006',
    threadId: 'thread-006',
    senderName: 'Stripe Billing',
    senderEmail: 'invoices@stripe.com',
    toRecipients: ['pwngtwd@gmail.com'],
    subject: 'Receipt for Invoice #INV-2026-1009 ($0.00 - Free Tier Dev)',
    snippet: 'Your invoice for Developer Plan has been processed. Amount charged: $0.00. Thank you for building with Stripe...',
    bodyHtml: `
      <div style="font-family: inherit; line-height: 1.6;">
        <p>Hi Pawan Gothwad,</p>
        <p>This is a confirmation receipt for invoice #INV-2026-1009.</p>
        <div style="padding: 16px; border: 1px solid rgba(4, 148, 244, 0.2); border-radius: 8px; margin: 16px 0;">
          <p style="margin: 0; font-weight: 600;">Amount: $0.00 USD</p>
          <p style="margin: 4px 0 0 0; font-size: 13px; color: #6b7280;">Item: Supabase Compute & PostgreSQL Developer Edition</p>
        </div>
        <p>A copy of your PDF tax invoice is attached below.</p>
      </div>
    `,
    bodyText: 'Your invoice for Developer Plan has been processed. Amount charged: $0.00. Thank you for building with Stripe...',
    timestamp: '2026-10-07T09:10:00Z',
    dateFormatted: 'Oct 7',
    isRead: true,
    isStarred: false,
    isSnoozed: false,
    isArchived: false,
    isDeleted: false,
    isDraft: false,
    isSpam: false,
    category: 'updates',
    folder: 'inbox',
    labels: ['Finance'],
    attachments: [
      {
        id: 'att-4',
        name: 'invoice_INV-2026-1009.pdf',
        size: '95 KB',
        type: 'pdf',
      },
    ],
    security: {
      isEncrypted: true,
      spfVerified: true,
      dkimVerified: true,
    },
  },
  {
    id: 'msg-007',
    threadId: 'thread-007',
    senderName: 'Google Cloud Security',
    senderEmail: 'security-noreply@google.com',
    toRecipients: ['pwngtwd@gmail.com'],
    subject: 'Security Alert: New device signed in to Gothwad Mail workspace',
    snippet: 'A new Chrome login was detected on Linux x86_64 at 5:28 AM. If this was you, no action is needed...',
    bodyHtml: `
      <div style="font-family: inherit; line-height: 1.6;">
        <p>We detected a new sign-in to your Google Account pwngtwd@gmail.com.</p>
        <div style="padding: 12px; background-color: rgba(4, 148, 244, 0.06); border-radius: 6px; margin: 14px 0;">
          <p style="margin: 0; font-size: 13px;"><strong>Device:</strong> Linux Desktop / Chrome Browser</p>
          <p style="margin: 4px 0 0 0; font-size: 13px;"><strong>Time:</strong> Today at 5:28 AM UTC</p>
        </div>
        <p>If this was you, you can safely ignore this message.</p>
      </div>
    `,
    bodyText: 'A new Chrome login was detected on Linux x86_64 at 5:28 AM. If this was you, no action is needed...',
    timestamp: '2026-10-07T05:28:00Z',
    dateFormatted: 'Oct 7',
    isRead: true,
    isStarred: false,
    isSnoozed: false,
    isArchived: false,
    isDeleted: false,
    isDraft: false,
    isSpam: false,
    category: 'primary',
    folder: 'inbox',
    labels: ['Personal'],
    security: {
      isEncrypted: true,
      spfVerified: true,
      dkimVerified: true,
    },
  },
  {
    id: 'msg-008',
    threadId: 'thread-008',
    senderName: 'PostgreSQL Global Development Group',
    senderEmail: 'announce@postgresql.org',
    toRecipients: ['pwngtwd@gmail.com'],
    subject: 'PostgreSQL Community Quarterly Update: Partitioning and RLS Performance',
    snippet: 'Discover the latest speed boosts in Row Level Security evaluation and query planner optimizations for multi-tenant apps...',
    bodyHtml: `
      <div style="font-family: inherit; line-height: 1.6;">
        <p>Dear PostgreSQL community member,</p>
        <p>The latest updates regarding query planning, index compaction, and RLS benchmarks are now published in our quarterly technical digest.</p>
        <p>Learn how to optimize database performance for high-concurrency email engines handling millions of messages with sub-millisecond query responses.</p>
      </div>
    `,
    bodyText: 'Discover the latest speed boosts in Row Level Security evaluation and query planner optimizations for multi-tenant apps...',
    timestamp: '2026-10-06T11:00:00Z',
    dateFormatted: 'Oct 6',
    isRead: true,
    isStarred: false,
    isSnoozed: false,
    isArchived: false,
    isDeleted: false,
    isDraft: false,
    isSpam: false,
    category: 'forums',
    folder: 'inbox',
    labels: ['Supabase Dev'],
    security: {
      isEncrypted: true,
      spfVerified: true,
      dkimVerified: true,
    },
  },
  {
    id: 'msg-009',
    threadId: 'thread-009',
    senderName: 'Me',
    senderEmail: 'pwngtwd@gmail.com',
    toRecipients: ['team@supabasedev.io'],
    subject: 'Sent: Gothwad Mail client architecture documentation and Supabase schema',
    snippet: 'Attached is the full implementation plan for connecting Supabase PostgreSQL database directly to Gothwad Mail with real-time sync...',
    bodyHtml: `
      <div style="font-family: inherit; line-height: 1.6;">
        <p>Team,</p>
        <p>Here is the full implementation outline for Gothwad Mail. As discussed:</p>
        <ul>
          <li>Desktop has the complete 3-pane Gmail interface with split view and quick toolbar.</li>
          <li>Mobile layout is 100% responsive with bottom navigation and touch-optimized action drawers.</li>
          <li>Color palette is strictly locked to #0494f4, light bg #ffffff, and dark bg #212121.</li>
        </ul>
        <p>Let me know your thoughts after testing!</p>
        <p>Pawan Gothwad</p>
      </div>
    `,
    bodyText: 'Attached is the full implementation plan for connecting Supabase PostgreSQL database directly to Gothwad Mail...',
    timestamp: '2026-10-05T16:20:00Z',
    dateFormatted: 'Oct 5',
    isRead: true,
    isStarred: true,
    isSnoozed: false,
    isArchived: false,
    isDeleted: false,
    isDraft: false,
    isSpam: false,
    category: 'primary',
    folder: 'sent',
    labels: ['Work'],
    attachments: [
      {
        id: 'att-5',
        name: 'Gothwad_Mail_Architecture.pdf',
        size: '2.4 MB',
        type: 'pdf',
      },
    ],
    security: {
      isEncrypted: true,
      spfVerified: true,
      dkimVerified: true,
    },
  },
  {
    id: 'msg-010',
    threadId: 'thread-010',
    senderName: 'Draft',
    senderEmail: 'pwngtwd@gmail.com',
    toRecipients: ['contact@partner.io'],
    subject: 'Draft: Supabase Webhook integration for incoming SMTP messages',
    snippet: 'Draft notes: Need to set up edge functions to parse incoming mime email envelopes and insert into emails table...',
    bodyHtml: `
      <div style="font-family: inherit; line-height: 1.6;">
        <p>Draft notes:</p>
        <p>Need to set up edge functions to parse incoming mime email envelopes and insert into <code>emails</code> table.</p>
        <p>Check RLS policies to allow authenticated client reads.</p>
      </div>
    `,
    bodyText: 'Draft notes: Need to set up edge functions to parse incoming mime email envelopes and insert into emails table...',
    timestamp: '2026-10-05T10:00:00Z',
    dateFormatted: 'Oct 5',
    isRead: true,
    isStarred: false,
    isSnoozed: false,
    isArchived: false,
    isDeleted: false,
    isDraft: true,
    isSpam: false,
    category: 'primary',
    folder: 'drafts',
    labels: ['Supabase Dev'],
    security: {
      isEncrypted: true,
      spfVerified: true,
      dkimVerified: true,
    },
  },
  {
    id: 'msg-011',
    threadId: 'thread-011',
    senderName: 'Booking.com Travel',
    senderEmail: 'customer.service@booking.com',
    toRecipients: ['pwngtwd@gmail.com'],
    subject: 'Reservation Confirmed: Bangalore Tech Hub Hotel (Oct 18-21)',
    snippet: 'Your upcoming hotel stay in Bangalore is confirmed. Check-in time: 2:00 PM. Free cancellation until Oct 16...',
    bodyHtml: `
      <div style="font-family: inherit; line-height: 1.6;">
        <p>Dear Pawan,</p>
        <p>Your hotel booking for the upcoming developer conference in Bangalore is confirmed!</p>
        <div style="padding: 14px; border: 1px solid rgba(4, 148, 244, 0.2); border-radius: 8px; margin: 14px 0;">
          <h4 style="margin: 0; color: #0494f4;">The Grand Residency Tech Hub</h4>
          <p style="margin: 4px 0 0 0; font-size: 13px;">Check-in: Sunday, Oct 18, 2026</p>
          <p style="margin: 2px 0 0 0; font-size: 13px;">Check-out: Wednesday, Oct 21, 2026</p>
        </div>
      </div>
    `,
    bodyText: 'Your upcoming hotel stay in Bangalore is confirmed. Check-in time: 2:00 PM...',
    timestamp: '2026-10-04T08:15:00Z',
    dateFormatted: 'Oct 4',
    isRead: true,
    isStarred: false,
    isSnoozed: true,
    isArchived: false,
    isDeleted: false,
    isDraft: false,
    isSpam: false,
    category: 'updates',
    folder: 'snoozed',
    labels: ['Travel'],
    security: {
      isEncrypted: true,
      spfVerified: true,
      dkimVerified: true,
    },
  },
  {
    id: 'msg-012',
    threadId: 'thread-012',
    senderName: 'Unknown Sender',
    senderEmail: 'promo994@spampromotions.biz',
    toRecipients: ['pwngtwd@gmail.com'],
    subject: 'Claim your 1,000,000 crypto tokens today immediately!',
    snippet: 'This message was flagged as spam by Gothwad Mail security filters because it matches known unsolicited spam patterns...',
    bodyHtml: `
      <div style="font-family: inherit; line-height: 1.6;">
        <p>Warning: Gothwad Mail flagged this message as spam.</p>
        <p>Do not click on links or share personal credentials with unverified senders.</p>
      </div>
    `,
    bodyText: 'This message was flagged as spam by Gothwad Mail security filters...',
    timestamp: '2026-10-03T12:00:00Z',
    dateFormatted: 'Oct 3',
    isRead: false,
    isStarred: false,
    isSnoozed: false,
    isArchived: false,
    isDeleted: false,
    isDraft: false,
    isSpam: true,
    category: 'promotions',
    folder: 'spam',
    labels: [],
    security: {
      isEncrypted: false,
      spfVerified: false,
      dkimVerified: false,
    },
  },
];
