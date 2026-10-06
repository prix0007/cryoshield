import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as ops from '../../src/ui/operations';
import * as unlockMod from '../../src/chain/unlock';
import { WriteError } from '../../src/account/writes';
import { KeyError } from '../../src/webauthn';
import { acknowledge, renderApp } from './helpers';

const id = (n: number) => new Uint8Array(48).fill(n);
const key = (n: number) => ({ credId: id(n), publicKey: ('0x' + 'aa'.repeat(64)) as `0x${string}`, prf: new Uint8Array(32).fill(n) });
const session = (items = [{ label: 'Bitcoin seed', secret: 'abandon art' }]) => ({
  vaultId: ('0x' + '12'.repeat(32)) as `0x${string}`,
  owner: ('0x' + '34'.repeat(20)) as `0x${string}`,
  version: 1,
  blob: new Uint8Array(400).fill(1),
  items,
  credIds: [id(1), id(2)],
  registry: 'v2' as const,
});

beforeEach(async () => {
  vi.restoreAllMocks();
  vi.spyOn(await import('@cryoshield/vault-crypto'), 'decodeVault').mockReturnValue({ entries: [{ credId: id(1) }, { credId: id(2) }] } as never);
  vi.spyOn(ops, 'mirrorWrite').mockResolvedValue({ status: 'saved' });
  vi.spyOn(ops, 'ensureMirror').mockResolvedValue({ status: 'saved' });
});

describe('create flow (8.1)', () => {
  it('walks intro -> keys -> secrets -> done, with finish blocked until 2 keys', async () => {
    const u = userEvent.setup();
    vi.spyOn(ops, 'enrollWithPrf').mockImplementation(async (_s, n) => key(n));
    const save = vi.spyOn(ops, 'saveNewVault').mockImplementation(async (_s, _k, items, onSign) => {
      onSign();
      return { session: { ...session(items) }, locators: [] };
    });
    renderApp();
    await u.click(screen.getByRole('button', { name: 'Create a new vault' }));
    expect(screen.getByRole('heading', { name: 'How it works' })).toHaveFocus();
    await u.click(screen.getByRole('button', { name: 'Get started' }));
    expect(screen.getByRole('heading', { name: 'Set up your keys' })).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
    expect(screen.getByText('Add a second key so you’re never locked out')).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: 'Set up key 1' }));
    expect(await screen.findByText('Key 1 is ready.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
    await u.click(screen.getByRole('button', { name: 'Set up key 2' }));
    expect(await screen.findByText('Key 2 is ready.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Set up another key (optional)' })).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByRole('heading', { name: 'Add your secrets' })).toHaveFocus();
    await u.type(screen.getByLabelText('Name'), 'Bitcoin seed');
    await u.type(screen.getByLabelText('Secret'), 'abandon art');
    expect(screen.getByText(/characters of space left/)).toBeInTheDocument();
    await acknowledge(u); // add-privacy-and-compliance 4.1: permanence + 18+ before the first write
    await u.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('heading', { name: 'Your vault is saved' })).toHaveFocus();
    expect(screen.getByText(/Keep your keys in separate places/)).toBeInTheDocument();
    expect(save.mock.calls[0]![2]).toEqual([{ label: 'Bitcoin seed', secret: 'abandon art' }]);
  });

  it('shows the plain message for a too-old key', async () => {
    const u = userEvent.setup();
    vi.spyOn(ops, 'enrollWithPrf').mockRejectedValue(new KeyError('PRF_UNSUPPORTED_KEY'));
    renderApp();
    await u.click(screen.getByRole('button', { name: 'Create a new vault' }));
    await u.click(screen.getByRole('button', { name: 'Get started' }));
    await u.click(screen.getByRole('button', { name: 'Set up key 1' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This key is too old');
  });

  it('blocks saving when the payload does not fit', async () => {
    const u = userEvent.setup();
    vi.spyOn(ops, 'enrollWithPrf').mockImplementation(async (_s, n) => key(n));
    renderApp();
    await u.click(screen.getByRole('button', { name: 'Create a new vault' }));
    await u.click(screen.getByRole('button', { name: 'Get started' }));
    await u.click(screen.getByRole('button', { name: 'Set up key 1' }));
    await screen.findByText('Key 1 is ready.');
    await u.click(screen.getByRole('button', { name: 'Set up key 2' }));
    await screen.findByText('Key 2 is ready.');
    await u.click(screen.getByRole('button', { name: 'Continue' }));
    await u.click(screen.getByLabelText('Secret'));
    await u.paste('x'.repeat(900));
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(screen.getByText(/Too much text: remove about \d+ characters/)).toBeInTheDocument();
  });
});

describe('harden-gas-sponsorship 5.2: no "vault number taken" retry', () => {
  it('the create flow no longer has a retry message', async () => {
    const { S } = await import('../../src/ui/strings');
    expect(JSON.stringify(S)).not.toMatch(/same vault number|filled its slot/);
  });
});

describe('unlock and view (8.2)', () => {
  it('one button; items hidden until Show; no-vault offers Create', async () => {
    const u = userEvent.setup();
    const spy = vi.spyOn(unlockMod, 'unlock').mockRejectedValueOnce(new unlockMod.UnlockError('NO_VAULT'));
    renderApp();
    await u.click(screen.getByRole('button', { name: 'Unlock my vault' }));
    await u.click(screen.getByRole('button', { name: 'Unlock with my key' }));
    expect(await screen.findByText('We couldn’t find a vault for this key.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create a vault' })).toBeInTheDocument();

    const s = session();
    spy.mockResolvedValueOnce({ credId: id(1), locator: new Uint8Array(32).fill(3), matches: [{ ...s, entryIndex: 0 }] });
    await u.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: 'Bitcoin seed' })).toBeInTheDocument();
    expect(screen.queryByText('abandon art')).toBeNull();
    await u.click(screen.getByRole('button', { name: 'Show Bitcoin seed' }));
    expect(screen.getByText('abandon art')).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: 'Hide Bitcoin seed' }));
    expect(screen.queryByText('abandon art')).toBeNull();
  });

  it('a payload from a newer version shows nothing', async () => {
    const u = userEvent.setup();
    const s = session();
    vi.spyOn(unlockMod, 'unlock').mockResolvedValue({ credId: id(1), locator: new Uint8Array(32), matches: [{ ...s, items: null, payloadError: 'UNKNOWN_VERSION', entryIndex: 0 }] });
    renderApp();
    await u.click(screen.getByRole('button', { name: 'Unlock my vault' }));
    await u.click(screen.getByRole('button', { name: 'Unlock with my key' }));
    expect(await screen.findByText('This vault was made by a newer version of CryoShield. Please update and try again.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Your vault' })).toBeNull();
  });

  it('several vaults for one key: lets the user choose', async () => {
    const u = userEvent.setup();
    const a = { ...session([{ label: 'A', secret: 'a' }]), entryIndex: 0 };
    const b = { ...session([{ label: 'B', secret: 'b' }]), vaultId: ('0x' + '56'.repeat(32)) as `0x${string}`, version: 3, entryIndex: 0 };
    vi.spyOn(unlockMod, 'unlock').mockResolvedValue({ credId: id(1), locator: new Uint8Array(32), matches: [b, a] });
    renderApp();
    await u.click(screen.getByRole('button', { name: 'Unlock my vault' }));
    await u.click(screen.getByRole('button', { name: 'Unlock with my key' }));
    expect(await screen.findByText(/This is unusual. Each of these vaults was created with this key/)).toBeInTheDocument();
    await u.click(await screen.findByRole('button', { name: 'Vault 1 (saved 3 times)' }));
    expect(await screen.findByRole('heading', { name: 'B' })).toBeInTheDocument();
  });
});

async function openVault(u: ReturnType<typeof userEvent.setup>, s = session(), credIds?: Uint8Array[]) {
  vi.spyOn(unlockMod, 'unlock').mockResolvedValue({ credId: id(1), locator: new Uint8Array(32), matches: [{ ...s, entryIndex: 0, ...(credIds ? {} : {}) }] });
  renderApp();
  await u.click(screen.getByRole('button', { name: 'Unlock my vault' }));
  await u.click(screen.getByRole('button', { name: 'Unlock with my key' }));
  await screen.findByRole('heading', { name: 'Your vault', exact: true } as never);
}

describe('edit and add key (6.7, 6.8, 8.3)', () => {
  it('paymaster refusal shows "Saving is paused" and keeps the draft', async () => {
    const u = userEvent.setup();
    vi.spyOn(ops, 'saveEdit').mockRejectedValue(new WriteError('SPONSORSHIP_REFUSED'));
    await openVaultReal(u);
    await u.click(screen.getByRole('button', { name: 'Edit secrets' }));
    await u.clear(screen.getByLabelText('Secret'));
    await u.type(screen.getByLabelText('Secret'), 'new value');
    await u.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Saving is paused right now');
    expect(screen.getByLabelText('Secret')).toHaveValue('new value');
  });

  it('a reverted save says nothing was saved', async () => {
    const u = userEvent.setup();
    vi.spyOn(ops, 'saveEdit').mockRejectedValue(new WriteError('REVERTED'));
    await openVaultReal(u);
    await u.click(screen.getByRole('button', { name: 'Edit secrets' }));
    await u.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Nothing was saved');
  });

  it('add-key explains that one current key and the new key are needed; enforces 8 keys', async () => {
    const u = userEvent.setup();
    await openVaultReal(u);
    await u.click(screen.getByRole('button', { name: 'Add a key' }));
    expect(screen.getByText(/one key you already use for this vault, and the new key/)).toBeInTheDocument();
  });

  it('8-key vault cannot add more', async () => {
    const u = userEvent.setup();
    await openVaultReal(u, { ...session(), credIds: Array.from({ length: 8 }, (_, i) => id(i + 1)) });
    await u.click(screen.getByRole('button', { name: 'Add a key' }));
    expect(screen.getByText('This vault already has the maximum of 8 keys.')).toBeInTheDocument();
  });
});

async function openVaultReal(u: ReturnType<typeof userEvent.setup>, s: ReturnType<typeof session> = session()) {
  const { encodeVault } = await import('@cryoshield/vault-crypto');
  void encodeVault;
  vi.spyOn(unlockMod, 'unlock').mockResolvedValue({ credId: id(1), locator: new Uint8Array(32), matches: [{ ...s, entryIndex: 0 }] });
  vi.spyOn(await import('@cryoshield/vault-crypto'), 'decodeVault').mockReturnValue({ entries: s.credIds.map((c) => ({ credId: c })) } as never);
  renderApp();
  await u.click(screen.getByRole('button', { name: 'Unlock my vault' }));
  await u.click(screen.getByRole('button', { name: 'Unlock with my key' }));
  await screen.findByRole('button', { name: 'Edit secrets' });
}
void openVault;
void act;
void waitFor;

describe('harden-gas-sponsorship: v2 is authoritative', () => {
  it('when v2 can’t be confirmed, unlock opens nothing and says it couldn’t confirm the latest version', async () => {
    const u = userEvent.setup();
    const { RegistryUnconfirmedError } = await import('../../src/chain/registry');
    vi.spyOn(unlockMod, 'unlock').mockRejectedValue(new RegistryUnconfirmedError('v2 down'));
    renderApp();
    await u.click(screen.getByRole('button', { name: 'Unlock my vault' }));
    await u.click(screen.getByRole('button', { name: 'Unlock with my key' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('We couldn’t confirm the latest version of your vault');
    expect(screen.queryByRole('heading', { name: 'Your vault', exact: true } as never)).toBeNull();
    expect(screen.queryByText('We couldn’t find a vault for this key.')).toBeNull();
  });
});

describe('harden-gas-sponsorship: v2 vault opens directly; v1 copies behind a small link', () => {
  const v2 = () => ({ ...session([{ label: 'Current', secret: 'new' }]), version: 4, entryIndex: 0 });
  const v1 = () => ({ ...session([{ label: 'Legacy', secret: 'old' }]), vaultId: ('0x' + '77'.repeat(32)) as `0x${string}`, registry: 'v1' as const, entryIndex: 0 });

  async function unlockWith(matches: unknown[]) {
    const u = userEvent.setup();
    vi.spyOn(unlockMod, 'unlock').mockResolvedValue({ credId: id(1), locator: new Uint8Array(32), matches } as never);
    renderApp();
    await u.click(screen.getByRole('button', { name: 'Unlock my vault' }));
    await u.click(screen.getByRole('button', { name: 'Unlock with my key' }));
    return u;
  }

  it('one v2 match plus a v1 copy: opens the v2 vault with no picker; the link opens the v1 copy read-only and comes back', async () => {
    const u = await unlockWith([v2(), v1()]);
    expect(await screen.findByRole('heading', { name: 'Current' })).toBeInTheDocument();
    expect(screen.queryByText(/This key opens more than one vault/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Edit secrets' })).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: 'Open an older test vault' }));
    expect(await screen.findByRole('heading', { name: 'Legacy' })).toBeInTheDocument();
    expect(screen.getByText(/made with an earlier test version/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit secrets' })).toBeNull();
    await u.click(screen.getByRole('button', { name: 'Back to your current vault' }));
    expect(await screen.findByRole('heading', { name: 'Current' })).toBeInTheDocument();
  });

  it('several v2 vaults: the picker lists only the v2 vaults, with the older link below', async () => {
    const other = { ...v2(), vaultId: ('0x' + '56'.repeat(32)) as `0x${string}`, version: 2 };
    await unlockWith([v2(), other, v1()]);
    expect(await screen.findByText(/This key opens more than one vault/)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Vault \d/ })).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Open an older test vault' })).toBeInTheDocument();
  });

  it('only a v1 vault: it opens directly (read-only), with no older link', async () => {
    await unlockWith([v1()]);
    expect(await screen.findByRole('heading', { name: 'Legacy' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open an older test vault' })).toBeNull();
  });

  it('Lock drops every held vault, including the older copies', async () => {
    const u = await unlockWith([v2(), v1()]);
    await screen.findByRole('heading', { name: 'Current' });
    await u.click(screen.getByRole('button', { name: 'Lock' }));
    expect(screen.queryByText('Legacy')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Open an older test vault' })).toBeNull();
  });
});

describe('harden-gas-sponsorship: a VaultRegistry v1 vault opens read-only', () => {
  it('shows and copies secrets, offers details and download, but no Edit or Add key, with a plain notice', async () => {
    const u = userEvent.setup();
    const save = vi.spyOn(ops, 'saveEdit');
    vi.spyOn(unlockMod, 'unlock').mockResolvedValue({ credId: id(1), locator: new Uint8Array(32), matches: [{ ...session(), registry: 'v1', entryIndex: 0 }] });
    renderApp();
    await u.click(screen.getByRole('button', { name: 'Unlock my vault' }));
    await u.click(screen.getByRole('button', { name: 'Unlock with my key' }));
    expect(await screen.findByRole('heading', { name: 'Bitcoin seed' })).toBeInTheDocument();
    expect(screen.getByText(/made with an earlier test version/)).toBeInTheDocument();
    expect(screen.getByText(/create a new vault and copy your secrets into it/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit secrets' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add a key' })).toBeNull();
    await u.click(screen.getByRole('button', { name: 'Show Bitcoin seed' }));
    expect(screen.getByText('abandon art')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy Bitcoin seed' })).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: 'Vault details' }));
    expect(screen.getByRole('button', { name: /Download/ })).toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
  });

  it('a v2 vault keeps Edit and Add key', async () => {
    const u = userEvent.setup();
    await openVaultReal(u);
    expect(screen.getByRole('button', { name: 'Add a key' })).toBeInTheDocument();
    expect(screen.queryByText(/made with an earlier test version/)).toBeNull();
  });
});

describe('review fix 3: create flow idle wipe', () => {
  it('after 5 minutes idle, wipes enrolled PRF outputs and resets the flow', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const u = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const held: Uint8Array[] = [];
      vi.spyOn(ops, 'enrollWithPrf').mockImplementation(async (_s, n) => {
        const k = key(n);
        held.push(k.prf);
        return k;
      });
      renderApp();
      await u.click(screen.getByRole('button', { name: 'Create a new vault' }));
      await u.click(screen.getByRole('button', { name: 'Get started' }));
      await u.click(screen.getByRole('button', { name: 'Set up key 1' }));
      await screen.findByText('Key 1 is ready.');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5 * 60_000 + 10);
      });
      expect(held[0]!.every((x) => x === 0)).toBe(true);
      expect(screen.queryByText('Key 1 is ready.')).toBeNull();
      expect(screen.getByText(/setup was cancelled because nothing happened for 5 minutes/i)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('wrong network (target-op-sepolia review)', () => {
  it('unlock on a mismatched chain shows the wrong-network message, not "no vault"', async () => {
    const u = userEvent.setup();
    const { ChainMismatchError } = await import('../../src/chain/guard');
    vi.spyOn(unlockMod, 'unlock').mockRejectedValue(new ChainMismatchError(31337, 10));
    renderApp();
    await u.click(screen.getByRole('button', { name: 'Unlock my vault' }));
    await u.click(screen.getByRole('button', { name: 'Unlock with my key' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('connected to the wrong network');
    expect(screen.queryByText('We couldn’t find a vault for this key.')).toBeNull();
  });
});
