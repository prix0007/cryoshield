import { useState } from 'react';
import { decodeVault } from '@cryoshield/vault-crypto';
import { unlock, UnlockError, type OpenedVault } from '../chain/unlock';
import { KeyError } from '../webauthn';
import { ChainMismatchError } from '../chain/guard';
import { RegistryUnconfirmedError } from '../chain/registry';
import { toHex } from '../lib/bytes';
import { KeyPrompt, Notice, StepHeading } from './components';
import { messageFor, type VaultSession } from './operations';
import { useServices } from './services';
import { S } from './strings';
import { ActionBar } from './chrome';
import { Btn, CeremonyPresence, StepTransition, useDirection } from './motionkit';

type Phase = 'ready' | 'notFound' | 'choices';
const PHASE_ORDER: readonly Phase[] = ['ready', 'notFound', 'choices'];

export interface Unlocked {
  session: VaultSession;
  locator: `0x${string}`;
  /** Legacy VaultRegistry v1 copies this key also opens (read-only), offered behind a small link. */
  older?: VaultSession[];
}

function toSession(m: OpenedVault): VaultSession {
  return {
    vaultId: m.vaultId,
    owner: m.owner,
    version: m.version,
    blob: m.blob,
    items: m.items ?? [],
    archived: m.archived,
    ...(m.name !== undefined ? { name: m.name } : {}),
    ...(m.pad !== undefined ? { pad: m.pad } : {}),
    credIds: decodeVault(m.blob).entries.map((e) => e.credId),
    registry: m.registry,
  };
}

export function UnlockFlow(props: { onUnlocked: (u: Unlocked) => void; onCreate: () => void; onCancel: () => void }) {
  const svc = useServices();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [choices, setChoices] = useState<{ matches: OpenedVault[]; older: OpenedVault[]; locator: `0x${string}` } | null>(null);
  const phase: Phase = choices ? 'choices' : notFound ? 'notFound' : 'ready';
  const dir = useDirection(PHASE_ORDER, phase);

  async function go() {
    setBusy(true);
    setError(null);
    setNotFound(false);
    try {
      const r = await unlock({ rpId: svc.rpId }, { reader: svc.reader, ...(svc.credentials ? { credentials: svc.credentials } : {}) });
      const locator = toHex(r.locator);
      // harden-gas-sponsorship: v2 vaults are current. One v2 vault opens directly, with any v1 copies behind a small
      // link; the picker is only for several v2 vaults. With no v2 vault, the v1 vaults are the choice.
      const current = r.matches.filter((m) => m.registry === 'v2');
      const legacy = r.matches.filter((m) => m.registry !== 'v2');
      const primary = current.length > 0 ? current : legacy;
      const older = current.length > 0 ? legacy : [];
      if (primary.length === 1) return finish(primary[0]!, locator, older);
      setChoices({ matches: primary, older, locator });
    } catch (e) {
      if (e instanceof UnlockError) setNotFound(true);
      else if (e instanceof KeyError || e instanceof ChainMismatchError) setError(messageFor(e));
      else if (e instanceof RegistryUnconfirmedError) setError(S.unlock.unconfirmed);
      else setError(S.unlock.networkError);
    } finally {
      setBusy(false);
    }
  }

  function finish(m: OpenedVault, locator: `0x${string}`, older: OpenedVault[] = []) {
    if (m.payloadError) {
      setError(m.payloadError === 'UNKNOWN_VERSION' ? S.unlock.newerVersion : S.save.nothingSaved);
      return;
    }
    const readable = older.filter((o) => !o.payloadError).map(toSession);
    props.onUnlocked({ session: toSession(m), locator, ...(readable.length > 0 ? { older: readable } : {}) });
  }

  return (
    <section aria-labelledby="unlock-title" className="step card">
      <h1 id="unlock-title">{S.unlock.title}</h1>
      <StepHeading>{S.unlock.touch}</StepHeading>
      {error && <Notice kind="error">{error}</Notice>}
      <CeremonyPresence>{busy && <KeyPrompt text={S.unlock.working} />}</CeremonyPresence>
      <StepTransition id={phase} dir={dir}>
        {notFound && (
          <div>
            <Notice kind="info">{S.unlock.notFound}</Notice>
            <ActionBar>
              <Btn onClick={props.onCreate}>{S.unlock.createInstead}</Btn>
              <Btn className="secondary" onClick={go}>
                {S.unlock.tryAgain}
              </Btn>
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
                  <Btn className="secondary" onClick={() => finish(m, choices.locator, choices.older)}>
                    {S.unlock.vaultChoice(i, m.version)}
                  </Btn>
                </li>
              ))}
            </ul>
            {choices.older.length > 0 && (
              <Btn className="link-button" onClick={() => finish(choices.older[0]!, choices.locator)}>
                {S.unlock.olderVault}
              </Btn>
            )}
          </div>
        )}
        {!notFound && !choices && (
          <ActionBar>
            <Btn onClick={go} disabled={busy}>
              {S.unlock.button}
            </Btn>
            <Btn className="secondary" onClick={props.onCancel} disabled={busy}>
              {S.back}
            </Btn>
          </ActionBar>
        )}
      </StepTransition>
    </section>
  );
}
