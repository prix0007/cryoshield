/**
 * vault-list-labels-archive 3.1-3.4 and 4.1 (UI): the lazily loaded vault list in picker and menu modes, D13, Check
 * another key, the Edit vault sheet (one write; no-op none), Unarchive, Archive and clear's confirmation, the name at
 * create, the testnet save-budget hint, <bdi> isolation, and that names and labels never leave the page's memory.
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as ops from '../../src/ui/operations';
import * as unlockMod from '../../src/chain/unlock';
import { WriteError } from '../../src/account/errors';
import { S } from '../../src/ui/strings';
import { VAULTS } from '../../src/ui/strings-vaults';
import { credentialLabel } from '../../src/webauthn';
import { HIDDEN_MS } from '../../src/ui/useAutoLock';
import * as historyMod from '../../src/chain/history';
import { acknowledge, fakeServices, renderApp } from './helpers';

const stack = vi.hoisted(() => ({ nonce: 0, metaCalls: [] as unknown[][], clearCalls: [] as unknown[][] }));
vi.mock('../../src/account/stack', async (orig) => ({
  ...(await orig<typeof import('../../src/account/stack')>()),
}));
vi.mock('../../src/ui/vault-meta', async (orig) => {
  const real = await orig<typeof import('../../src/ui/vault-meta')>();
  return {
    ...real,
    saveVaultMeta: vi.fn(async (_ops: unknown, _svc: unknown, s: ops.VaultSession, meta: { name?: string; archived: boolean }, onSign: () => void) => {
      stack.metaCalls.push([meta]);
      if (meta.name === s.name && meta.archived === s.archived) return s;
      onSign();
      const next: ops.VaultSession = { ...s, archived: meta.archived, version: s.version + 1 };
      if (meta.name === undefined) delete next.name;
      else next.name = meta.name;
      return next;
    }),
    archiveAndClear: vi.fn(async (_ops: unknown, _svc: unknown, s: ops.VaultSession, onSign: () => void) => {
      stack.clearCalls.push([s.vaultId]);
      onSign();
      return { ...s, archived: true, items: [], pad: '000', version: s.version + 1 };
    }),
  };
});

const id = (n: number) => new Uint8Array(48).fill(n);
/** An RPC that answers the EntryPoint nonce read (eth_call) with `stack.nonce`, and nothing else. */
const nonceClient = () => ({ request: async ({ method }: { method: string }) => (method === 'eth_call' ? '0x' + stack.nonce.toString(16) : Promise.reject(new Error(method))) }) as never;
const hex = (n: number) => ('0x' + n.toString(16).padStart(2, '0').repeat(32)) as `0x${string}`;
const vault = (n: number, over: Partial<unlockMod.OpenedVault> = {}): unlockMod.OpenedVault => ({
  vaultId: hex(n),
  owner: ('0x' + '34'.repeat(20)) as `0x${string}`,
  version: 1,
  blob: new Uint8Array(400).fill(n),
  items: [{ label: `Label ${n}`, secret: `SECRET-${n}` }],
  archived: false,
  entryIndex: 0,
  registry: 'v2',
  ...over,
});
const unlockReturns = (...taps: unlockMod.OpenedVault[][]) => {
  const spy = vi.spyOn(unlockMod, 'unlock');
  for (const matches of taps) spy.mockResolvedValueOnce({ credId: id(1), locator: new Uint8Array(32), matches });
  return spy;
};
/** The chain holds each listed vault's own blob (vault(n) is filled with n), so its nonce can be pinned (followups 3). */
const chainReader = { getVault: async (vaultId: `0x${string}`) => ({ vaultId, blob: new Uint8Array(400).fill(parseInt(vaultId.slice(2, 4), 16)) }) } as never;
async function unlockApp(over: Parameters<typeof renderApp>[0] = {}) {
  const u = userEvent.setup();
  const r = renderApp({ reader: chainReader, ...over });
  await u.click(screen.getByRole('button', { name: 'Unlock my vault' }));
  await u.click(screen.getByRole('button', { name: 'Unlock with my key' }));
  return { u, ...r };
}

beforeEach(async () => {
  stack.nonce = 0;
  stack.metaCalls.length = 0;
  stack.clearCalls.length = 0;
  vi.spyOn(ops, 'ensureMirror').mockResolvedValue({ status: 'saved' });
  vi.spyOn(ops, 'mirrorWrite').mockResolvedValue({ status: 'saved' });
  vi.spyOn(await import('@cryoshield/vault-crypto'), 'decodeVault').mockReturnValue({ entries: [{ credId: id(1) }, { credId: id(2) }, { credId: id(3) }], keyCount: 3 } as never);
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('3.1 the vault list (picker mode)', () => {
  it('row summary: name, Active, 5 secrets, the first 3 labels, "+2 more", "any 1 of 3 keys"; names and labels in <bdi>', async () => {
    const work = vault(1, { name: 'Work', items: ['A', 'B', 'C', 'D', 'E'].map((l) => ({ label: l, secret: 's' })) });
    unlockReturns([work, vault(2)]);
    await unlockApp();
    const row = (await screen.findByRole('heading', { name: 'Work', level: 3 })).closest('li')!;
    expect(row).toHaveTextContent('Active · 5 secrets · any 1 of 3 keys');
    expect(row).toHaveTextContent('Secrets: A, B, C +2 more');
    expect(row.querySelector('h3 bdi')).toHaveTextContent('Work');
    expect([...row.querySelectorAll('p bdi')].map((b) => b.textContent)).toEqual(['A', 'B', 'C']);
    expect(row).not.toHaveTextContent('s s');
  });

  it('labels are cut at 24 characters and a name with nothing visible is "Unnamed vault"', async () => {
    unlockReturns([vault(1, { name: '\u200d \u200c', items: [{ label: 'x'.repeat(30), secret: 's' }] }), vault(2)]);
    await unlockApp();
    const rows = within(await screen.findByRole('region', { name: VAULTS.groupActive })).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('Unnamed vault');
    expect(rows[0]).toHaveTextContent(`${'x'.repeat(24)}…`);
    expect(rows[0]).not.toHaveTextContent('x'.repeat(25));
  });

  it('archived vaults sit behind "Show archived (N)"; older test vaults behind "Open an older test vault"', async () => {
    unlockReturns([vault(1), vault(2), vault(3, { archived: true, name: 'Old' }), vault(4, { registry: 'v1' })]);
    const { u } = await unlockApp();
    await screen.findByRole('region', { name: VAULTS.groupActive });
    expect(screen.queryByRole('heading', { name: 'Old' })).toBeNull();
    await u.click(screen.getByRole('button', { name: 'Show archived (1)' }));
    expect(await screen.findByRole('heading', { name: 'Old' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: VAULTS.showOlder })).toHaveAttribute('aria-expanded', 'false');
  });

  it('D13: a key whose only vault is archived shows the list, expanded, with the note, and opens nothing', async () => {
    unlockReturns([vault(1, { archived: true, name: 'Family' })]);
    await unlockApp();
    expect(await screen.findByText(VAULTS.archivedOnly)).toBeInTheDocument();
    const group = screen.getByRole('region', { name: VAULTS.groupArchived });
    expect(within(group).getByRole('heading', { name: 'Family' })).toBeInTheDocument();
    expect(within(group).getByText(/^Archived ·/)).toBeInTheDocument();
    expect(screen.queryByText(S.unlock.notFound)).toBeNull();
    expect(screen.queryByRole('button', { name: S.vault.edit })).toBeNull(); // no vault view
  });

  it('an archived vault next to one active vault: the active one opens; the archived one is in "All vaults (2)"', async () => {
    unlockReturns([vault(1, { name: 'Now' }), vault(2, { archived: true, name: 'Before' })]);
    const { u } = await unlockApp();
    expect(await screen.findByRole('heading', { name: 'Now', level: 1 })).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: 'All vaults (2)' }));
    expect(await screen.findByRole('heading', { name: 'Before' })).toBeInTheDocument();
  });

  it('a vault made by a newer version is listed without an Open action', async () => {
    unlockReturns([vault(1, { name: 'A' }), vault(2, { name: 'B' }), vault(3, { items: null, payloadError: 'UNKNOWN_VERSION' })]);
    await unlockApp();
    expect(within(await screen.findByRole('region', { name: VAULTS.groupActive })).getAllByRole('listitem')).toHaveLength(2);
    const rows = within(screen.getByRole('region', { name: VAULTS.groupNewer })).getAllByRole('listitem');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent(VAULTS.newer);
    expect(within(rows[0]!).queryByRole('button')).toBeNull();
  });

  it('dates come lazily from the chain; a refused query leaves "Date unavailable" and every vault listed', async () => {
    unlockReturns([vault(1), vault(2)]);
    const request = vi.fn(async () => {
      throw new Error('refused');
    });
    await unlockApp({ client: { request } as never });
    await waitFor(() => expect(screen.getAllByText(/Created Date unavailable · Last saved Date unavailable/)).toHaveLength(2));
  });
});

describe('3.2 Check another key (D6)', () => {
  it('two keys, three vaults: the second tap is merged by vault ID, each vault once', async () => {
    unlockReturns([vault(1, { name: 'One' }), vault(2, { name: 'Two' })], [vault(2, { name: 'Two' }), vault(3, { name: 'Three' })]);
    const { u } = await unlockApp();
    await screen.findByRole('heading', { name: 'One' });
    await u.click(screen.getByRole('button', { name: VAULTS.checkAnother }));
    expect(await screen.findByRole('heading', { name: 'Three' })).toBeInTheDocument();
    const names = within(screen.getByRole('region', { name: VAULTS.groupActive })).getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(names).toEqual(['One', 'Two', 'Three']);
    expect(localStorage.length + sessionStorage.length).toBe(0);
  });

  it('a key that adds nothing says so', async () => {
    unlockReturns([vault(1), vault(2)], [vault(2)]);
    const { u } = await unlockApp();
    await u.click(await screen.findByRole('button', { name: VAULTS.checkAnother }));
    expect(await screen.findByText(S.unlock.noOther)).toBeInTheDocument();
  });

  it('a key with no vault says so too, not "not found"', async () => {
    const spy = unlockReturns([vault(1), vault(2)]);
    spy.mockRejectedValueOnce(new unlockMod.UnlockError('NO_VAULT'));
    const { u } = await unlockApp();
    await u.click(await screen.findByRole('button', { name: VAULTS.checkAnother }));
    expect(await screen.findByText(S.unlock.noOther)).toBeInTheDocument();
  });
});

describe('3.2 auto-lock wipes every listed vault (D7)', () => {
  it('hidden for 60 seconds: the list is gone and the unlock screen is back', async () => {
    unlockReturns([vault(1, { name: 'One' }), vault(2, { name: 'Two' }), vault(3, { name: 'Three' })]);
    await unlockApp();
    await screen.findByRole('heading', { name: 'Three' });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(HIDDEN_MS + 10);
    });
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    expect(screen.queryByRole('heading', { name: 'One' })).toBeNull();
    expect(screen.queryByText('Label 1')).toBeNull();
    expect(screen.getByText(S.vault.locked)).toBeInTheDocument();
  });

  it('pagehide wipes the list at once', async () => {
    unlockReturns([vault(1, { name: 'One' }), vault(2, { name: 'Two' })]);
    await unlockApp();
    await screen.findByRole('heading', { name: 'Two' });
    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });
    expect(screen.queryByRole('heading', { name: 'Two' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Unlock my vault' })).toBeInTheDocument();
  });
});

describe('3.3 Edit vault and the archived state', () => {
  async function openNamed(over: Partial<unlockMod.OpenedVault> = {}) {
    unlockReturns([vault(1, { name: 'Family', ...over })]);
    const r = await unlockApp();
    if (over.archived) await r.u.click(await screen.findByRole('button', { name: 'Open Family' })); // D13: listed, not opened
    await screen.findByRole('heading', { name: 'Family', level: 1 });
    return r;
  }

  it('the name is the heading, in <bdi>', async () => {
    await openNamed();
    expect(screen.getByRole('heading', { level: 1 }).querySelector('bdi')).toHaveTextContent('Family');
  });

  it('rename and archive in one save: one update; the vault then shows the new name and the Archived notice', async () => {
    const { u } = await openNamed();
    await u.click(screen.getByRole('button', { name: S.vault.editVault }));
    const name = await screen.findByLabelText(VAULTS.sheet.name);
    await u.clear(name);
    await u.type(name, 'Old family');
    await u.click(screen.getByRole('checkbox', { name: VAULTS.sheet.archive }));
    expect(screen.getByText(VAULTS.sheet.anyKey)).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: VAULTS.sheet.save }));
    expect(await screen.findByRole('heading', { name: 'Old family', level: 1 })).toBeInTheDocument();
    expect(stack.metaCalls).toEqual([[{ name: 'Old family', archived: true }]]);
    expect(screen.getByText(S.vault.archived)).toBeInTheDocument();
  });

  it('no-op Save sends nothing', async () => {
    const { u } = await openNamed();
    await u.click(screen.getByRole('button', { name: S.vault.editVault }));
    await u.click(await screen.findByRole('button', { name: VAULTS.sheet.save }));
    expect(stack.metaCalls).toEqual([]);
    expect(await screen.findByRole('button', { name: S.vault.editVault })).toBeInTheDocument();
  });

  it('an invalid name is refused in the form', async () => {
    const { u } = await openNamed();
    await u.click(screen.getByRole('button', { name: S.vault.editVault }));
    const name = await screen.findByLabelText(VAULTS.sheet.name);
    fireEvent.change(name, { target: { value: 'a\u202eb' } });
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText(S.create.nameInvalid)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: VAULTS.sheet.save })).toBeDisabled();
    await u.click(screen.getByRole('button', { name: VAULTS.sheet.cancel }));
    expect(stack.metaCalls).toEqual([]);
  });

  it('an archived vault shows the notice, and Unarchive is one update', async () => {
    const { u } = await openNamed({ archived: true });
    expect(screen.getByText(S.vault.archived)).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: S.vault.unarchive }));
    await waitFor(() => expect(screen.queryByText(S.vault.archived)).toBeNull());
    expect(stack.metaCalls).toEqual([[{ name: 'Family', archived: false }]]);
  });

  it('a stale vault says so and offers "Reload vault" (D8; web-review-followups 3)', async () => {
    vi.spyOn(ops, 'saveEdit').mockRejectedValue(new WriteError('STALE'));
    const { u } = await openNamed();
    await u.click(screen.getByRole('button', { name: S.vault.edit }));
    await u.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(S.save.stale);
    expect(screen.getByRole('button', { name: S.save.reload })).toBeInTheDocument();
  });

  it('menu mode: every group expanded, Edit vault only for VaultRegistry v2 vaults', async () => {
    unlockReturns([vault(1, { name: 'Main' }), vault(2, { archived: true, name: 'Arch' }), vault(3, { registry: 'v1', name: undefined })]);
    const { u } = await unlockApp();
    await u.click(await screen.findByRole('button', { name: 'All vaults (3)' }));
    expect(await screen.findByRole('region', { name: VAULTS.groupArchived })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: VAULTS.groupOlder })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Edit vault/ })).toHaveLength(2);
    await u.click(screen.getByRole('button', { name: 'Edit vault Arch' }));
    expect(await screen.findByLabelText(VAULTS.sheet.name)).toHaveValue('Arch');
  });
});

describe('4.1 Archive and clear', () => {
  it('needs the confirmation box; then it is one update; the copy is honest', async () => {
    unlockReturns([vault(1, { name: 'Family' })]);
    const { u } = await unlockApp();
    await u.click(await screen.findByRole('button', { name: S.vault.editVault }));
    await u.click(await screen.findByRole('button', { name: VAULTS.clear.open }));
    const button = screen.getByRole('button', { name: VAULTS.clear.button });
    expect(button).toBeDisabled();
    const copy = screen.getByRole('group', { name: VAULTS.clear.title }).textContent!;
    expect(copy).toMatch(/chain history/);
    expect(copy).toMatch(/Arweave/);
    expect(copy).toMatch(/any of this vault’s keys and its PIN/);
    expect(copy).toMatch(/change it at its source/);
    await u.click(button);
    expect(stack.clearCalls).toEqual([]);
    await u.click(screen.getByRole('checkbox', { name: VAULTS.clear.confirm }));
    await u.click(screen.getByRole('button', { name: VAULTS.clear.button }));
    await waitFor(() => expect(stack.clearCalls).toHaveLength(1));
    expect(await screen.findByText(S.vault.archived)).toBeInTheDocument();
    expect(screen.getByText(S.vault.empty)).toBeInTheDocument();
  });
});

describe('3.3 testnet save-budget hint (D10)', () => {
  async function editOn(chainId: number) {
    unlockReturns([vault(1)]);
    const { u } = await unlockApp({ chainId, client: nonceClient() });
    await u.click(await screen.findByRole('button', { name: S.vault.edit }));
  }
  it('nonce 43 on OP Sepolia: "About 7 free saves left"', async () => {
    stack.nonce = 43;
    await editOn(11155420);
    expect(await screen.findByText('About 7 free saves left')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });
  it('nonce 50: Save is disabled and "Saving is paused" is shown', async () => {
    stack.nonce = 50;
    await editOn(11155420);
    expect(await screen.findByText(S.save.paused)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });
  it('review WB4: at 0 free saves, Unarchive is blocked too (the same gate as Save)', async () => {
    stack.nonce = 50;
    unlockReturns([vault(1, { name: 'Family', archived: true })]);
    const { u } = await unlockApp({ chainId: 11155420, client: nonceClient() });
    await u.click(await screen.findByRole('button', { name: 'Open Family' }));
    const unarchive = await screen.findByRole('button', { name: S.vault.unarchive });
    await waitFor(() => expect(unarchive).toBeDisabled());
    expect(screen.getByText(S.save.paused)).toBeInTheDocument();
    await u.click(unarchive);
    expect(stack.metaCalls).toEqual([]);
  });
  it('review WB4: with saves left, Unarchive works', async () => {
    stack.nonce = 45;
    unlockReturns([vault(1, { name: 'Family', archived: true })]);
    const { u } = await unlockApp({ chainId: 11155420, client: nonceClient() });
    await u.click(await screen.findByRole('button', { name: 'Open Family' }));
    const unarchive = await screen.findByRole('button', { name: S.vault.unarchive });
    expect(unarchive).toBeEnabled();
  });
  it('more than 10 left: no hint', async () => {
    stack.nonce = 3;
    await editOn(11155420);
    await act(async () => undefined);
    expect(screen.queryByText(/free saves left/)).toBeNull();
  });
  it('mainnet: never a hint', async () => {
    stack.nonce = 49;
    await editOn(10);
    await act(async () => undefined);
    expect(screen.queryByText(/free saves left/)).toBeNull();
  });
});

describe('3.4 name at create and month-only credential labels (D12)', () => {
  it('the label is "CryoShield vault · <Mon YYYY> (key n)"', () => {
    expect(credentialLabel(1, new Date(2026, 9, 15))).toBe('CryoShield vault · Oct 2026 (key 1)');
    expect(credentialLabel(2, new Date(2027, 0, 1))).toBe('CryoShield vault · Jan 2027 (key 2)');
  });

  it('enrollment sends the month-only label as user.name and displayName', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 15));
    const users: PublicKeyCredentialUserEntity[] = [];
    const credentials = {
      create: vi.fn(async (o: CredentialCreationOptions) => {
        users.push(o.publicKey!.user);
        throw Object.assign(new Error('x'), { name: 'NotAllowedError' });
      }),
      get: vi.fn(),
    };
    await ops.enrollWithPrf(fakeServices({ credentials }), 2, []).catch(() => undefined);
    expect(users[0]).toMatchObject({ name: 'CryoShield vault \u00b7 Oct 2026 (key 2)', displayName: 'CryoShield vault \u00b7 Oct 2026 (key 2)' });
  });

  it('a name typed at create goes into the one create write; enrollment never sees it', async () => {
    const u = userEvent.setup();
    const enroll = vi.spyOn(ops, 'enrollWithPrf').mockImplementation(async (_s, n) => ({ credId: id(n), publicKey: ('0x' + 'aa'.repeat(64)) as `0x${string}`, prf: new Uint8Array(32).fill(n) }));
    const save = vi.spyOn(ops, 'saveNewVault').mockImplementation(async (_s, _k, items, onSign, _p, name) => {
      onSign();
      return { session: { vaultId: hex(9), owner: ('0x' + '34'.repeat(20)) as `0x${string}`, version: 1, blob: new Uint8Array(400), items, archived: false, ...(name ? { name } : {}), credIds: [id(1), id(2)], registry: 'v2' }, locators: [] };
    });
    renderApp();
    await u.click(screen.getByRole('button', { name: 'Create a new vault' }));
    await u.click(screen.getByRole('button', { name: 'Get started' }));
    await u.click(screen.getByRole('button', { name: 'Set up key 1' }));
    await screen.findByText('Key 1 is ready.');
    await u.click(screen.getByRole('button', { name: 'Set up key 2' }));
    await screen.findByText('Key 2 is ready.');
    await u.click(screen.getByRole('button', { name: 'Continue' }));
    await u.type(screen.getByLabelText(S.create.name), 'Family');
    await u.type(screen.getByLabelText('Name'), 'Seed');
    await u.type(screen.getByLabelText('Secret'), 'abandon art');
    await acknowledge(u);
    await u.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByRole('heading', { name: 'Your vault is saved' });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]![5]).toBe('Family');
    expect(JSON.stringify(enroll.mock.calls.map((c) => c.slice(1)))).not.toContain('Family');
  });

  it('an invalid name at create blocks Save with a plain message', async () => {
    const u = userEvent.setup();
    vi.spyOn(ops, 'enrollWithPrf').mockImplementation(async (_s, n) => ({ credId: id(n), publicKey: ('0x' + 'aa'.repeat(64)) as `0x${string}`, prf: new Uint8Array(32).fill(n) }));
    renderApp();
    await u.click(screen.getByRole('button', { name: 'Create a new vault' }));
    await u.click(screen.getByRole('button', { name: 'Get started' }));
    await u.click(screen.getByRole('button', { name: 'Set up key 1' }));
    await screen.findByText('Key 1 is ready.');
    await u.click(screen.getByRole('button', { name: 'Set up key 2' }));
    await screen.findByText('Key 2 is ready.');
    await u.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.change(screen.getByLabelText(S.create.name), { target: { value: 'x'.repeat(41) } });
    await u.type(screen.getByLabelText('Secret'), 'abandon art');
    await acknowledge(u);
    expect(screen.getByText(S.create.nameInvalid)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });
});

describe('names and labels never leave the page memory (threat model)', () => {
  it('no console output, title, URL or storage carries a name or a label', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((k) => vi.spyOn(console, k));
    unlockReturns([vault(1, { name: 'NAME-MARKER', items: [{ label: 'LABEL-MARKER', secret: 'SECRET-MARKER' }] }), vault(2)]);
    const { u } = await unlockApp();
    await u.click(await screen.findByRole('button', { name: 'Open NAME-MARKER' }));
    await screen.findByRole('heading', { name: 'NAME-MARKER', level: 1 });
    await u.click(screen.getByRole('button', { name: 'All vaults (2)' }));
    await screen.findByRole('heading', { name: 'Your vaults' });
    const out = JSON.stringify(spies.flatMap((s) => s.mock.calls));
    for (const m of ['NAME-MARKER', 'LABEL-MARKER', 'SECRET-MARKER']) {
      expect(out).not.toContain(m);
      expect(document.title).not.toContain(m);
      expect(location.href).not.toContain(m);
      expect(JSON.stringify({ ...localStorage })).not.toContain(m);
      expect(JSON.stringify({ ...sessionStorage })).not.toContain(m);
      expect(document.cookie).not.toContain(m);
    }
  });
});

describe('the vault list chunk fails to load', () => {
  it('shows a plain message instead of crashing', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { default: Menu } = await import('../../src/ui/VaultsMenu');
    expect(Menu).toBeTypeOf('function');
    // The App wraps the lazy menu in a ChunkBoundary; a failing child renders the fallback.
    const { ChunkBoundary } = await import('../../src/ui/components');
    const Boom = () => {
      throw new TypeError('Failed to fetch dynamically imported module');
    };
    render(
      <ChunkBoundary fallback={<p>{S.save.loadFailed}</p>}>
        <Boom />
      </ChunkBoundary>,
    );
    expect(screen.getByText(S.save.loadFailed)).toBeInTheDocument();
  });
});

describe('review M2/M3: the dates lookup', () => {
  const chainRpc = (timestamp: () => unknown = () => '0x6a9b0f00') => {
    const logsFor: string[][] = [];
    const request = vi.fn(async ({ method, params }: { method: string; params: any[] }) => {
      if (method === 'eth_blockNumber') return '0x10';
      if (method === 'eth_getLogs') {
        logsFor.push(params[0].topics[1]);
        return params[0].topics[1].map((vid: string, i: number) => ({
          topics: [historyMod.CREATED, vid],
          data: '0x' + '00'.repeat(31) + '01' + '11'.repeat(32),
          blockNumber: '0x5',
          logIndex: '0x' + i.toString(16),
        }));
      }
      if (method === 'eth_getBlockByNumber') return { timestamp: timestamp() };
      throw new Error(method);
    });
    return { request, logsFor };
  };

  it('sends only public fields, and "Check another key" looks up only the new vault', async () => {
    const spy = vi.spyOn(historyMod, 'vaultDates');
    const rpc = chainRpc();
    unlockReturns([vault(1, { name: 'One' }), vault(2, { name: 'Two' })], [vault(2, { name: 'Two' }), vault(3, { name: 'Three' })]);
    const { u } = await unlockApp({ client: { request: rpc.request } as never });
    await waitFor(() => expect(rpc.logsFor).toHaveLength(1));
    for (const v of spy.mock.calls[0]![1]) expect(Object.keys(v).sort()).toEqual(['blob', 'registry', 'vaultId', 'version']);
    await u.click(screen.getByRole('button', { name: VAULTS.checkAnother }));
    await screen.findByRole('heading', { name: 'Three' });
    await waitFor(() => expect(rpc.logsFor).toHaveLength(2));
    expect(rpc.logsFor[1]).toEqual([hex(3)]);
    await waitFor(() => expect(screen.getAllByText(/^Created /)).toHaveLength(3));
  });

  it('a hostile block timestamp shows "Date unavailable"', async () => {
    const rpc = chainRpc(() => '0x' + 'f'.repeat(30));
    unlockReturns([vault(1), vault(2)]);
    await unlockApp({ client: { request: rpc.request } as never });
    await waitFor(() => expect(screen.getAllByText('Created Date unavailable · Last saved Date unavailable')).toHaveLength(2));
  });

  it('locking aborts a lookup in flight', async () => {
    const spy = vi.spyOn(historyMod, 'vaultDates');
    const request = vi.fn(() => new Promise(() => undefined));
    unlockReturns([vault(1), vault(2)]);
    await unlockApp({ client: { request } as never });
    await waitFor(() => expect(spy).toHaveBeenCalled());
    const signal = spy.mock.calls[0]![2]!.signal!;
    expect(signal.aborted).toBe(false);
    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });
    expect(signal.aborted).toBe(true);
  });
});

describe('review LOW items', () => {
  it('one key reads "1 key"', async () => {
    vi.spyOn(await import('@cryoshield/vault-crypto'), 'decodeVault').mockReturnValue({ entries: [{ credId: id(1) }], keyCount: 1 } as never);
    unlockReturns([vault(1), vault(2)]);
    await unlockApp();
    expect((await screen.findAllByText(/· 1 key$/)).length).toBe(2);
  });

  it('Archive and clear is not offered on a vault that is already archived and empty', async () => {
    unlockReturns([vault(1, { name: 'Done', archived: true, items: [] })]);
    const { u } = await unlockApp();
    await u.click(await screen.findByRole('button', { name: 'Open Done' }));
    await u.click(await screen.findByRole('button', { name: S.vault.editVault }));
    await screen.findByLabelText(VAULTS.sheet.name);
    expect(screen.queryByRole('button', { name: VAULTS.clear.open })).toBeNull();
  });

  it('review M5: at 0 free saves the sheet blocks Save and Archive and clear, but Cancel still works', async () => {
    stack.nonce = 50;
    unlockReturns([vault(1, { name: 'Family' })]);
    const { u } = await unlockApp({ chainId: 11155420, client: nonceClient() });
    await screen.findByRole('heading', { name: 'Family', level: 1 });
    await waitFor(() => expect(stack.nonce).toBe(50));
    await u.click(screen.getByRole('button', { name: S.vault.editVault }));
    await waitFor(() => expect(screen.getByRole('button', { name: VAULTS.sheet.save })).toBeDisabled());
    expect(screen.getByRole('button', { name: VAULTS.clear.open })).toBeDisabled();
    expect(screen.getByText(S.save.paused)).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: VAULTS.sheet.cancel }));
    expect(await screen.findByRole('button', { name: S.vault.editVault })).toBeInTheDocument();
  });
});

describe('review W1: an incomplete vault list is never shown', () => {
  it('unlock says "couldn\'t load all your vaults, try again"', async () => {
    const { RegistryIncompleteError } = await import('../../src/chain/registry');
    vi.spyOn(unlockMod, 'unlock').mockRejectedValue(new RegistryIncompleteError('v2'));
    await unlockApp();
    expect(await screen.findByRole('alert')).toHaveTextContent(S.unlock.incomplete);
  });
});
