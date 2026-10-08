import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { detectPrfSupport, rpIdAllowed } from '../webauthn';
import { CreateFlow } from './CreateFlow';
import { ChunkFailed, Notice, useLazyModule } from './components';
import type { MirrorItem, MirrorResult, VaultSession } from './operations';
import { isArweaveId } from '../config/networks';
import { ServicesProvider, testnetName, useServices, type Services } from './services';
import { S } from './strings';
import { ActionBar, AppFooter, GlobalNav, SubNav, useFocusClearOfActionBar } from './chrome';
import { unlockMessage, unlockSessions, UnlockFlow, type Unlocked } from './UnlockFlow';
import { UnlockError } from '../chain/unlock';
import { keccak256 } from 'viem';
import { bytesEqual } from '../lib/bytes';
import { config, isOlder, WRITE_REGISTRY } from '../config';
import { useAutoLock } from './useAutoLock';
import { VaultView } from './VaultView';
import { Btn, MotionRoot, ScreenTransition, useDirection } from './motionkit';

/** vault-list-labels-archive D5: the vault list (and the Edit vault sheet) are one lazily loaded chunk. */
const loadMenu = () => import('./VaultsMenu');

type Screen =
  | { name: 'home' }
  | { name: 'create' }
  | { name: 'unlock' }
  | { name: 'vault'; fresh: boolean; edit?: boolean }
  | { name: 'vaults'; mode: 'picker' | 'menu' };
const SCREEN_ORDER = ['home', 'unlock', 'create', 'vaults', 'vault'] as const;
const keyOf = (v: Pick<VaultSession, 'registry' | 'vaultId'>) => `${v.registry}:${v.vaultId.toLowerCase()}`;

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
  // vault-list-labels-archive D7: the ONLY place decrypted vaults live (the open one, the list, read-only older vaults).
  // Lock, idle, page hide and 60 s hidden replace it with [] in one assignment.
  const [vaults, setVaults] = useState<VaultSession[]>([]);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const session = vaults.find((v) => keyOf(v) === openKey) ?? null;
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
    setVaults([]);
    setOpenKey(null);
    setMirrorItems({});
    epoch.current++;
    setScreen({ name: 'home' });
    setLocked(true);
  }, []);
  const unlocked = vaults.length > 0;
  const { warning, extend } = useAutoLock(unlocked, lock);

  const open = (v: VaultSession, edit = false) => {
    setOpenKey(keyOf(v));
    setScreen({ name: 'vault', fresh: false, edit });
  };
  const onUnlocked = (u: Unlocked) => {
    setVaults(u.vaults);
    setLocked(false);
    if (u.open) open(u.open);
    else setScreen({ name: 'vaults', mode: 'picker' });
  };
  // D6: one more key ceremony; its vaults are merged by vault ID, never duplicated, and nothing is stored.
  // D8: the nonce read when a vault opens; a later write (which sets its own) is never overwritten.
  const pinNonce = useCallback(
    // web-review-followups 3: only for the session whose blob was checked, and only upward.
    (vaultId: string, n: bigint, blob: Uint8Array) =>
      setVaults((vs) => vs.map((v) => (!isOlder(v.registry) && v.vaultId === vaultId && bytesEqual(v.blob, blob) && (v.nonce === undefined || n > v.nonce) ? { ...v, nonce: n } : v))),
    [],
  );
  const history = useMemo(() => ({ rpc: svc.client, keccak256: (b: Uint8Array) => keccak256(b), registries: config.registries }), [svc.client]);
  const menu = useLazyModule(loadMenu, screen.name === 'vaults');
  const vaultsRef = useRef(vaults);
  vaultsRef.current = vaults;
  /** STALE: one more unlock; the same vault replaces this session (D7: still the only decrypted copy). */
  const reload = async (current: VaultSession): Promise<string | null> => {
    const at = epoch.current;
    try {
      const fresh = (await unlockSessions(svc)).find((v) => keyOf(v) === keyOf(current));
      if (epoch.current !== at) return null; // locked meanwhile: drop the result
      if (!fresh) return S.save.reloadMissing;
      if (fresh.version < current.version) return S.save.reloadOlder; // ECC review L1: a lagging RPC, never a rollback
      setVaults((vs) => vs.map((v) => (keyOf(v) === keyOf(fresh) ? fresh : v)));
      return null;
    } catch (e) {
      return e instanceof UnlockError ? S.save.reloadMissing : unlockMessage(e);
    }
  };
  const checkAnother = async (): Promise<string | null> => {
    const at = epoch.current;
    try {
      const more = await unlockSessions(svc);
      if (epoch.current !== at) return null; // locked meanwhile: drop the result
      const known = new Set(vaultsRef.current.map(keyOf));
      const fresh = more.filter((v) => !known.has(keyOf(v)));
      if (fresh.length === 0) return S.unlock.noOther;
      setVaults((vs) => [...vs, ...fresh]);
      return null;
    } catch (e) {
      return e instanceof UnlockError ? S.unlock.noOther : unlockMessage(e);
    }
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
        {warning && unlocked && (
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
              onMirror={(vaultId, version, r) => recordMirror(vaultKey(WRITE_REGISTRY.version, vaultId), version, r)}
              onSaved={(s) => {
                // WEB-M2: under the Shell's auto-lock from the moment it is saved; a lock returns home and unmounts the flow.
                setVaults([s]);
                setOpenKey(keyOf(s));
              }}
              onDone={() => setScreen({ name: 'vault', fresh: true })}
            />
          )}
          {screen.name === 'unlock' && allowed && (
            <UnlockFlow onUnlocked={onUnlocked} onCreate={() => setScreen({ name: 'create' })} onCancel={() => setScreen({ name: 'home' })} />
          )}
          {screen.name === 'vaults' && unlocked && (
            menu.failed ? (
              <ChunkFailed
                onRetry={menu.retry}
                back={session ? { label: S.back, onClick: () => setScreen({ name: 'vault', fresh: false }) } : undefined}
                onLock={lock}
              />
            ) : menu.mod ? (
              <menu.mod.default
                  mode={screen.mode}
                  vaults={vaults}
                  onOpen={(v) => open(v)}
                  onEdit={(v) => open(v, true)}
                  onCheckAnother={checkAnother}
                  history={history}
                  onBack={screen.mode === 'menu' && session ? () => setScreen({ name: 'vault', fresh: false }) : lock}
                />
            ) : (
              <p className="hint" role="status">
                {S.vault.loadingList}
              </p>
            )
          )}
          {screen.name === 'vault' && session && (
            <VaultView
              key={`${keyOf(session)}:${screen.edit ? 'edit' : ''}`}
              session={session}
              locator={session.locator ?? '0x'}
              freshMirror={screen.fresh}
              {...(screen.edit ? { initialMode: 'meta' as const } : {})}
              onChange={(s) => setVaults((vs) => vs.map((v) => (keyOf(v) === keyOf(s) ? s : v)))}
              onLock={lock}
              vaultCount={vaults.length}
              onAllVaults={() => setScreen({ name: 'vaults', mode: 'menu' })}
              onNonce={pinNonce}
              onReload={() => reload(session)}
              mirrorItem={mirrorItems[vaultKey(session.registry, session.vaultId)]}
              onMirror={(version, r) => recordMirror(vaultKey(session.registry, session.vaultId), version, r)}
            />
          )}
        </ScreenTransition>
      </main>
      <AppFooter />
    </div>
  );
}
