# Gothwad Mail 📬

> **A fast, modern desktop and mobile email client with Gmail-style workflows, customizable themes, and seamless Supabase database synchronization.**

[![Vite](https://img.shields.io/badge/Vite-8.3-646CFF?logo=vite&logoColor=white)](https://vitejs.dev/)
[![React](https://img.shields.io/badge/React-19.0-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-v4.0-38B2AC?logo=tailwind-css&logoColor=white)](https://tailwindcss.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![PWA](https://img.shields.io/badge/PWA-Ready-4A90E2?logo=pwa&logoColor=white)](https://web.dev/progressive-web-apps/)
[![Supabase](https://img.shields.io/badge/Supabase-Ready-3ECF8E?logo=supabase&logoColor=white)](https://supabase.com/)

---

## 🌟 Key Features

- **⚡ Gmail-Style Interface & Workflows**:
  - Complete folder structure: *Inbox, Starred, Snoozed, Sent, Drafts, Archive, Trash, Spam, Important, Scheduled, All Mail*.
  - Category tabs (*Primary, Social, Promotions, Updates, Forums*).
  - Split-view toggle (standard full-width or vertical preview pane).
  - Bulk actions (select all, star, archive, delete, mark read/unread).

- **⌨️ Keyboard Shortcuts**:
  - `C`: Compose new email
  - `E`: Archive selected email(s)
  - `#`: Delete selected email(s)
  - `S`: Toggle star status
  - `Esc`: Close open email detail / dismiss modal

- **📱 Mobile & PWA Ready**:
  - Fully responsive with mobile navigation drawer and bottom action bar.
  - Native home screen install prompt (`vite-plugin-pwa`).
  - Offline indicator and resilient local caching.

- **🌓 Dual Theme Support**:
  - Pixel-perfect Light mode (`#ffffff`) and Dark mode (`#212121`).
  - Custom scrollbars, persistent theme preferences, and system color scheme detection.

- **✍️ Rich Compose Experience**:
  - Window docking: expand, minimize to bottom tray, or full-screen modal.
  - CC and BCC recipient chip management.
  - Multi-file attachment handling with file size calculation.
  - Automatic background draft saving every 2 seconds.
  - Send scheduling option.

- **🗄️ Supabase Cloud Synchronization & Offline-First**:
  - Works out of the box with in-memory & `localStorage` caching.
  - One-click Supabase cloud sync setup via in-app modal.
  - Complete PostgreSQL schema with Row Level Security (RLS) and Realtime replication included.

- **🔍 Advanced Search & Filtering**:
  - Instant live filter across sender, subject, and body snippet.
  - Filter modal for date ranges, attachment filters, and specific recipients.

---

## 🛠️ Tech Stack

- **Framework**: [React 19](https://react.dev/) with Functional Components & Hooks
- **Bundler & Dev Server**: [Vite 8](https://vitejs.dev/)
- **Styling**: [Tailwind CSS v4](https://tailwindcss.com/)
- **Icons**: [Lucide React](https://lucide.dev/)
- **Animations**: [Motion](https://motion.dev/)
- **Database / Backend**: [Supabase JS](https://supabase.com/) (PostgreSQL)
- **PWA**: [vite-plugin-pwa](https://vite-pwa-org.netlify.app/)
- **Language**: [TypeScript](https://www.typescriptlang.org/)

---

## 🚀 Getting Started

### Prerequisites

- Node.js `20.x` or `22.x`
- npm `10.x` or higher

### Installation

1. **Clone the repository**:
   ```bash
   git clone https://github.com/GothwadTech/mail.git
   cd mail
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Configure environment variables (optional)**:
   Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```

   ```env
   VITE_SUPABASE_URL=https://your-project.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-public-key
   ```
   *(Note: You can also configure Supabase directly within the app UI under the Supabase icon in the header)*

4. **Start the local development server**:
   ```bash
   npm run dev
   ```
   The application will be live at `http://localhost:3000`.

---

## 📜 Available Scripts

| Command | Description |
| :--- | :--- |
| `npm run dev` | Starts Vite development server at `http://0.0.0.0:3000` |
| `npm run build` | Compiles TypeScript and creates optimized production build in `dist/` |
| `npm run preview` | Previews the production build locally |
| `npm run lint` | Runs TypeScript type checking (`tsc --noEmit`) |
| `npm run clean` | Cleans build artifacts (`dist/`) |

---

## 🗄️ Supabase Database Schema

To enable cloud synchronization with your own Supabase project:

1. Open your [Supabase Dashboard](https://app.supabase.com/) and go to the **SQL Editor**.
2. Run the SQL schema below (also accessible directly inside the app via the **Supabase Setup** button):

```sql
-- 1. Create Enums for Categories and Folders
DO $$ BEGIN
  CREATE TYPE email_category AS ENUM ('primary', 'social', 'promotions', 'updates', 'forums');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE email_folder AS ENUM (
    'inbox', 'starred', 'snoozed', 'sent', 'drafts', 
    'important', 'scheduled', 'all', 'spam', 'trash', 'archive'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- 2. Create Emails Table
CREATE TABLE IF NOT EXISTS public.emails (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  sender_name TEXT NOT NULL,
  sender_email TEXT NOT NULL,
  sender_avatar TEXT,
  to_recipients TEXT[] NOT NULL DEFAULT '{}',
  cc_recipients TEXT[] DEFAULT '{}',
  bcc_recipients TEXT[] DEFAULT '{}',
  subject TEXT NOT NULL DEFAULT '(no subject)',
  snippet TEXT DEFAULT '',
  body_html TEXT NOT NULL,
  body_text TEXT DEFAULT '',
  timestamp TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  date_formatted TEXT,
  is_read BOOLEAN NOT NULL DEFAULT false,
  is_starred BOOLEAN NOT NULL DEFAULT false,
  is_snoozed BOOLEAN NOT NULL DEFAULT false,
  is_archived BOOLEAN NOT NULL DEFAULT false,
  is_deleted BOOLEAN NOT NULL DEFAULT false,
  is_draft BOOLEAN NOT NULL DEFAULT false,
  is_spam BOOLEAN NOT NULL DEFAULT false,
  is_important BOOLEAN NOT NULL DEFAULT false,
  category email_category NOT NULL DEFAULT 'primary',
  folder email_folder NOT NULL DEFAULT 'inbox',
  labels TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 3. Create Attachments Table
CREATE TABLE IF NOT EXISTS public.attachments (
  id TEXT PRIMARY KEY,
  email_id TEXT NOT NULL REFERENCES public.emails(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  size TEXT NOT NULL,
  type TEXT NOT NULL,
  url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 4. Create Custom Labels Table
CREATE TABLE IF NOT EXISTS public.labels (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  color_hex TEXT NOT NULL DEFAULT '#0494f4',
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 5. Create Performance Indexes
CREATE INDEX IF NOT EXISTS idx_emails_thread_id ON public.emails(thread_id);
CREATE INDEX IF NOT EXISTS idx_emails_folder ON public.emails(folder);
CREATE INDEX IF NOT EXISTS idx_emails_category ON public.emails(category);
CREATE INDEX IF NOT EXISTS idx_emails_timestamp ON public.emails(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_emails_is_read ON public.emails(is_read);
CREATE INDEX IF NOT EXISTS idx_emails_is_starred ON public.emails(is_starred);
CREATE INDEX IF NOT EXISTS idx_emails_to_recipients ON public.emails USING GIN(to_recipients);
CREATE INDEX IF NOT EXISTS idx_emails_labels ON public.emails USING GIN(labels);

-- 6. Enable Row Level Security (RLS)
ALTER TABLE public.emails ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.labels ENABLE ROW LEVEL SECURITY;

-- 7. Dev Access Policies
CREATE POLICY "Allow public read access to emails" ON public.emails FOR SELECT USING (true);
CREATE POLICY "Allow public insert/update to emails" ON public.emails FOR ALL USING (true);
CREATE POLICY "Allow public access to attachments" ON public.attachments FOR ALL USING (true);
CREATE POLICY "Allow public access to labels" ON public.labels FOR ALL USING (true);

-- 8. Enable Realtime Replication
ALTER PUBLICATION supabase_realtime ADD TABLE public.emails;
```

---

## 🌐 Deployment

### Cloudflare Pages / Vercel / Netlify

1. Link your GitHub repository.
2. Build Settings:
   - **Framework Preset**: Vite
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
3. If using Supabase, add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` to your environment variables in the project settings.

---

## 📄 License

This project is open source and available under the [MIT License](LICENSE).
