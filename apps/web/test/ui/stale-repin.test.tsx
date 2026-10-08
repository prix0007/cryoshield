/**
 * web-review-followups 3 (review WB3, N2; ECC reviews of 86fbc66 and 88255e2): the session's nonce pin, and STALE.
 * - The pin is read once, when the vault opens (or reopens after Reload): nonce, then the vault, then the nonce again;
 *   accepted only when both nonce reads agree and the chain holds the session's blob; one retry, otherwise saving is
 *   refused as STALE (Reload).
 * - After a write the pin never depends on RPC reads: a failed attempt never moves it (the next save is STALE and
 *   offers Reload); a successful one moves it locally to pinned + 1.
 * - Reload: one key tap (with the prompt), remounts the vault view, refuses an older version, keeps the session when
 *   the key doesn't open it, and returns focus to the vault heading.
 */
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as ops from '../../src/ui/operations';
import * as unlockMod from '../../src/chain/unlock';
import { WriteError } from '../../src/account/errors';
import { S } from '../../src/ui/strings';
import { renderApp } from './helpers';

const id = (n: number) => new Uint8Array(48).fill(n);
const VAULT_ID = ('0x' + '12'.repeat(32)) as `0x${string}`;
const OWNER = ('0x' + '34'.repeat(20)) as `0x${string}`;
const BLOB = new Uint8Array(400).fill(1);
const opened = (label = 'Seed', version = 1, blob = BLOB) => ({
  vaultId: VAULT_ID,
  owner: OWNER,
  version,
  blob,
  items: [{ label, secret: 'abandon art' }],
  archived: false,
  entryIndex: 0,
  registry: 'v2' as const,
});
let chain: { nonce: bigint; blob: Uint8Array; nonceReads: bigint[] };
let nonceReads = 0;
const client = {
  request: vi.fn(async ({ method }: { method: string }) => {
    if (method !== 'eth_call') throw new Error(method);
    nonceReads++;
    const n = chain.nonceReads.length ? chain.nonceReads.shift()! : chain.nonce;
    return '0x' + n.toString(16);
  }),
};
const reader = { getVault: async () => ({ vaultId: VAULT_ID, owner: OWNER, blob: chain.blob, version: 1, registry: 'v2' as const }) };

beforeEach(async () => {
  vi.restoreAllMocks();
  chain = { nonce: 5n, blob: BLOB, nonceReads: [] };
  nonceReads = 0;
  vi.spyOn(await import('@cryoshield/vault-crypto'), 'decodeVault').mockReturnValue({ entries: [{ credId: id(1) }, { credId: id(2) }] } as never);
  vi.spyOn(ops, 'mirrorWrite').mockResolvedValue({ status: 'saved' });
  vi.spyOn(ops, 'ensureMirror').mockResolvedValue({ status: 'saved' });
});

/** Unlocks, and waits until the open pin's reads are done (`reads` nonce reads). */
async function openVault(reads = 2) {
  const unlock = vi.spyOn(unlockMod, 'unlock').mockResolvedValue({ credId: id(1), locator: new Uint8Array(32), matches: [opened()] });
  const u = userEvent.setup();
  renderApp({ client: client as never, reader: reader as never });
  await u.click(screen.getByRole('button', { name: 'Unlock my vault' }));
  await u.click(screen.getByRole('button', { name: 'Unlock with my key' }));
  await screen.findByRole('heading', { name: 'Seed' });
  await waitFor(() => expect(nonceReads).toBe(reads), { timeout: 3_000 });
  await act(async () => undefined); // the pin is applied after the last read
  return { u, unlock };
}
/** Opens the editor if it isn't open (a failed save keeps it open, with the unsaved text), then saves. */
async function save(u: ReturnType<typeof userEvent.setup>) {
  const edit = screen.queryByRole('button', { name: S.vault.edit });
  if (edit) await u.click(edit);
  await u.click(await screen.findByRole('button', { name: 'Save' }));
}

describe('the pin after a write never depends on RPC reads', () => {
  it.each(['REVERTED', 'NONCE_CONFLICT', 'NOT_CONFIRMED', 'NETWORK'] as const)('a failed attempt (%s) never moves the pin, whatever the RPC says next', async (code) => {
    const edit = vi
      .spyOn(ops, 'saveEdit')
      .mockImplementationOnce(async () => {
        chain.nonce = 6n; // a write landed somewhere, and a lagging node still returns the old blob
        throw new WriteError(code);
      })
      .mockImplementationOnce(async (_svc, s, items) => ({ ...s, items, version: 2 }));
    const { u } = await openVault();
    await save(u);
    await screen.findByRole('alert');
    const readsAfterFailure = nonceReads;
    await save(u);
    await waitFor(() => expect(edit).toHaveBeenCalledTimes(2));
    expect(edit.mock.calls[0]![1].nonce).toBe(5n);
    // Still 5: the write stack's assertCurrent then sees nonce 6 > 5 and refuses (STALE, Reload), never overwriting.
    expect(edit.mock.calls[1]![1].nonce).toBe(5n);
    expect(nonceReads).toBe(readsAfterFailure); // no re-pin reads at all
  });

  it('a successful save moves the pin locally to pinned + 1, with no RPC read (a lagging RPC changes nothing)', async () => {
    const edit = vi.spyOn(ops, 'saveEdit').mockImplementation(async (_svc, s, items) => ({ ...s, items, version: s.version + 1, blob: new Uint8Array(400).fill(s.version + 1), nonce: (s.nonce ?? 0n) + 1n }));
    const { u } = await openVault();
    await save(u);
    await screen.findByText(S.save.saved);
    chain.nonce = 9n; // whatever a node says now is never read
    await save(u);
    await waitFor(() => expect(edit).toHaveBeenCalledTimes(2));
    expect(edit.mock.calls[1]![1].nonce).toBe(6n);
    expect(nonceReads).toBe(2); // only the open pin's two reads
  });
});

describe('the open pin: nonce, vault, nonce', () => {
  it('both nonce reads agree and the blob is the session\'s: pinned', async () => {
    const edit = vi.spyOn(ops, 'saveEdit').mockImplementation(async (_svc, s, items) => ({ ...s, items, version: 2 }));
    const { u } = await openVault();
    await save(u);
    await waitFor(() => expect(edit).toHaveBeenCalled());
    expect(edit.mock.calls[0]![1].nonce).toBe(5n);
  });

  it('the nonce reads disagree, then agree on the retry: pinned to the agreed value', async () => {
    chain.nonceReads = [5n, 6n];
    chain.nonce = 6n;
    const edit = vi.spyOn(ops, 'saveEdit').mockImplementation(async (_svc, s, items) => ({ ...s, items, version: 2 }));
    const { u } = await openVault(4);
    await save(u);
    await waitFor(() => expect(edit).toHaveBeenCalled());
    expect(edit.mock.calls[0]![1].nonce).toBe(6n);
  });

  it('they disagree twice: saving is refused as STALE (Reload), and nothing is written', async () => {
    chain.nonceReads = [5n, 6n, 6n, 7n];
    const edit = vi.spyOn(ops, 'saveEdit');
    const { u } = await openVault(4);
    await save(u);
    expect(await screen.findByRole('alert')).toHaveTextContent(S.save.stale);
    expect(screen.getByRole('button', { name: S.save.reload })).toBeInTheDocument();
    expect(edit).not.toHaveBeenCalled();
  });

  it('N2: the chain shows another blob at open (twice): STALE on save, not a pin over a lagging read', async () => {
    chain.blob = new Uint8Array(400).fill(9);
    const edit = vi.spyOn(ops, 'saveEdit');
    const { u } = await openVault(4);
    await save(u);
    expect(await screen.findByRole('alert')).toHaveTextContent(S.save.stale);
    expect(edit).not.toHaveBeenCalled();
  });
});

describe('STALE offers "Reload vault"', () => {
  it('one key tap (with the prompt) reloads the current version, remounts the view and focuses the heading', async () => {
    vi.spyOn(ops, 'saveEdit').mockRejectedValue(new WriteError('STALE'));
    const { u, unlock } = await openVault();
    await u.click(screen.getByRole('button', { name: `Show ${'Seed'}` }));
    expect(screen.getByText('abandon art')).toBeInTheDocument();
    await save(u);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(S.save.stale);
    let release!: () => void;
    unlock.mockImplementationOnce(
      () =>
        new Promise((r) => {
          release = () => r({ credId: id(1), locator: new Uint8Array(32), matches: [opened('Changed elsewhere', 3, new Uint8Array(400).fill(3))] });
        }),
    );
    await u.click(screen.getByRole('button', { name: S.save.reload }));
    expect(await screen.findByText(S.edit.touchAny)).toBeInTheDocument(); // the key prompt during the ceremony
    await act(async () => release());
    const heading = await screen.findByRole('heading', { level: 1, name: S.vault.title });
    expect(screen.getByRole('heading', { name: 'Changed elsewhere' })).toBeInTheDocument();
    await waitFor(() => expect(heading).toHaveFocus());
    expect(screen.queryByText(S.save.stale)).toBeNull();
    // Remounted: the earlier "Show" does not carry over to the new items.
    expect(screen.queryByText('abandon art')).toBeNull();
  });

  it('L1: a reload that returns an OLDER version than the session (lagging RPC) is refused: "try again"', async () => {
    vi.spyOn(ops, 'saveEdit').mockRejectedValue(new WriteError('STALE'));
    const { u, unlock } = await openVault();
    await save(u);
    await screen.findByRole('alert');
    unlock.mockResolvedValueOnce({ credId: id(1), locator: new Uint8Array(32), matches: [{ ...opened('Older copy', 0, new Uint8Array(400).fill(4)) }] });
    await u.click(screen.getByRole('button', { name: S.save.reload }));
    expect(await screen.findByText(S.save.reloadOlder)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Older copy' })).toBeNull();
    expect(screen.getByRole('button', { name: S.save.reload })).toBeInTheDocument();
  });

  it('a reload whose key no longer opens this vault says so and keeps the session', async () => {
    vi.spyOn(ops, 'saveEdit').mockRejectedValue(new WriteError('STALE'));
    const { u, unlock } = await openVault();
    await save(u);
    await screen.findByRole('alert');
    unlock.mockRejectedValueOnce(new unlockMod.UnlockError('NO_VAULT'));
    await u.click(screen.getByRole('button', { name: S.save.reload }));
    expect(await screen.findByText(S.save.reloadMissing)).toBeInTheDocument();
    // The session and the unsaved edit are kept; Reload is still offered, in the one action area.
    expect(screen.getByRole('button', { name: S.save.reload })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: S.save.reload }).closest('.action-bar')).toBeNull();
  });
});
