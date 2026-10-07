import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import type { SecretItem } from '../vault/payload';
import { cleanItems, KeyPrompt, Notice, SecretsEditor, StepHeading } from './components';
import { MirrorLine } from './CreateFlow';
import { ensureMirror, errorReference, isReadOnly, messageFor, mirrorWrite, saveAddKey, saveEdit, type MirrorResult, type VaultSession } from './operations';
import { useServices } from './services';
import { S } from './strings';
import { ActionBar, EmptyState } from './chrome';
import { copySecret, forgetClearListener } from './clipboard';
import type { SaveStage } from '../account/writes';
import { AnimatePresence, Btn, CeremonyPresence, Collapse, CopyFeedback, Disclosure, m, SaveProgress, StepTransition, useDirection, useReduced } from './motionkit';
import { reveal } from './motion';

/** show-vault-onchain-location D3: the panel content is a separate chunk, fetched when the disclosure first opens. */
const VaultLocation = lazy(() => import('./VaultLocation'));

type Mode = 'view' | 'edit' | 'addKey' | 'details';
const MODE_ORDER: readonly Mode[] = ['view', 'edit', 'addKey', 'details'];

export function VaultView(props: {
  session: VaultSession;
  locator: `0x${string}`;
  onChange: (s: VaultSession) => void;
  onLock: () => void;
  freshMirror?: boolean;
  /** Opens the legacy v1 copy this key also opens (harden-gas-sponsorship). */
  onOpenOlder?: () => void;
  /** From a legacy v1 copy, back to the current v2 vault. */
  onBackToCurrent?: () => void;
}) {
  const svc = useServices();
  const s = props.session;
  const readOnly = isReadOnly(s);
  const [mode, setMode] = useState<Mode>('view');
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
  // The Arweave item this session uploaded or byte-verified, for the version it belongs to (show-vault-onchain-location).
  const [mirrorItem, setMirrorItem] = useState<{ version: number; id: string } | null>(s.mirrorItem ?? null);
  const noteMirror = (version: number, r: MirrorResult) => {
    if (r.status === 'saved' && r.itemId) setMirrorItem({ version, id: r.itemId });
  };
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
  const leftView = useRef(false);
  if (mode !== 'view') leftView.current = true;

  // Self-heal the Arweave mirror once per unlock (no key tap needed: the blob is public ciphertext).
  useEffect(() => {
    if (healed.current || props.freshMirror) return;
    healed.current = true;
    void ensureMirror(svc, { vaultId: s.vaultId, version: s.version, blob: s.blob, locator: props.locator, registry: s.registry }).then((m) => {
      if (m.status === 'failed') setMirror(m);
      else noteMirror(s.version, m);
    });
  }, [svc, s.vaultId, s.version, s.blob, s.registry, props.locator, props.freshMirror]);

  function afterWrite(next: VaultSession, extraLocators: `0x${string}`[] = []) {
    props.onChange(next);
    setStatus(S.save.saved);
    setMirror({ status: 'pending' });
    void mirrorWrite(svc, { vaultId: next.vaultId, version: next.version, blob: next.blob, locators: [props.locator, ...extraLocators] }).then((r) => {
      setMirror(r);
      noteMirror(next.version, r);
    });
  }

  async function saveDraft() {
    setBusy(true);
    setError(null);
    setErrorRef(undefined);
    setStatus(null);
    setProgress(new Set());
    setPrompt(S.edit.touchAny);
    try {
      const next = await saveEdit(svc, s, cleanItems(draft), () => setPrompt(S.edit.touchSame), onProgress);
      setMode('view');
      afterWrite(next);
    } catch (e) {
      setProgress(null);
      setError(messageFor(e));
      setErrorRef(errorReference(e));
    } finally {
      setPrompt(null);
      setBusy(false);
    }
  }

  async function addKey() {
    setBusy(true);
    setError(null);
    setErrorRef(undefined);
    setStatus(null);
    setProgress(new Set());
    setPrompt(S.addKey.touchCurrent);
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
      setProgress(null);
      setError(messageFor(e));
      setErrorRef(errorReference(e));
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
        {S.vault.title}
      </h1>
      {error && (
        <Notice kind="error" reference={errorRef}>
          {error}
        </Notice>
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
            {s.items.length === 0 && <EmptyState>{S.vault.empty}</EmptyState>}
            <ul className="secrets" aria-label={S.vault.title} hidden={s.items.length === 0}>
              <AnimatePresence initial={false}>
                {s.items.map((it, i) => (
                  <Collapse as="li" key={i} className="secret card">
                    <h3>{it.label}</h3>
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
                        {shown.has(i) ? S.vault.hide : S.vault.show} <span className="sr-only">{it.label}</span>
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
                        {S.vault.copy} <span className="sr-only">{it.label}</span>
                      </Btn>
                    </div>
                    {copied?.i === i && <CopyFeedback key={copied.n} />}
                  </Collapse>
                ))}
              </AnimatePresence>
            </ul>
            <ActionBar>
              {!readOnly && <Btn onClick={() => { setDraft(s.items); setMode('edit'); setStatus(null); setProgress(null); }}>{S.vault.edit}</Btn>}
              {!readOnly && <Btn className="secondary" onClick={() => { setMode('addKey'); setStatus(null); setProgress(null); }}>{S.vault.addKey}</Btn>}
              <Btn className="secondary" onClick={() => { setMode('details'); setProgress(null); }}>{S.vault.details}</Btn>
              <Btn className="secondary" onClick={props.onLock}>{S.vault.lock}</Btn>
            </ActionBar>
            {props.onOpenOlder && (
              <Btn className="link-button" onClick={props.onOpenOlder}>
                {S.unlock.olderVault}
              </Btn>
            )}
            {props.onBackToCurrent && (
              <Btn className="link-button" onClick={props.onBackToCurrent}>
                {S.vault.backToCurrent}
              </Btn>
            )}
            <div className="vault-location-disclosure">
              <Disclosure label={S.location.title}>
                <Suspense fallback={<p className="hint">{S.location.loading}</p>}>
                  <VaultLocation
                    network={svc.network}
                    chainId={svc.chainId}
                    registry={{ address: s.registry === 'v2' ? svc.registries.v2 : svc.registries.v1, version: s.registry }}
                    vaultId={s.vaultId}
                    owner={s.owner}
                    version={s.version}
                    lastSaveTx={s.lastSave?.version === s.version ? s.lastSave.txHash : undefined}
                    mirrorId={mirrorItem?.version === s.version ? mirrorItem.id : undefined}
                    arweaveGatewayUrl={svc.arweaveGatewayUrl}
                  />
                </Suspense>
              </Disclosure>
            </div>
          </div>
        )}

        {mode === 'edit' && (
          <div>
            <StepHeading>{S.vault.edit}</StepHeading>
            <SecretsEditor rpId={svc.rpId} credIds={s.credIds} items={draft} onChange={setDraft} onSave={saveDraft} onCancel={() => setMode('view')} busy={busy} />
          </div>
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
