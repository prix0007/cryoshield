/**
 * Same-origin opener guard (add-privacy-preserving-analytics D4, task 4.6). The landing page runs a third-party
 * beacon on the vault's origin. A script there could `window.open('/app/')` and then drive the vault window through
 * the reference it holds. So the app refuses to initialise in any window that has an opener, before any service
 * (WebAuthn, RPC, bundler) is created. The way out is a fresh tab with no opener, which no other page can script.
 */
export const openedByScript = (win: Window): boolean => win.opener != null;

export function OpenerBlocked() {
  return (
    <main id="main" className="app-main">
      <section className="card step" aria-labelledby="opener-title">
        <h1 id="opener-title">Open CryoShield directly</h1>
        <p>
          For your safety, CryoShield doesn’t run in a window that another page opened. Open it yourself by typing
          cryoshield.app/app/ in your browser’s address bar, or use the link below.
        </p>
        <p>
          <a className="pill pill-primary" href="/app/" target="_blank" rel="noopener noreferrer">
            Open CryoShield in a new tab
          </a>
        </p>
      </section>
    </main>
  );
}
