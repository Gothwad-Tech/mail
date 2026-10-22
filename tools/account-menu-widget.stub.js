/**
 * LOCAL STAND-IN for Accounts' shared account widget.
 *
 * Production loads the real thing from `${accountsWebOrigin}/widget/account-menu.js`
 * (Accounts repo: `web/widget/account-menu*.js`). This file exists so the dev
 * server can serve the same URL and the same `window.GothwadAccountMenu` API, so
 * `npm run dev` and the jsdom tests exercise the real integration path instead of
 * a compile-time mock.
 *
 * It is intentionally a subset: the same state/opts contract, the same rows and
 * the same callbacks. Visual polish belongs to Accounts, not here.
 */

const HOST_TAG = 'data-gothwad-account-menu-stub';

const CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
.layer { position: fixed; inset: 0; z-index: 2147483000;
  font-family: 'Plus Jakarta Sans', 'Roboto', system-ui, sans-serif; }
.backdrop { position: absolute; inset: 0; background: rgba(0,0,0,.4); }
.sheet { position: absolute; inset: 0; display: flex; flex-direction: column; gap: 2px;
  background: var(--surface); color: var(--text); padding: 12px 12px 24px; overflow-y: auto; }
@media (min-width: 640px) {
  .backdrop { background: transparent; }
  .sheet { inset: auto; top: var(--top, 64px); right: var(--right, 16px); width: 396px;
    max-height: calc(100dvh - 80px); border-radius: 28px; padding: 10px;
    box-shadow: 0 12px 36px rgba(15,23,42,.18), 0 2px 6px rgba(15,23,42,.08);
    border: 1px solid var(--border); }
}
.layer[data-theme="dark"] { --surface:#1b1f26; --card:#282c34; --text:#e3e3e3; --subtext:#c4c7c5;
  --border: rgba(255,255,255,.08); --accent:#8ab4f8; --danger:#f28b82; }
.layer { --surface:#eef3f8; --card:#fff; --text:#1f1f1f; --subtext:#444746;
  --border: rgba(0,0,0,.06); --accent:#0b57d0; --danger:#b3261e; }
.hero { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 18px 0 10px; }
.avatar { width: 64px; height: 64px; border-radius: 999px; overflow: hidden; display: grid;
  place-items: center; background: #0494f4; color: #fff; font-weight: 700; font-size: 26px; }
.avatar img { width: 100%; height: 100%; object-fit: cover; }
.avatar.sm { width: 40px; height: 40px; font-size: 15px; }
.name { font-weight: 600; font-size: 15px; }
.email { color: var(--subtext); font-size: 12px; }
.row { display: flex; align-items: center; gap: 12px; min-height: 56px; padding: 6px 10px;
  border-radius: 999px; text-decoration: none; color: inherit; background: none; border: 0;
  font: inherit; cursor: pointer; text-align: left; width: 100%; }
.row:hover { background: var(--card); }
.row .meta { display: flex; flex-direction: column; min-width: 0; flex: 1; }
.row .meta span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.badge { background: #0494f4; color: #fff; border-radius: 999px; font-size: 10px;
  font-weight: 700; padding: 1px 6px; }
.plus { width: 40px; height: 40px; border-radius: 999px; border: 1px dashed currentColor;
  display: grid; place-items: center; color: var(--accent); }
.danger { color: var(--danger); }
.signout-mini { font-size: 11px; font-weight: 600; color: var(--danger); padding: 6px 8px;
  border-radius: 999px; }
.signout-mini:hover { background: rgba(179,38,30,.08); }
.footer { margin-top: auto; color: var(--subtext); font-size: 11px; text-align: center; padding-top: 10px; }
`;

const esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

const initials = (person) => {
  const full = `${person?.firstName || ''} ${person?.lastName || ''}`.trim() || person?.name || person?.username || '?';
  const parts = full.split(/[\s._-]+/).filter(Boolean);
  return ((parts.length >= 2 ? parts[0][0] + parts[1][0] : full.slice(0, 2)) || '?').toUpperCase();
};

const avatarMarkup = (person, cls = '') => {
  const url = person?.avatarUrl || person?.avatar_url || '';
  const inner = url
    ? `<img src="${esc(url)}" alt="" referrerpolicy="no-referrer" />`
    : esc(initials(person));
  return `<span class="avatar ${cls}">${inner}</span>`;
};

class Controller {
  constructor() {
    this.host = null;
    this.root = null;
    this.state = { user: null, accounts: [], activeId: null, authuser: 0 };
    this.opts = {};
    this.onKey = (event) => {
      if (event.key === 'Escape') this.close();
    };
  }

  isOpen() {
    return Boolean(this.host);
  }

  ensureMounted() {
    if (this.host || !globalThis.document?.body) return;
    this.host = document.createElement('div');
    this.host.setAttribute(HOST_TAG, '1');
    this.root = this.host.attachShadow ? this.host.attachShadow({ mode: 'open' }) : this.host;
    document.body.appendChild(this.host);
    globalThis.window?.addEventListener?.('keydown', this.onKey);
  }

  open(state = {}, opts = {}) {
    this.state = { ...this.state, ...state, manageMode: false };
    this.opts = { ...opts };
    this.ensureMounted();
    this.render();
  }

  update(state = {}, opts = null) {
    this.state = { ...this.state, ...state };
    if (opts) this.opts = { ...this.opts, ...opts };
    if (this.isOpen()) this.render();
  }

  close() {
    if (!this.host) return;
    this.host.remove();
    this.host = null;
    this.root = null;
    globalThis.window?.removeEventListener?.('keydown', this.onKey);
    this.opts.onClose?.();
  }

  render() {
    if (!this.root) return;
    const { user, accounts = [], activeId } = this.state;
    const opts = this.opts;
    const theme = opts.theme === 'dark' ? 'dark' : 'light';
    const anchorRect = opts.anchorEl?.getBoundingClientRect?.();
    const top = anchorRect ? Math.max(12, Math.round(anchorRect.bottom + 10)) : 64;
    const right = anchorRect ? Math.max(12, Math.round((globalThis.innerWidth || 1024) - anchorRect.right)) : 16;
    const badges = opts.badges || {};
    const others = accounts.filter((account) => account.id !== activeId);
    const managing = Boolean(this.state.manageMode);

    const rows = others
      .map((account) => {
        const count = Number(badges[account.username] || 0);
        const href = typeof opts.accountHref === 'function' ? opts.accountHref(account) : '#';
        return `<a class="row" href="${esc(href)}" data-switch="${esc(account.id)}">
          ${avatarMarkup(account, 'sm')}
          <span class="meta">
            <span>${esc(account.name || account.username)}</span>
            <span class="email">${esc(account.email)}</span>
          </span>
          ${count > 0 ? `<span class="badge">${count > 99 ? '99+' : count}</span>` : ''}
          ${managing ? `<span class="signout-mini" role="button" tabindex="0" data-signout-slot="${esc(account.id)}">Sign out</span>` : ''}
        </a>`;
      })
      .join('');

    const extraRows = (opts.extraActions || [])
      .map(
        (action, index) =>
          `<button class="row" data-extra="${index}" type="button"><span class="meta"><span>${esc(action.label)}</span></span></button>`
      )
      .join('');

    this.root.innerHTML = `<style>${CSS}</style>
      <div class="layer" data-theme="${theme}">
        <div class="backdrop" data-close="1"></div>
        <div class="sheet" role="dialog" aria-modal="true" aria-label="Gothwad Account menu"
             style="--top:${top}px;--right:${right}px">
          <div class="hero">
            ${avatarMarkup(user || {})}
            <div class="name">${esc(user?.name || user?.username || '')}</div>
            <div class="email">${esc(user?.email || '')}</div>
          </div>
          ${rows}
          <a class="row" href="${esc(opts.addAccountHref || '#')}" data-add="1">
            <span class="plus">+</span><span class="meta"><span>Add another account</span></span>
          </a>
          <button class="row" data-manage-mode="1" type="button">
            <span class="meta"><span>${managing ? 'Done managing accounts' : 'Manage accounts'}</span></span>
          </button>
          ${managing ? `<button class="row" data-signout-active="1" type="button">
            <span class="meta"><span>Sign out of ${esc(user?.email || 'this account')}</span></span>
          </button>` : ''}
          ${managing && others.length > 0 ? `<button class="row danger" data-signout-all="1" type="button"><span class="meta"><span>Sign out of all accounts</span></span></button>` : ''}
          ${extraRows}
          <a class="row" href="${esc(opts.manageAccountHref || '#')}" data-manage="1">
            <span class="meta"><span>Manage your Gothwad Account</span></span>
          </a>
          <div class="footer">Gothwad Accounts &bull; local widget stub</div>
        </div>
      </div>`;
    this.bind();
  }

  bind() {
    const q = (selector) => this.root.querySelector(selector);
    const all = (selector) => [...this.root.querySelectorAll(selector)];

    all('[data-close]').forEach((el) => el.addEventListener('click', () => this.close()));

    // Add another account: the host builds the URL (it knows the origin).
    q('[data-add]')?.addEventListener('click', (event) => {
      if (typeof this.opts.addAccountHref !== 'string') {
        event.preventDefault();
        const count = (this.state.accounts || []).length;
        if (count >= 6) {
          this.opts.onError?.('Maximum 6 accounts can stay signed in on one browser.');
          return;
        }
        this.close();
        this.opts.onAddAccount?.();
      }
    });

    all('[data-switch]').forEach((row) => {
      row.addEventListener('click', (event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button === 1) return;
        event.preventDefault();
        const account = (this.state.accounts || []).find((a) => a.id === row.getAttribute('data-switch'));
        if (!account) return;
        this.close();
        this.opts.onSwitchAccount?.(account);
      });
    });

    q('[data-manage-mode]')?.addEventListener('click', () => {
      this.state.manageMode = !this.state.manageMode;
      this.render();
    });

    all('[data-signout-slot]').forEach((button) => {
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const id = button.getAttribute('data-signout-slot');
        this.close();
        this.opts.onSignOutAccount?.(id);
      });
    });

    q('[data-signout-active]')?.addEventListener('click', () => {
      const id = this.state.activeId;
      this.close();
      this.opts.onSignOutAccount?.(id);
    });

    q('[data-signout-all]')?.addEventListener('click', () => {
      this.close();
      this.opts.onSignOutAll?.();
    });

    all('[data-extra]').forEach((button) => {
      button.addEventListener('click', () => {
        const action = (this.opts.extraActions || [])[Number(button.getAttribute('data-extra'))];
        this.close();
        action?.onClick?.();
      });
    });

    q('[data-manage]')?.addEventListener('click', (event) => {
      if (typeof this.opts.onManageAccount === 'function') {
        event.preventDefault();
        this.close();
        this.opts.onManageAccount();
      }
    });
  }
}

export const GothwadAccountMenu = new Controller();

if (globalThis.window) {
  globalThis.window.GothwadAccountMenu = GothwadAccountMenu;
}
