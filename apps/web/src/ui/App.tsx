import { useCallback, useEffect, useRef, useState } from 'react';
import { detectPrfSupport, rpIdAllowed } from '../webauthn';
import { CreateFlow } from './CreateFlow';
import { Notice } from './components';
import type { MirrorItem, MirrorResult, VaultSession } from './operations';
import { isArweaveId } from '../config/networks';
import { ServicesProvider, useServices, type Services } from './services';
import { S } from './strings';
import { ActionBar, AppFooter, GlobalNav, SubNav, useFocusClearOfActionBar } from './chrome';
import { UnlockFlow, type Unlocked } from './UnlockFlow';
import { useAutoLock } from './useAutoLock';
import { VaultView } from './VaultView';
import { Btn, MotionRoot, ScreenTransition, useDirection } from './motionkit';

/** Test networks get the testnet + unaudited warning (add-privacy-and-compliance 4.3). */
const TESTNETS: Record<number, string> = { 11155420: 'OP Sepolia', 421614: 'Arbitrum Sepolia', 11155111: 'Sepolia', 31337: 'a local test chain' };
const testnetName = (chainId: number): string | undefined => TESTNETS[chainId];

type Screen = { name: 'home' } | { name: 'create' } | { name: 'unlock' } | { name: 'vault'; locator: `0x${string}`; fresh: boolean };
const SCREEN_ORDER = ['home', 'unlock', 'create', 'vault'] as const;

export function App({ services }: { services?: Services }) {
  return (
    <MotionRoot>
      <ServicesProvider {...(services ? { value: services } : {})}>
        <Shell />
      </ServicesProvider>
    </MotionRoot>
  );
}

function Shell() {
  const svc = useServices();
  const [screen, setScreen] = useState<Screen>({ name: 'home' });
  // The only place decrypted secrets live. Replaced with null on lock.
  const [session, setSession] = useState<VaultSession | null>(null);
  // harden-gas-sponsorship: the current (v2) vault and the legacy v1 copies the same key opens. Also decrypted, so they
  // are dropped on lock exactly like `session`.
  const [current, setCurrent] = useState<VaultSession | null>(null);
  const [older, setOlder] = useState<VaultSession[]>([]);
  const [locked, setLocked] = useState(false);
  // show-vault-onchain-location: the Arweave copy each open vault's session uploaded or verified, newest version only.
  // Public, but still dropped on lock; a result that lands after a lock (older epoch) is ignored.
  const [mirrorItems, setMirrorItems] = useState<Readonly<Record<string, MirrorItem>>>({});
  const epoch = useRef(0);
  const renderEpoch = epoch.current;
  const recordMirror = (key: string, version: number, r: MirrorResult) => {
    if (epoch.current !== renderEpoch || r.status !== 'saved' || !r.itemId || !isArweaveId(r.itemId)) return;
    const item = { version, id: r.itemId };
    setMirrorItems((all) => ((all[key]?.version ?? 0) > version ? all : { ...all, [key]: item }));
  };
  const vaultKey = (registry: string, vaultId: string) => `${registry}:${vaultId.toLowerCase()}`;
  const [prf, setPrf] = useState<'supported' | 'unsupported' | 'unknown'>('unknown');
  const allowed = rpIdAllowed(svc.host, svc.rpId);
  useFocusClearOfActionBar();
  const dir = useDirection(SCREEN_ORDER, screen.name);
  // Returning home (Back, Lock): focus the home heading, as every other step heading is focused on arrival.
  const homeHeading = useRef<HTMLHeadingElement>(null);
  const arrived = useRef(false);
  useEffect(() => {
    if (screen.name === 'home' && arrived.current) homeHeading.current?.focus();
    arrived.current = true;
  }, [screen.name]);

  useEffect(() => {
    void detectPrfSupport().then(setPrf);
  }, []);

  const lock = useCallback(() => {
    setSession(null);
    setCurrent(null);
    setOlder([]);
    setMirrorItems({});
    epoch.current++;
    setScreen({ name: 'home' });
    setLocked(true);
  }, []);
  const { warning, extend } = useAutoLock(session !== null, lock);

  const onUnlocked = (u: Unlocked) => {
    setSession(u.session);
    setCurrent(u.session.registry === 'v2' ? u.session : null);
    setOlder(u.older ?? []);
    setLocked(false);
    setScreen({ name: 'vault', locator: u.locator, fresh: false });
  };

  return (
    <div className="app">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="site-header">
        <GlobalNav />
        <SubNav name={S.vault.surface} />
      </header>
      <main id="main" className="app-main" tabIndex={-1}>
        {testnetName(svc.chainId) && (
          <p className="testnet-banner" role="note">
            {S.testnet(testnetName(svc.chainId)!)}
          </p>
        )}
        {!allowed && <Notice kind="error">{S.misconfigured}</Notice>}
        {allowed && prf === 'unsupported' && screen.name !== 'vault' && (
          <Notice kind="error" title="Browser not supported">
            <p className="notice-text">{S.browserUnsupported}</p>
            <ul>
              {S.supportedBrowsers.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          </Notice>
        )}
        {warning && session && (
          <div className="notice notice-info notice-inline" role="alert">
            <p className="notice-text">{S.vault.idleWarning}</p>
            <Btn onClick={extend}>{S.vault.stillHere}</Btn>
          </div>
        )}
        {locked && screen.name === 'home' && <Notice kind="info">{S.vault.locked}</Notice>}

        <ScreenTransition id={screen.name} dir={dir}>
          {screen.name === 'home' && (
            <section aria-labelledby="home-title" className="card step">
              <h1 id="home-title" ref={homeHeading} tabIndex={-1}>
                {S.appName}
              </h1>
              <p>{S.tagline}</p>
              <p>{S.home.explain}</p>
              <ActionBar>
                <Btn onClick={() => { setLocked(false); setScreen({ name: 'unlock' }); }} disabled={!allowed || prf === 'unsupported'}>
                  {S.home.unlock}
                </Btn>
                <Btn className="secondary" onClick={() => { setLocked(false); setScreen({ name: 'create' }); }} disabled={!allowed || prf === 'unsupported'}>
                  {S.home.create}
                </Btn>
              </ActionBar>
            </section>
          )}
          {screen.name === 'create' && allowed && (
            <CreateFlow
              onCancel={() => setScreen({ name: 'home' })}
              onMirror={(vaultId, version, r) => recordMirror(vaultKey('v2', vaultId), version, r)}
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
            <VaultView
              key={`${session.registry}:${session.vaultId}`}
              session={session}
              locator={screen.locator}
              freshMirror={screen.fresh}
              onChange={(s) => {
                setSession(s);
                if (s.registry === 'v2') setCurrent(s);
              }}
              onLock={lock}
              mirrorItem={mirrorItems[vaultKey(session.registry, session.vaultId)]}
              onMirror={(version, r) => recordMirror(vaultKey(session.registry, session.vaultId), version, r)}
              {...(session.registry === 'v2' && older.length > 0 ? { onOpenOlder: () => setSession(older[0]!) } : {})}
              {...(session.registry !== 'v2' && current ? { onBackToCurrent: () => setSession(current) } : {})}
            />
          )}
        </ScreenTransition>
      </main>
      <AppFooter />
    </div>
  );
}
