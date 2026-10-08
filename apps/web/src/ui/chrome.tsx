/** App chrome in the visual-language grammar (redesign-landing-and-app-ui D7). Presentational only. */
import { useEffect, type ReactNode } from 'react';

const REPO = 'https://github.com/prix0007/cryoshield';
const LINKS: [string, string][] = [
  ['How it works', '/#how'],
  ['FAQ', '/#faq'],
  ['Recovery tool', `${REPO}/tree/main/tools/recover#readme`],
];

function NavLink({ label, href }: { label: string; href: string }) {
  return href.startsWith('http') ? (
    <a href={href} rel="noopener noreferrer">
      {label}
    </a>
  ) : (
    <a href={href}>{label}</a>
  );
}

export function GlobalNav() {
  return (
    <nav className="global-nav" aria-label="Site">
      <div className="global-nav-inner">
        <a className="wordmark" href="/" aria-label="CryoShield home">
          <svg className="wordmark-glyph" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5l-8-3Z" />
            <path className="wordmark-snow" d="M12 7v10M7.7 9.5l8.6 5M7.7 14.5l8.6-5" />
          </svg>
          <span>CryoShield</span>
        </a>
        <ul className="global-nav-links">
          {LINKS.map(([l, h]) => (
            <li key={l}>
              <NavLink label={l} href={h} />
            </li>
          ))}
        </ul>
        <details className="nav-menu">
          <summary aria-label="Menu">
            <span className="nav-menu-icon" aria-hidden="true" />
          </summary>
          <ul>
            {LINKS.map(([l, h]) => (
              <li key={l}>
                <NavLink label={l} href={h} />
              </li>
            ))}
          </ul>
        </details>
      </div>
    </nav>
  );
}

export function SubNav({ name, action }: { name: string; action?: ReactNode }) {
  return (
    <div className="sub-nav">
      <div className="sub-nav-inner">
        <p className="sub-nav-name">{name}</p>
        <p className="chip">Testnet</p>
        {action}
      </div>
    </div>
  );
}

/** Floating sticky bar for a step's main actions. Stays in DOM order, so Tab order is unchanged. */
export function ActionBar({ children }: { children: ReactNode }) {
  return <div className="actions action-bar">{children}</div>;
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="card empty-state">
      <p>{children}</p>
    </div>
  );
}

/**
 * WCAG 2.4.11 (focus not obscured): browsers do not always scroll a partly covered field clear of a sticky bar
 * (scroll-padding is honoured only when the element is fully outside the scrollport). Nudge the page when the newly
 * focused element overlaps the floating action bar. Presentational only.
 */
export function useFocusClearOfActionBar() {
  useEffect(() => {
    const onFocus = (e: FocusEvent) => {
      const el = e.target as HTMLElement | null;
      const bar = document.querySelector('.action-bar');
      if (!el || !bar || bar.contains(el) || getComputedStyle(bar).position !== 'sticky') return;
      const r = el.getBoundingClientRect();
      const b = bar.getBoundingClientRect();
      const overlap = r.top < b.bottom ? r.bottom - b.top : 0; // only when the element is actually under the bar
      if (overlap > 0) window.scrollBy({ top: overlap + 16, behavior: 'instant' });
    };
    document.addEventListener('focusin', onFocus);
    return () => document.removeEventListener('focusin', onFocus);
  }, []);
}

/** Slim app footer: legal links (add-privacy-and-compliance "Linked everywhere"). */
export function AppFooter() {
  return (
    <footer className="app-footer">
      <ul>
        <li>
          <a href="/privacy">Privacy</a>
        </li>
        <li>
          <a href="/terms">Terms</a>
        </li>
        <li>
          <a href="/cookies">Cookies</a>
        </li>
        <li>
          <a href="/architecture">System design</a>
        </li>
        <li>
          <a href="/devices">Supported devices</a>
        </li>
        <li>
          <a href="/support">
            <span className="coffee-link-cup" aria-hidden="true">
              ☕
            </span>
            Buy me a coffee
          </a>
        </li>
        <li>
          <a href={`${REPO}/blob/main/SECURITY.md`} rel="noopener noreferrer">
            Security
          </a>
        </li>
      </ul>
    </footer>
  );
}
