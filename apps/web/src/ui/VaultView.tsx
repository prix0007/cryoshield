import { useEffect, useRef, useState } from 'react';
import type { SecretItem } from '../vault/payload';
import { cleanItems, KeyPrompt, Notice, SecretsEditor, StepHeading } from './components';
import { MirrorLine } from './CreateFlow';
import { ensureMirror, messageFor, mirrorWrite, saveAddKey, saveEdit, type MirrorStatus, type VaultSession } from './operations';
import { useServices } from './services';
import { S } from './strings';
import { copySecret } from './clipboard';

type Mode = 'view' | 'edit' | 'addKey' | 'details';

export function VaultView(props: {
  session: VaultSession;
  locator: `0x${string}`;
  onChange: (s: VaultSession) => void;
  onLock: () => void;
  freshMirror?: boolean;
}) {
  const svc = useServices();
  const s = props.session;
  const [mode, setMode] = useState<Mode>('view');
  const [shown, setShown] = useState<Set<number>>(new Set());
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
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
  const [mirror, setMirror] = useState<MirrorStatus | null>(null);
  const healed = useRef(false);

  // Self-heal the Arweave mirror once per unlock (no key tap needed: the blob is public ciphertext).
  useEffect(() => {
    if (healed.current || props.freshMirror) return;
    healed.current = true;
    void ensureMirror(svc, { vaultId: s.vaultId, version: s.version, blob: s.blob, locator: props.locator }).then((m) => {
      if (m === 'failed') setMirror('failed');
    });
  }, [svc, s.vaultId, s.version, s.blob, props.locator, props.freshMirror]);

  function afterWrite(next: VaultSession, extraLocators: `0x${string}`[] = []) {
    props.onChange(next);
    setStatus(S.save.saved);
    setMirror('pending');
    void mirrorWrite(svc, { vaultId: next.vaultId, version: next.version, blob: next.blob, locators: [props.locator, ...extraLocators] }).then(setMirror);
  }

  async function saveDraft() {
    setBusy(true);
    setError(null);
    setStatus(null);
    setPrompt(S.edit.touchAny);
    try {
      const next = await saveEdit(svc, s, cleanItems(draft), () => setPrompt(S.edit.touchSame));
      setMode('view');
      afterWrite(next);
    } catch (e) {
      setError(messageFor(e));
    } finally {
      setPrompt(null);
      setBusy(false);
    }
  }

  async function addKey() {
    setBusy(true);
    setError(null);
    setStatus(null);
    setPrompt(S.addKey.touchCurrent);
    try {
      const { session: next, newLocator } = await saveAddKey(svc, s, {
        onInsertNew: () => confirmStep(S.addKey.insertNew),
        onNewAgain: () => setPrompt(S.addKey.touchNewAgain),
        onSign: () => confirmStep(S.addKey.touchCurrentAgain),
      });
      setMode('view');
      afterWrite(next, [newLocator]);
      setStatus(S.addKey.done);
    } catch (e) {
      setError(messageFor(e));
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
    <section aria-labelledby="vault-title">
      <h1 id="vault-title">{S.vault.title}</h1>
      {error && <Notice kind="error">{error}</Notice>}
      {status && <Notice kind="success">{status}</Notice>}
      {prompt && <KeyPrompt text={prompt} {...(waiting ? { onContinue: waiting } : {})} />}
      {mirror && <MirrorLine status={mirror} onRetry={() => {
        setMirror('pending');
        void mirrorWrite(svc, { vaultId: s.vaultId, version: s.version, blob: s.blob, locators: [props.locator] }).then(setMirror);
      }} />}

      {mode === 'view' && (
        <div>
          <ul className="secrets" aria-label={S.vault.title}>
            {s.items.map((it, i) => (
              <li key={i} className="secret">
                <h3>{it.label}</h3>
                <div className="secret-value" aria-live="polite">
                  {shown.has(i) ? <pre>{it.secret}</pre> : <span aria-label="hidden">{S.vault.hidden}</span>}
                </div>
                <div className="actions">
                  <button
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
                  </button>
                  <button
                    className="secondary"
                    onClick={async () => {
                      if (await copySecret(it.secret)) setStatus(S.vault.copied);
                    }}
                  >
                    {S.vault.copy} <span className="sr-only">{it.label}</span>
                  </button>
                </div>
              </li>
            ))}
          </ul>
          <div className="actions">
            <button onClick={() => { setDraft(s.items); setMode('edit'); setStatus(null); }}>{S.vault.edit}</button>
            <button className="secondary" onClick={() => { setMode('addKey'); setStatus(null); }}>{S.vault.addKey}</button>
            <button className="secondary" onClick={() => setMode('details')}>{S.vault.details}</button>
            <button className="secondary" onClick={props.onLock}>{S.vault.lock}</button>
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
        <div>
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
          <div className="actions">
            {s.credIds.length < 8 && (
              <button onClick={addKey} disabled={busy}>
                {S.addKey.start}
              </button>
            )}
            <button className="secondary" onClick={() => setMode('view')} disabled={busy}>
              {S.back}
            </button>
          </div>
        </div>
      )}

      {mode === 'details' && (
        <div>
          <StepHeading>{S.details.title}</StepHeading>
          <dl>
            <dt>{S.details.vaultId}</dt>
            <dd className="mono" data-testid="vault-id">{s.vaultId}</dd>
          </dl>
          <p>{S.details.downloadHint}</p>
          <div className="actions">
            <button onClick={download}>{S.details.download}</button>
            <button className="secondary" onClick={() => setMode('view')}>
              {S.details.close}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
