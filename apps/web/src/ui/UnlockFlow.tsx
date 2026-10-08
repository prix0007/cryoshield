import { useState } from 'react';
import { decodeVault } from '@cryoshield/vault-crypto';
import { unlock, UnlockError, type OpenedVault } from '../chain/unlock';
import { KeyError } from '../webauthn';
import { ChainMismatchError } from '../chain/guard';
import { RegistryIncompleteError, RegistryUnconfirmedError } from '../chain/registry';
import { isOlder } from '../config';
import { toHex } from '../lib/bytes';
import { KeyPrompt, Notice, StepHeading } from './components';
import { messageFor, type VaultSession } from './operations';
import { useServices, type Services } from './services';
import { S } from './strings';
import { ActionBar } from './chrome';
import { Btn, CeremonyPresence, StepTransition, useDirection } from './motionkit';

type Phase = 'ready' | 'notFound';
const PHASE_ORDER: readonly Phase[] = ['ready', 'notFound'];

export interface Unlocked {
  /** Every vault this tap opened (vault-list-labels-archive D7: Shell is their only owner). */
  vaults: VaultSession[];
  /** D5: the one active VaultRegistry v2 vault, opened directly; null shows the vault list (picker). */
  open: VaultSession | null;
}

export function toSession(m: OpenedVault, locator: `0x${string}`): VaultSession {
  const s: VaultSession = {
    vaultId: m.vaultId,
    owner: m.owner,
    version: m.version,
    blob: m.blob,
    items: m.items ?? [],
    archived: m.archived,
    credIds: decodeVault(m.blob).entries.map((e) => e.credId),
    registry: m.registry,
    locator,
  };
  if (m.name !== undefined) s.name = m.name;
  if (m.pad !== undefined) s.pad = m.pad;
  if (m.payloadError) s.payloadError = m.payloadError;
  return s;
}

/** One key ceremony: every vault it opens, as sessions. Throws UnlockError('NO_VAULT') and key/network errors. */
export async function unlockSessions(svc: Services): Promise<VaultSession[]> {
  const r = await unlock({ rpId: svc.rpId }, { reader: svc.reader, ...(svc.credentials ? { credentials: svc.credentials } : {}) });
  const locator = toHex(r.locator);
  return r.matches.map((m) => toSession(m, locator));
}

/** Plain message for an unlock failure. */
export function unlockMessage(e: unknown): string {
  if (e instanceof KeyError || e instanceof ChainMismatchError) return messageFor(e);
  if (e instanceof RegistryIncompleteError) return S.unlock.incomplete;
  if (e instanceof RegistryUnconfirmedError) return S.unlock.unconfirmed;
  return S.unlock.networkError;
}

export function UnlockFlow(props: { onUnlocked: (u: Unlocked) => void; onCreate: () => void; onCancel: () => void }) {
  const svc = useServices();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const phase: Phase = notFound ? 'notFound' : 'ready';
  const dir = useDirection(PHASE_ORDER, phase);

  async function go() {
    setBusy(true);
    setError(null);
    setNotFound(false);
    try {
      const vaults = await unlockSessions(svc);
      const readable = vaults.filter((v) => !v.payloadError);
      if (readable.length === 0) {
        setError(vaults[0]!.payloadError === 'UNKNOWN_VERSION' ? S.unlock.newerVersion : S.save.nothingSaved);
        return;
      }
      // D5: exactly one active vault in the newest registry opens directly; anything else shows the list. An archived vault
      // never opens by itself (D13).
      const active = readable.filter((v) => !isOlder(v.registry) && !v.archived);
      props.onUnlocked({ vaults, open: active.length === 1 ? active[0]! : null });
    } catch (e) {
      if (e instanceof UnlockError) setNotFound(true);
      else setError(unlockMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="unlock-title" className="step card">
      <h1 id="unlock-title">{S.unlock.title}</h1>
      <StepHeading>{S.unlock.touch}</StepHeading>
      {error && <Notice kind="error">{error}</Notice>}
      <CeremonyPresence>{busy && <KeyPrompt text={S.unlock.working} />}</CeremonyPresence>
      <StepTransition id={phase} dir={dir}>
        {notFound ? (
          <div>
            <Notice kind="info">{S.unlock.notFound}</Notice>
            <ActionBar>
              <Btn onClick={props.onCreate}>{S.unlock.createInstead}</Btn>
              <Btn className="secondary" onClick={go}>
                {S.unlock.tryAgain}
              </Btn>
            </ActionBar>
          </div>
        ) : (
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
