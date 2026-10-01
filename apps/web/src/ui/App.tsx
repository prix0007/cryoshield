import { useCallback, useEffect, useState } from 'react';
import { detectPrfSupport, rpIdAllowed } from '../webauthn';
import { CreateFlow } from './CreateFlow';
import { Notice } from './components';
import type { VaultSession } from './operations';
import { ServicesProvider, useServices, type Services } from './services';
import { S } from './strings';
import { UnlockFlow, type Unlocked } from './UnlockFlow';
import { useAutoLock } from './useAutoLock';
import { VaultView } from './VaultView';

type Screen = { name: 'home' } | { name: 'create' } | { name: 'unlock' } | { name: 'vault'; locator: `0x${string}`; fresh: boolean };

export function App({ services }: { services?: Services }) {
  return (
    <ServicesProvider {...(services ? { value: services } : {})}>
      <Shell />
    </ServicesProvider>
  );
}

function Shell() {
  const svc = useServices();
  const [screen, setScreen] = useState<Screen>({ name: 'home' });
  // The only place decrypted secrets live. Replaced with null on lock.
  const [session, setSession] = useState<VaultSession | null>(null);
  const [locked, setLocked] = useState(false);
  const [prf, setPrf] = useState<'supported' | 'unsupported' | 'unknown'>('unknown');
  const allowed = rpIdAllowed(svc.host, svc.rpId);

  useEffect(() => {
    void detectPrfSupport().then(setPrf);
  }, []);

  const lock = useCallback(() => {
    setSession(null);
    setScreen({ name: 'home' });
    setLocked(true);
  }, []);
  const { warning, extend } = useAutoLock(session !== null, lock);

  const onUnlocked = (u: Unlocked) => {
    setSession(u.session);
    setLocked(false);
    setScreen({ name: 'vault', locator: u.locator, fresh: false });
  };

  return (
    <div className="app">
      <header>
        <p className="brand">{S.appName}</p>
      </header>
      <main id="main">
        {!allowed && <Notice kind="error">{S.misconfigured}</Notice>}
        {allowed && prf === 'unsupported' && screen.name !== 'vault' && (
          <Notice kind="error">
            {S.browserUnsupported}
            <ul>
              {S.supportedBrowsers.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          </Notice>
        )}
        {warning && session && (
          <div className="notice notice-info" role="alert">
            {S.vault.idleWarning}{' '}
            <button onClick={extend}>{S.vault.stillHere}</button>
          </div>
        )}
        {locked && screen.name === 'home' && <Notice kind="info">{S.vault.locked}</Notice>}

        {screen.name === 'home' && (
          <section aria-labelledby="home-title">
            <h1 id="home-title">{S.appName}</h1>
            <p>{S.tagline}</p>
            <p>{S.home.explain}</p>
            <div className="actions">
              <button onClick={() => { setLocked(false); setScreen({ name: 'unlock' }); }} disabled={!allowed || prf === 'unsupported'}>
                {S.home.unlock}
              </button>
              <button className="secondary" onClick={() => { setLocked(false); setScreen({ name: 'create' }); }} disabled={!allowed || prf === 'unsupported'}>
                {S.home.create}
              </button>
            </div>
          </section>
        )}
        {screen.name === 'create' && allowed && (
          <CreateFlow
            onCancel={() => setScreen({ name: 'home' })}
            onDone={(s) => {
              setSession(s);
              setScreen({ name: 'vault', locator: '0x', fresh: true });
            }}
          />
        )}
        {screen.name === 'unlock' && allowed && (
          <UnlockFlow onUnlocked={onUnlocked} onCreate={() => setScreen({ name: 'create' })} onCancel={() => setScreen({ name: 'home' })} />
        )}
        {screen.name === 'vault' && session && (
          <VaultView session={session} locator={screen.locator} freshMirror={screen.fresh} onChange={setSession} onLock={lock} />
        )}
      </main>
    </div>
  );
}
