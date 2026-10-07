import { useEffect, useRef, useState } from 'react';
import { wipe } from '../lib/bytes';
import type { SecretItem } from '../vault/payload';
import type { SaveStage } from '../account/errors';
import { cleanItems, KeyPrompt, Notice, PermanenceAck, SecretsEditor, StepHeading } from './components';
import { enrollWithPrf, errorReference, messageFor, mirrorWrite, saveNewVault, type MirrorResult, type PendingKey, type VaultSession } from './operations';
import { useServices } from './services';
import { useAutoLock } from './useAutoLock';
import { S } from './strings';
import { ActionBar } from './chrome';
import { AnimatePresence, Btn, CeremonyPresence, Disclosure, KeySlot, SaveProgress, StepTransition, useDirection } from './motionkit';

type Step = 'intro' | 'keys' | 'secrets' | 'saving' | 'done';
const STEP_ORDER: readonly Step[] = ['intro', 'keys', 'secrets', 'saving', 'done'];
const MAX_KEYS = 8;

export function CreateFlow(props: {
  onDone: (s: VaultSession) => void;
  onCancel: () => void;
  /** Every mirror result, even one that arrives after Continue (show-vault-onchain-location). */
  onMirror?: (vaultId: `0x${string}`, version: number, r: MirrorResult) => void;
}) {
  const svc = useServices();
  const [step, setStep] = useState<Step>('intro');
  const [keys, setKeys] = useState<PendingKey[]>([]);
  const keysRef = useRef<PendingKey[]>([]);
  const [prompt, setPrompt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorRef, setErrorRef] = useState<string | undefined>(undefined);
  const [items, setItems] = useState<SecretItem[]>([{ label: '', secret: '' }]);
  const [session, setSession] = useState<VaultSession | null>(null);
  const [mirror, setMirror] = useState<MirrorResult | { status: 'pending' }>({ status: 'pending' });
  // Locators known from creation, reused on Retry (fix-arweave-mirror-status D2).
  const [knownLocators, setKnownLocators] = useState<`0x${string}`[]>([]);
  const [busy, setBusy] = useState(false);
  // Permanence + 18+ acknowledgement: required for every create, kept in memory only (never stored or sent).
  const [ackPermanent, setAckPermanent] = useState(false);
  const [ackAdult, setAckAdult] = useState(false);
  // Save checklist: stages the write path has REALLY reported (app-motion-ux D5).
  const [reached, setReached] = useState<ReadonlySet<SaveStage>>(new Set());
  // Bumped by the idle wipe so the old step is dropped at once, with no exit animation.
  const [epoch, setEpoch] = useState(0);
  const dir = useDirection(STEP_ORDER, step);

  keysRef.current = keys;
  // Idle wipe: PRF outputs held for an unfinished setup are zeroized after 5 minutes without interaction.
  useAutoLock(keys.length > 0 && step !== 'saving' && step !== 'done' && !busy, () => {
    keysRef.current.forEach((k) => wipe(k.prf));
    setKeys([]);
    setItems([{ label: '', secret: '' }]);
    setStep('keys');
    setEpoch((n) => n + 1);
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
    setReached(new Set());
    setPrompt(S.save.waitingForKey);
    try {
      // Pass copies: vault-crypto wipes what it is given, and a failed save must be retryable without new taps.
      const attempt = keys.map((k) => ({ ...k, prf: k.prf?.slice() }));
      const { session: s, locators } = await saveNewVault(
        svc,
        attempt,
        cleanItems(items),
        () => setPrompt(S.create.touchToSave),
        (stage) => {
          setReached((prev) => new Set(prev).add(stage));
          if (stage === 'sent') setPrompt(null); // signed and accepted: no more touches for this attempt
        },
      );
      setError(null);
      keys.forEach((k) => wipe(k.prf));
      setKeys([]);
      setSession(s);
      setStep('done');
      setPrompt(null);
      setKnownLocators(locators);
      void mirrorWrite(svc, { vaultId: s.vaultId, version: s.version, blob: s.blob, locators }).then((r) => {
        setMirror(r);
        props.onMirror?.(s.vaultId, s.version, r);
      });
    } catch (e) {
      setPrompt(null);
      setError(messageFor(e, 'create'));
      setErrorRef(errorReference(e));
      setStep('secrets');
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
      <CeremonyPresence>{prompt && <KeyPrompt text={prompt} />}</CeremonyPresence>

      <StepTransition id={step} dir={dir} epoch={epoch}>
        {step === 'intro' && (
          <div className="card">
            <StepHeading>{S.create.introTitle}</StepHeading>
            <ul className="plain-list">
              {S.create.intro.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
            <ActionBar>
              <Btn onClick={() => setStep('keys')}>{S.create.start}</Btn>
              <Btn className="secondary" onClick={props.onCancel}>
                {S.back}
              </Btn>
            </ActionBar>
          </div>
        )}

        {step === 'keys' && (
          <div className="card">
            <StepHeading>{S.create.keysTitle}</StepHeading>
            <ol className="key-list">
              <AnimatePresence initial={false}>
                {/* Slot keys are positions, never credential data. */}
                {keys.map((_, i) => (
                  <KeySlot key={i}>{S.create.keyReady(i + 1)}</KeySlot>
                ))}
              </AnimatePresence>
            </ol>
            <ActionBar>
              {keys.length < 2 && (
                <Btn onClick={addKey} disabled={busy}>
                  {S.create.addKey(keys.length + 1)}
                </Btn>
              )}
              {keys.length >= 2 && keys.length < MAX_KEYS && (
                <Btn className="secondary" onClick={addKey} disabled={busy}>
                  {S.create.addAnother}
                </Btn>
              )}
              <Btn onClick={() => setStep('secrets')} disabled={keys.length < 2 || busy} aria-describedby={keys.length < 2 ? 'need-second' : undefined}>
                {S.create.continue}
              </Btn>
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

        {step === 'saving' && (
          <div>
            <StepHeading>{S.create.savingTitle}</StepHeading>
            <SaveProgress reached={reached} />
          </div>
        )}

        {step === 'done' && session && (
          <div className="card">
            <StepHeading>{S.create.doneTitle}</StepHeading>
            <Notice kind="success">{S.save.saved}</Notice>
            <SaveProgress reached={reached} arweave={mirror.status} />
            {S.create.done.map((t) => (
              <p key={t}>{t}</p>
            ))}
            <MirrorLine result={mirror} fastIndexUrl={svc.fastIndexUrl} onRetry={() => {
              setMirror({ status: 'pending' });
              void mirrorWrite(svc, { vaultId: session.vaultId, version: session.version, blob: session.blob, locators: knownLocators }).then((r) => {
                setMirror(r);
                props.onMirror?.(session.vaultId, session.version, r);
              });
            }} />
            <ActionBar>
              <Btn onClick={() => props.onDone(session)}>{S.create.continue}</Btn>
            </ActionBar>
          </div>
        )}
      </StepTransition>
    </section>
  );
}

export function MirrorLine({ result, fastIndexUrl, onRetry }: { result: MirrorResult | { status: 'pending' }; fastIndexUrl: string; onRetry: () => void }) {
  if (result.status === 'pending') return <p role="status">{S.mirror.pending}</p>;
  if (result.status === 'saved') {
    const id = 'itemId' in result && result.itemId && /^[A-Za-z0-9_-]{43}$/.test(result.itemId) ? result.itemId : null;
    return (
      <div role="status" className="mirror-saved">
        <p className="notice-text">{S.mirror.saved}</p>
        {id && (
          <p className="hint">
            {S.mirror.item}{' '}
            <a className="mono" href={`${fastIndexUrl}/${id}`} rel="noopener noreferrer">
              {id}
            </a>
            . {S.mirror.settleNote}
          </p>
        )}
      </div>
    );
  }
  return (
    <div className="notice notice-info notice-inline" role="status">
      <p className="notice-text">{S.mirror.failed}</p>
      <Btn className="secondary" onClick={onRetry}>
        {S.mirror.retry}
      </Btn>
      {'ref' in result && result.ref && (
        <Disclosure label={S.save.details}>
          <code className="mono">{result.ref}</code>
        </Disclosure>
      )}
    </div>
  );
}
