import { useEffect, useRef, useState } from 'react';
import { deriveLocator } from '@cryoshield/vault-crypto';
import { toHex, wipe } from '../lib/bytes';
import type { SecretItem } from '../vault/payload';
import { WriteError } from '../account/writes';
import { cleanItems, KeyPrompt, Notice, PermanenceAck, SecretsEditor, StepHeading } from './components';
import { enrollWithPrf, errorReference, messageFor, mirrorWrite, saveNewVault, type MirrorStatus, type PendingKey, type VaultSession } from './operations';
import { useServices } from './services';
import { useAutoLock } from './useAutoLock';
import { S } from './strings';
import { ActionBar } from './chrome';

type Step = 'intro' | 'keys' | 'secrets' | 'saving' | 'done';
const MAX_KEYS = 8;

export function CreateFlow(props: { onDone: (s: VaultSession) => void; onCancel: () => void }) {
  const svc = useServices();
  const [step, setStep] = useState<Step>('intro');
  const [keys, setKeys] = useState<PendingKey[]>([]);
  const keysRef = useRef<PendingKey[]>([]);
  const [prompt, setPrompt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorRef, setErrorRef] = useState<string | undefined>(undefined);
  const [items, setItems] = useState<SecretItem[]>([{ label: '', secret: '' }]);
  const [session, setSession] = useState<VaultSession | null>(null);
  const [mirror, setMirror] = useState<MirrorStatus>('pending');
  const [busy, setBusy] = useState(false);
  // Permanence + 18+ acknowledgement: required for every create, kept in memory only (never stored or sent).
  const [ackPermanent, setAckPermanent] = useState(false);
  const [ackAdult, setAckAdult] = useState(false);

  keysRef.current = keys;
  // Idle wipe: PRF outputs held for an unfinished setup are zeroized after 5 minutes without interaction.
  useAutoLock(keys.length > 0 && step !== 'saving' && step !== 'done' && !busy, () => {
    keysRef.current.forEach((k) => wipe(k.prf));
    setKeys([]);
    setItems([{ label: '', secret: '' }]);
    setStep('keys');
    setError(S.create.idleReset);
  });
  // Wipe any PRF outputs still held if the user leaves the flow.
  useEffect(() => () => keysRef.current.forEach((k) => wipe(k.prf)), []);

  async function addKey() {
    const n = keys.length + 1;
    setError(null);
    setErrorRef(undefined);
    setBusy(true);
    setPrompt(S.create.insertKey(n));
    try {
      const k = await enrollWithPrf(svc, n, keys.map((x) => x.credId), () => setPrompt(S.create.touchAgain(n)));
      setKeys((prev) => [...prev, k]);
    } catch (e) {
      setError(messageFor(e));
    } finally {
      setPrompt(null);
      setBusy(false);
    }
  }

  async function save() {
    setError(null);
    setErrorRef(undefined);
    setBusy(true);
    setStep('saving');
    setPrompt(S.save.waitingForKey);
    try {
      // Pass copies: vault-crypto wipes what it is given, and a failed save must be retryable without new taps.
      const attempt = keys.map((k) => ({ ...k, prf: k.prf?.slice() }));
      const { session: s, locators } = await saveNewVault(
        svc,
        attempt,
        cleanItems(items),
        () => setPrompt(S.create.touchToSave),
        () => setError(S.create.retrying),
      );
      setError(null);
      keys.forEach((k) => wipe(k.prf));
      setKeys([]);
      setSession(s);
      setStep('done');
      setPrompt(null);
      void mirrorWrite(svc, { vaultId: s.vaultId, version: s.version, blob: s.blob, locators }).then(setMirror);
    } catch (e) {
      setPrompt(null);
      setError(messageFor(e, 'create'));
      setErrorRef(errorReference(e));
      if (e instanceof WriteError && e.code === 'LOCATOR_FULL' && e.detail.locator) {
        // That key's locator is full (possibly front-run): drop it so the user sets it up again as a fresh
        // credential (new PRF output -> new locator). The other keys stay set up.
        const full = e.detail.locator.toLowerCase();
        const keep: PendingKey[] = [];
        for (const k of keys) {
          const loc = k.prf ? toHex(deriveLocator(k.prf)).toLowerCase() : '';
          if (loc === full) wipe(k.prf);
          else keep.push(k);
        }
        setKeys(keep);
        setStep('keys');
      } else {
        setStep('secrets');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="create-title" className="step">
      <h1 id="create-title">{S.create.title}</h1>
      {error && (
        <Notice kind="error" reference={errorRef}>
          {error}
        </Notice>
      )}
      {prompt && <KeyPrompt text={prompt} />}

      {step === 'intro' && (
        <div className="card">
          <StepHeading>{S.create.introTitle}</StepHeading>
          <ul className="plain-list">
            {S.create.intro.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
          <ActionBar>
            <button onClick={() => setStep('keys')}>{S.create.start}</button>
            <button className="secondary" onClick={props.onCancel}>
              {S.back}
            </button>
          </ActionBar>
        </div>
      )}

      {step === 'keys' && (
        <div className="card">
          <StepHeading>{S.create.keysTitle}</StepHeading>
          <ol className="key-list">
            {keys.map((_, i) => (
              <li key={i} className="key-ready">
                {S.create.keyReady(i + 1)}
              </li>
            ))}
          </ol>
          <ActionBar>
            {keys.length < 2 && (
              <button onClick={addKey} disabled={busy}>
                {S.create.addKey(keys.length + 1)}
              </button>
            )}
            {keys.length >= 2 && keys.length < MAX_KEYS && (
              <button className="secondary" onClick={addKey} disabled={busy}>
                {S.create.addAnother}
              </button>
            )}
            <button onClick={() => setStep('secrets')} disabled={keys.length < 2 || busy} aria-describedby={keys.length < 2 ? 'need-second' : undefined}>
              {S.create.continue}
            </button>
          </ActionBar>
          {keys.length < 2 && (
            <p id="need-second" className="hint">
              {S.create.needSecond}
            </p>
          )}
        </div>
      )}

      {step === 'secrets' && (
        <div>
          <StepHeading>{S.create.secretsTitle}</StepHeading>
          <SecretsEditor
            rpId={svc.rpId}
            credIds={keys.map((k) => k.credId)}
            items={items}
            onChange={setItems}
            onSave={save}
            busy={busy}
            gate={{
              ok: ackPermanent && ackAdult,
              hintId: 'ack-hint',
              content: <PermanenceAck permanent={ackPermanent} adult={ackAdult} onPermanent={setAckPermanent} onAdult={setAckAdult} hintId="ack-hint" />,
            }}
          />
        </div>
      )}

      {step === 'saving' && <StepHeading>{S.create.savingTitle}</StepHeading>}

      {step === 'done' && session && (
        <div className="card">
          <StepHeading>{S.create.doneTitle}</StepHeading>
          <Notice kind="success">{S.save.saved}</Notice>
          {S.create.done.map((t) => (
            <p key={t}>{t}</p>
          ))}
          <MirrorLine status={mirror} onRetry={() => {
            setMirror('pending');
            void mirrorWrite(svc, { vaultId: session.vaultId, version: session.version, blob: session.blob }).then(setMirror);
          }} />
          <ActionBar>
            <button onClick={() => props.onDone(session)}>{S.create.continue}</button>
          </ActionBar>
        </div>
      )}
    </section>
  );
}

export function MirrorLine({ status, onRetry }: { status: MirrorStatus; onRetry: () => void }) {
  if (status === 'saved') return <p role="status">{S.mirror.saved}</p>;
  if (status === 'pending') return <p role="status">{S.mirror.pending}</p>;
  return (
    <div className="notice notice-info" role="status">
      {S.mirror.failed}{' '}
      <button className="secondary" onClick={onRetry}>
        {S.mirror.retry}
      </button>
    </div>
  );
}
