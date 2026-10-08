/*
 * CryoShield theme (OpenSpec add-theme-switch, spec site-theme; design D1).
 * A classic script loaded in <head> on every page, before <body> is parsed, so the saved theme applies before the
 * first paint. It is the only code in CryoShield that uses browser storage: one key, "cryoshield-theme", holding
 * "light" or "dark", written only when the visitor picks Light or Dark, deleted when they pick System. It holds no
 * identifier and is never sent anywhere. Every storage access is guarded: blocked, full or tampered storage means
 * System, and the page keeps working. No HTML sinks, no inline styles (strict CSP + Trusted Types).
 */
(() => {
  'use strict';
  const KEY = 'cryoshield-theme';
  const SWITCH = 'select[data-theme-select]';
  const root = document.documentElement;
  const valid = (v) => v === 'light' || v === 'dark';

  const saved = () => {
    try {
      const v = window.localStorage.getItem(KEY);
      return valid(v) ? v : 'system';
    } catch {
      return 'system';
    }
  };
  const save = (choice) => {
    try {
      if (valid(choice)) window.localStorage.setItem(KEY, choice);
      else window.localStorage.removeItem(KEY);
    } catch {
      // Storage blocked or full: the choice still applies to this page, it just isn't remembered.
    }
  };
  // The browser chrome colour: each theme-color meta keeps its own (per-scheme) colour for System; a forced choice
  // sets every meta to the colour the page declares for that scheme. Plain attribute values, no HTML sink.
  const themeColor = (choice) => {
    const metas = [...document.querySelectorAll('meta[name="theme-color"]')];
    for (const m of metas) if (m.dataset.themeDefault === undefined) m.dataset.themeDefault = m.content;
    const forced = metas.find((m) => (m.getAttribute('media') ?? '').includes(choice));
    for (const m of metas) m.content = valid(choice) && forced ? forced.dataset.themeDefault : m.dataset.themeDefault;
  };
  const apply = (choice) => {
    if (valid(choice)) root.dataset.theme = choice;
    else delete root.dataset.theme;
    themeColor(choice);
  };
  const current = () => (valid(root.dataset.theme) ? root.dataset.theme : 'system');
  const sync = () => {
    for (const s of document.querySelectorAll(SWITCH)) s.value = current();
  };

  apply(saved());

  // One delegated listener serves every switch, including the one the React app renders later.
  document.addEventListener('change', (e) => {
    const t = e.target;
    if (!(t instanceof HTMLSelectElement) || !t.matches(SWITCH)) return;
    const choice = t.value;
    if (!valid(choice) && choice !== 'system') return;
    apply(choice);
    save(choice);
    sync();
  });

  // Another tab changed (or cleared) the choice.
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY && e.key !== null) return;
    apply(saved());
    sync();
  });

  const ready = () => {
    sync();
    for (const el of document.querySelectorAll('[data-theme-switch][hidden]')) el.hidden = false;
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready, { once: true });
  else ready();
})();
