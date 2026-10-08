import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import type { SecretItem } from '../vault/payload';
import { visibleName } from '../vault/name';
import { ChunkBoundary, ChunkFailed, cleanItems, useLazyModule, KeyPrompt, Notice, SecretsEditor, StepHeading } from './components';
import { MirrorLine } from './CreateFlow';
import { ensureMirror, errorReference, isReadOnly, messageFor, mirrorWrite, rewrite, saveAddKey, saveEdit, withPayload, type MirrorItem, type MirrorResult, type VaultSession } from './operations';
import { testnetName, useServices } from './services';
import { BUDGET_HINT_AT, pinIfCurrent, savesLeft } from '../account/budget';
import { WriteError } from '../account/errors';
import { S } from './strings';
import { ActionBar, EmptyState } from './chrome';
import { copySecret, forgetClearListener } from './clipboard';
import type { SaveStage } from '../account/errors';
import { AnimatePresence, Btn, CeremonyPresence, Collapse, CopyFeedback, Disclosure, m, SaveProgress, StepTransition, useDirection, useReduced } from './motionkit';
import { reveal } from './motion';

/** show-vault-onchain-location D3: the panel content is a separate chunk, fetched when the disclosure first opens. */
const VaultLocation = lazy(() => import('./VaultLocation'));
/** vault-list-labels-archive: the Edit vault sheet ships in the vault list's chunk. */
const menu = () => import('./VaultsMenu');
const ops = { rewrite, withPayload };

type Mode = 'view' | 'edit' | 'meta' | 'addKey' | 'details';
const MODE_ORDER: readonly Mode[] = ['view', 'edit', 'meta', 'addKey', 'details'];

export function VaultView(props: {
  session: VaultSession;
  locator: `0x${string}`;
  onChange: (s: VaultSession) => void;
  onLock: () => void;
  freshMirror?: boolean;
  /** Opens with the Edit vault sheet (from the vault list's "Edit vault"). */
  initialMode?: 'meta';
  /** How many vaults are open (the "All vaults (N)" button), and the way there. */
  vaultCount?: number;
  onAllVaults?: () => void;
  /** The account nonce to pin (D8), for the session whose blob is `blob`: App stores it if that is still the session. */
  onNonce?: (vaultId: `0x${string}`, nonce: bigint, blob: Uint8Array) => void;
  /** STALE: unlock again (one tap) and replace this session with the vault's current version. A message on failure. */
  onReload?: () => Promise<string | null>;
  /** Focus the vault heading on mount (after a successful Reload remounted this view). */
  focusTitle?: boolean;
  /** This vault's Arweave copy known to the session (App state, so it survives a remount; wiped on lock). */
  mirrorItem?: MirrorItem | undefined;
  /** Reports every mirror result with the version it is for; App validates it and keeps the newest version. */
  onMirror?: (version: number, r: MirrorResult) => void;
}) {
  const svc = useServices();
  const s = props.session;
  const readOnly = isReadOnly(s);
  const [mode, setMode] = useState<Mode>(props.initialMode ?? 'view');
  // Review M6: the Edit vault sheet ships in the vault list chunk; a failed load can be retried.
  const sheet = useLazyModule(menu, mode === 'meta');
  const [shown, setShown] = useState<Set<number>>(new Set());
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorRef, setErrorRef] = useState<string | undefined>(undefined);
  const [prompt, setPrompt] = useState<string | null>(null);
  const [waiting, setWaiting] = useState<(() => void) | null>(null);
  /** Shows `text` with a Continue button and resolves when the user presses it (physical key swap). */
  const confirmStep = (text: string) =>
    new Promise<void>((resolve) => {
      setPrompt(text);
      setWaiting(() => () => {
        setWaiting(null);
        resolve();
      });
    });
  const [draft, setDraft] = useState<SecretItem[]>(s.items);
  const [busy, setBusy] = useState(false);
  const [mirror, setMirror] = useState<MirrorResult | { status: 'pending' } | null>(null);
  const { onMirror } = props;
  const noteMirror = (version: number, r: MirrorResult) => onMirror?.(version, r);
  const healed = useRef(false);
  const dir = useDirection(MODE_ORDER, mode);
  const reduced = useReduced();
  const unblur = reveal(reduced);
  // Save checklist for edit / add key: only stages the write path really reported (app-motion-ux D5).
  const [progress, setProgress] = useState<ReadonlySet<SaveStage> | null>(null);
  const onProgress = (stage: SaveStage) => {
    setProgress((prev) => new Set(prev ?? []).add(stage));
    if (stage === 'sent') setPrompt(null); // signed and accepted: no more touches
  };
  // Copy confirmation: `n` is a counter (the animation key), `i` the row; never the copied value.
  const [copied, setCopied] = useState<{ i: number; n: number } | null>(null);
  const copies = useRef(0);
  // Nothing from this view may outlive it (Lock): drop the clipboard presentation callback on unmount.
  useEffect(() => () => forgetClearListener(), []);
  /** When the real clear timer fires: the chip goes; if the clear was skipped, say so (never imply it was wiped). */
  const clearedFor = (n: number) => (cleared: boolean) => {
    setCopied((c) => (c?.n === n ? null : c));
    if (!cleared) setStatus(S.vault.clearSkipped);
  };
  // Back in view mode after edit / add key / details: focus the vault heading once the transition has finished.
  const title = useRef<HTMLHeadingElement>(null);
  const focusOnMount = useRef(props.focusTitle);
  useEffect(() => {
    if (focusOnMount.current) title.current?.focus();
  }, []);
  const leftView = useRef(false);
  if (mode !== 'view') leftView.current = true;

  // Self-heal the Arweave mirror once per unlock (no key tap needed: the blob is public ciphertext).
  useEffect(() => {
    if (healed.current || props.freshMirror) return;
    healed.current = true;
    void ensureMirror(svc, { vaultId: s.vaultId, version: s.version, blob: s.blob, locator: props.locator, registry: s.registry }).then((m) => {
      if (m.status === 'failed') setMirror(m);
      else onMirror?.(s.version, m);
    });
    // `healed` makes this run once per mount, so a new onMirror identity on re-render never re-runs it.
  }, [svc, s.vaultId, s.version, s.blob, s.registry, props.locator, props.freshMirror, onMirror]);

  function afterWrite(next: VaultSession, extraLocators: `0x${string}`[] = []) {
    props.onChange(next);
    setStatus(S.save.saved);
    setMirror({ status: 'pending' });
    void mirrorWrite(svc, { vaultId: next.vaultId, version: next.version, blob: next.blob, locators: [props.locator, ...extraLocators] }).then((r) => {
      setMirror(r);
      noteMirror(next.version, r);
    });
  }

  // D8/D10: when the vault opens (or reopens after Reload), pin the account's EntryPoint nonce (raw eth_calls; no write
  // stack): nonce, vault, nonce, accepted only when both reads agree and the chain holds this session's blob (D3). It is
  // the base every write of this session is checked against, and it feeds the testnet save-budget hint. If it can't be
  // pinned, saving is refused as STALE (Reload). After a write the pin is never read again: a failed attempt keeps it,
  // a successful one moves it locally (withPayload, saveAddKey).
  const { onNonce } = props;
  const [pinFailed, setPinFailed] = useState(false);
  useEffect(() => {
    if (readOnly || s.nonce !== undefined || !onNonce) return;
    let live = true;
    pinIfCurrent(svc.client, svc.reader, s)
      .then((n) => live && (n === undefined ? setPinFailed(true) : onNonce(s.vaultId, n, s.blob)))
      .catch(() => live && setPinFailed(true));
    return () => {
      live = false;
    };
    // `s` is read only through the fields listed here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readOnly, s.nonce, s.vaultId, s.blob, s.owner, svc.client, svc.reader, onNonce]);
  const [stale, setStale] = useState(false);
  /** Refuses a save up front when the open pin failed (the chain didn't agree on this session's version). */
  const unpinned = () => {
    if (!pinFailed) return false;
    setError(S.save.stale);
    setErrorRef(undefined);
    setStale(true);
    return true;
  };
  async function reload() {
    if (!props.onReload) return;
    setBusy(true);
    setPrompt(S.edit.touchAny);
    try {
      // On success the App replaces the session and remounts this view (a new key), which focuses the heading.
      const msg = await props.onReload();
      if (msg) setError(msg);
    } finally {
      setPrompt(null);
      setBusy(false);
    }
  }
  const left = testnetName(svc.chainId) && s.nonce !== undefined ? savesLeft(Number(s.nonce)) : null;
  const budget = left !== null && left <= BUDGET_HINT_AT ? { text: left === 0 ? S.save.paused : S.save.budget(left), blocked: left === 0 } : undefined;

  /** One write with the usual taps, prompts and checklist. `next === s` (nothing changed) closes without a save. */
  async function run(write: (onSign: () => void) => Promise<VaultSession>) {
    if (unpinned()) return;
    setBusy(true);
    setError(null);
    setErrorRef(undefined);
    setStatus(null);
    setProgress(new Set());
    setPrompt(S.edit.touchAny);
    setStale(false);
    try {
      const next = await write(() => setPrompt(S.edit.touchSame));
      setMode('view');
      if (next === s) setProgress(null);
      else afterWrite(next);
    } catch (e) {
      failed(e);
    } finally {
      setPrompt(null);
      setBusy(false);
    }
  }

  /** A failed save never moves the pin (ECC reviews M1 and 88255e2): the next save is STALE and offers Reload. */
  function failed(e: unknown) {
    setProgress(null);
    setError(messageFor(e));
    setErrorRef(errorReference(e));
    setStale(e instanceof WriteError && e.code === 'STALE');
  }

  const saveDraft = () => run((sign) => saveEdit(svc, s, cleanItems(draft), sign, onProgress));

  async function addKey() {
    if (unpinned()) return;
    setBusy(true);
    setError(null);
    setErrorRef(undefined);
    setStatus(null);
    setProgress(new Set());
    setPrompt(S.addKey.touchCurrent);
    setStale(false);
    try {
      const { session: next, newLocator } = await saveAddKey(svc, s, {
        onInsertNew: () => confirmStep(S.addKey.insertNew),
        onNewAgain: () => setPrompt(S.addKey.touchNewAgain),
        onSign: () => confirmStep(S.addKey.touchCurrentAgain),
        onProgress,
      });
      setMode('view');
      afterWrite(next, [newLocator]);
      setStatus(S.addKey.done);
    } catch (e) {
      failed(e);
    } finally {
      setPrompt(null);
      setWaiting(null);
      setBusy(false);
    }
  }

  function download() {
    const name = `cryoshield-${s.vaultId.slice(2, 10)}.cryo`;
    const url = URL.createObjectURL(new Blob([s.blob.slice().buffer], { type: 'application/octet-stream' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <section aria-labelledby="vault-title" className="step">
      <h1 id="vault-title" ref={title} tabIndex={-1}>
        {visibleName(s.name) === undefined ? S.vault.title : <bdi>{visibleName(s.name)}</bdi>}
      </h1>
      {error && (
        <Notice kind="error" reference={errorRef}>
          {error}
        </Notice>
      )}
      {stale && props.onReload && (
        <p className="notice-action">
          <Btn className="secondary" onClick={reload} disabled={busy}>
            {S.save.reload}
          </Btn>
        </p>
      )}
      {status && <Notice kind="success">{status}</Notice>}
      <CeremonyPresence>{prompt && <KeyPrompt text={prompt} {...(waiting ? { onContinue: waiting } : {})} />}</CeremonyPresence>
      {progress && <SaveProgress reached={progress} {...(mirror && progress.has('confirmed') ? { arweave: mirror.status } : {})} />}
      {mirror && <MirrorLine result={mirror} fastIndexUrl={svc.fastIndexUrl} onRetry={() => {
        setMirror({ status: 'pending' });
        void mirrorWrite(svc, { vaultId: s.vaultId, version: s.version, blob: s.blob, locators: [props.locator], registry: s.registry }).then((r) => {
          setMirror(r);
          noteMirror(s.version, r);
        });
      }} />}

      <StepTransition id={mode} dir={dir}>
        {mode === 'view' && (
          <div>
            <OnArrival run={() => (leftView.current ? title.current?.focus() : undefined)} />
            {readOnly && <Notice kind="info">{S.vault.legacyReadOnly}</Notice>}
            {s.archived && !readOnly && (
              <div className="notice notice-info notice-inline" role="status">
                <p className="notice-text">{S.vault.archived}</p>
                {/* Review WB4: the same zero-saves-left gate as every other save. */}
                <Btn className="secondary" onClick={() => run((sign) => menu().then((m) => m.saveVaultMeta(ops, svc, s, { ...(s.name !== undefined ? { name: s.name } : {}), archived: false }, sign, onProgress)))} disabled={busy || budget?.blocked === true}>
                  {S.vault.unarchive}
                </Btn>
                {budget?.blocked && <p className="hint">{S.save.paused}</p>}
              </div>
            )}
            {s.items.length === 0 && <EmptyState>{S.vault.empty}</EmptyState>}
            <ul className="secrets" aria-label={S.vault.title} hidden={s.items.length === 0}>
              <AnimatePresence initial={false}>
                {s.items.map((it, i) => (
                  <Collapse as="li" key={i} className="secret card">
                    <h3>
                      <bdi>{it.label}</bdi>
                    </h3>
                    <div className="secret-value" aria-live="polite">
                      {/* De-blur only after an explicit Show; the secret is children, never an animated value. */}
                      {shown.has(i) ? (
                        <m.pre initial={unblur.initial} animate={unblur.animate} transition={unblur.transition}>
                          {it.secret}
                        </m.pre>
                      ) : (
                        <span aria-label="hidden">{S.vault.hidden}</span>
                      )}
                    </div>
                    <div className="actions">
                      <Btn
                        className="secondary"
                        aria-pressed={shown.has(i)}
                        onClick={() =>
                          setShown((prev) => {
                            const n = new Set(prev);
                            if (n.has(i)) n.delete(i);
                            else n.add(i);
                            return n;
                          })
                        }
                      >
                        {shown.has(i) ? S.vault.hide : S.vault.show} <span className="sr-only"><bdi>{it.label}</bdi></span>
                      </Btn>
                      <Btn
                        className="secondary"
                        onClick={async () => {
                          const n = ++copies.current;
                          if (await copySecret(it.secret, undefined, clearedFor(n))) {
                            setStatus(S.vault.copied);
                            setCopied({ i, n });
                          }
                        }}
                      >
                        {S.vault.copy} <span className="sr-only"><bdi>{it.label}</bdi></span>
                      </Btn>
                    </div>
                    {copied?.i === i && <CopyFeedback key={copied.n} />}
                  </Collapse>
                ))}
              </AnimatePresence>
            </ul>
            <ActionBar>
              {!readOnly && <Btn onClick={() => { setDraft(s.items); setMode('edit'); setStatus(null); setProgress(null); }}>{S.vault.edit}</Btn>}
              {!readOnly && <Btn className="secondary" onClick={() => { setMode('meta'); setStatus(null); setProgress(null); }}>{S.vault.editVault}</Btn>}
              {!readOnly && <Btn className="secondary" onClick={() => { setMode('addKey'); setStatus(null); setProgress(null); }}>{S.vault.addKey}</Btn>}
              {props.onAllVaults && <Btn className="secondary" onClick={props.onAllVaults}>{S.vault.allVaults(props.vaultCount ?? 1)}</Btn>}
              <Btn className="secondary" onClick={() => { setMode('details'); setProgress(null); }}>{S.vault.details}</Btn>
              <Btn className="secondary" onClick={props.onLock}>{S.vault.lock}</Btn>
            </ActionBar>
            <div className="vault-location-disclosure">
              <Disclosure label={S.location.title}>
                <ChunkBoundary fallback={<p className="hint">{S.location.failed}</p>}>
                <Suspense fallback={<p className="hint">{S.location.loading}</p>}>
                  <VaultLocation
                    network={svc.network}
                    chainId={svc.chainId}
                    registries={svc.registries}
                    registry={s.registry}
                    vaultId={s.vaultId}
                    owner={s.owner}
                    version={s.version}
                    lastSaveTx={s.lastSave?.version === s.version ? s.lastSave.txHash : undefined}
                    mirrorId={props.mirrorItem?.version === s.version ? props.mirrorItem.id : undefined}
                    arweaveGatewayUrl={svc.arweaveGatewayUrl}
                  />
                </Suspense>
                </ChunkBoundary>
              </Disclosure>
            </div>
          </div>
        )}

        {mode === 'edit' && (
          <div>
            <StepHeading>{S.vault.edit}</StepHeading>
            <SecretsEditor rpId={svc.rpId} credIds={s.credIds} items={draft} meta={s} budget={budget} onChange={setDraft} onSave={saveDraft} onCancel={() => setMode('view')} busy={busy} />
          </div>
        )}

        {mode === 'meta' && (
          sheet.failed ? (
            <ChunkFailed onRetry={sheet.retry} back={{ label: S.editor.cancel, onClick: () => setMode('view') }} onLock={props.onLock} />
          ) : sheet.mod ? (
            <>
              <sheet.mod.EditVaultSheet
                session={s}
                busy={busy}
                saveBlocked={budget?.blocked ?? false}
                onSave={(meta) => run((sign) => menu().then((m) => m.saveVaultMeta(ops, svc, s, meta, sign, onProgress)))}
                onClear={() => run((sign) => menu().then((m) => m.archiveAndClear(ops, svc, s, sign, onProgress)))}
                onCancel={() => setMode('view')}
              />
              {budget && <p className="hint">{budget.text}</p>}
            </>
          ) : (
            <p className="hint" role="status">
              {S.location.loading}
            </p>
          )
        )}

        {mode === 'addKey' && (
          <div className="card">
            <StepHeading>{S.addKey.title}</StepHeading>
            {s.credIds.length >= 8 ? (
              <p>{S.addKey.max}</p>
            ) : (
              <ul className="plain-list">
                {S.addKey.explain.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            )}
            <ActionBar>
              {s.credIds.length < 8 && (
                <Btn onClick={addKey} disabled={busy}>
                  {S.addKey.start}
                </Btn>
              )}
              <Btn className="secondary" onClick={() => setMode('view')} disabled={busy}>
                {S.back}
              </Btn>
            </ActionBar>
          </div>
        )}

        {mode === 'details' && (
          <div className="card">
            <StepHeading>{S.details.title}</StepHeading>
            <dl>
              <dt>{S.details.vaultId}</dt>
              <dd className="mono" data-testid="vault-id">{s.vaultId}</dd>
            </dl>
            <p>{S.details.downloadHint}</p>
            <ActionBar>
              <Btn onClick={download}>{S.details.download}</Btn>
              <Btn className="secondary" onClick={() => setMode('view')}>
                {S.details.close}
              </Btn>
            </ActionBar>
          </div>
        )}
      </StepTransition>
    </section>
  );
}

/** Runs `run` when it mounts, i.e. when its step has finished transitioning in. */
function OnArrival({ run }: { run: () => void }) {
  const once = useRef(run);
  useEffect(() => once.current(), []);
  return null;
}
