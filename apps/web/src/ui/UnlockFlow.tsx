import { useState } from 'react';
import { decodeVault } from '@cryoshield/vault-crypto';
import { unlock, UnlockError, type OpenedVault } from '../chain/unlock';
import { KeyError } from '../webauthn';
import { ChainMismatchError } from '../chain/guard';
import { toHex } from '../lib/bytes';
import { KeyPrompt, Notice, StepHeading } from './components';
import { messageFor, type VaultSession } from './operations';
import { useServices } from './services';
import { S } from './strings';
import { ActionBar } from './chrome';

export interface Unlocked {
  session: VaultSession;
  locator: `0x${string}`;
}

function toSession(m: OpenedVault): VaultSession {
  return {
    vaultId: m.vaultId,
    owner: m.owner,
    version: m.version,
    blob: m.blob,
    items: m.items ?? [],
    credIds: decodeVault(m.blob).entries.map((e) => e.credId),
  };
}

export function UnlockFlow(props: { onUnlocked: (u: Unlocked) => void; onCreate: () => void; onCancel: () => void }) {
  const svc = useServices();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [choices, setChoices] = useState<{ matches: OpenedVault[]; locator: `0x${string}` } | null>(null);

  async function go() {
    setBusy(true);
    setError(null);
    setNotFound(false);
    try {
      const r = await unlock({ rpId: svc.rpId }, { reader: svc.reader, ...(svc.credentials ? { credentials: svc.credentials } : {}) });
      const locator = toHex(r.locator);
      const usable = r.matches;
      if (usable.length === 1) return finish(usable[0]!, locator);
      setChoices({ matches: usable, locator });
    } catch (e) {
      if (e instanceof UnlockError) setNotFound(true);
      else if (e instanceof KeyError || e instanceof ChainMismatchError) setError(messageFor(e));
      else setError(S.unlock.networkError);
    } finally {
      setBusy(false);
    }
  }

  function finish(m: OpenedVault, locator: `0x${string}`) {
    if (m.payloadError) {
      setError(m.payloadError === 'UNKNOWN_VERSION' ? S.unlock.newerVersion : S.save.nothingSaved);
      return;
    }
    props.onUnlocked({ session: toSession(m), locator });
  }

  return (
    <section aria-labelledby="unlock-title" className="step card">
      <h1 id="unlock-title">{S.unlock.title}</h1>
      <StepHeading>{S.unlock.touch}</StepHeading>
      {error && <Notice kind="error">{error}</Notice>}
      {busy && <KeyPrompt text={S.unlock.working} />}
      {notFound && (
        <div>
          <Notice kind="info">{S.unlock.notFound}</Notice>
          <ActionBar>
            <button onClick={props.onCreate}>{S.unlock.createInstead}</button>
            <button className="secondary" onClick={go}>
              {S.unlock.tryAgain}
            </button>
          </ActionBar>
        </div>
      )}
      {choices && (
        <div>
          <Notice kind="info">{S.unlock.severalWarning}</Notice>
          <p>{S.unlock.several}</p>
          <ul className="plain-list">
            {choices.matches.map((m, i) => (
              <li key={m.vaultId}>
                <button className="secondary" onClick={() => finish(m, choices.locator)}>
                  {S.unlock.vaultChoice(i, m.version)}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {!notFound && !choices && (
        <ActionBar>
          <button onClick={go} disabled={busy}>
            {S.unlock.button}
          </button>
          <button className="secondary" onClick={props.onCancel} disabled={busy}>
            {S.back}
          </button>
        </ActionBar>
      )}
    </section>
  );
}
