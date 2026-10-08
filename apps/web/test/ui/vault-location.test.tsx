import axe from 'axe-core';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as ops from '../../src/ui/operations';
import * as unlockMod from '../../src/chain/unlock';
import userEvent from '@testing-library/user-event';
import { S as S0 } from '../../src/ui/strings';
import { LOCATION } from '../../src/ui/strings-location';
import type { Services } from '../../src/ui/services';
import { acknowledge, renderApp } from './helpers';

const S = { ...S0, location: { ...S0.location, ...LOCATION } };
const L_REGISTRY = LOCATION.registry;

const EXPLORER = 'https://testnet-explorer.optimism.io';
const REG1 = ('0x' + 'a1'.repeat(20)) as `0x${string}`;
const REG2 = ('0x' + 'a2'.repeat(20)) as `0x${string}`;
const VAULT_ID = ('0x' + '12'.repeat(32)) as `0x${string}`;
const OWNER = ('0x' + '34'.repeat(20)) as `0x${string}`;
const HASH = ('0x' + 'cd'.repeat(32)) as `0x${string}`;
const AR_ID = 'Ar' + 'w'.repeat(40) + '_';
const LOCATOR = new Uint8Array(32).fill(0x9a);
const LOCATOR_HEX = '9a'.repeat(32);
const credId = (n: number) => new Uint8Array(48).fill(n);

const OP_SEPOLIA: Partial<Services> = {
  chainId: 11155420,
  network: { name: 'OP Sepolia testnet', explorerUrl: EXPLORER },
  registries: [
    { version: 'v2', address: REG2 },
    { version: 'v1', address: REG1 },
  ],
  arweaveGatewayUrl: 'https://arweave.net',
};

async function openVault(over: Partial<Services> = OP_SEPOLIA, registry: 'v1' | 'v2' = 'v2') {
  vi.spyOn(unlockMod, 'unlock').mockResolvedValue({
    credId: credId(1),
    locator: LOCATOR,
    matches: [{ vaultId: VAULT_ID, owner: OWNER, version: 3, blob: new Uint8Array(400), items: [{ label: 'Seed', secret: 'abandon art' }], entryIndex: 0, archived: false, registry }],
  });
  const r = renderApp(over);
  fireEvent.click(screen.getByRole('button', { name: 'Unlock my vault' }));
  fireEvent.click(screen.getByRole('button', { name: 'Unlock with my key' }));
  // vault-list-labels-archive D5: an older test vault on its own is listed, not opened automatically.
  if (registry === 'v1') fireEvent.click(await screen.findByRole('button', { name: 'Open Unnamed vault' }));
  await screen.findByRole('heading', { name: 'Seed' });
  return r;
}

async function expand() {
  const toggle = await screen.findByRole('button', { name: S.location.title });
  fireEvent.click(toggle);
  await screen.findByText(S.location.publicNote);
  return document.getElementById(toggle.getAttribute('aria-controls')!)!;
}

let writeText: ReturnType<typeof vi.fn>;
beforeEach(async () => {
  vi.spyOn(ops, 'ensureMirror').mockResolvedValue({ status: 'saved' });
  vi.spyOn(await import('@cryoshield/vault-crypto'), 'decodeVault').mockReturnValue({ entries: [{ credId: credId(1) }, { credId: credId(2) }] } as never);
  writeText = vi.fn(async () => undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
});
afterEach(() => vi.restoreAllMocks());

describe('Where your vault is stored (show-vault-onchain-location 1.3)', () => {
  it('is collapsed by default and shows only public facts when opened', async () => {
    await openVault();
    const toggle = screen.getByRole('button', { name: S.location.title });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText(VAULT_ID)).toBeNull();

    const panel = await expand();
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const p = within(panel);
    expect(p.getByText('OP Sepolia testnet (chain ID 11155420)')).toBeInTheDocument();
    expect(p.getByText(VAULT_ID)).toBeInTheDocument(); // full value for assistive technology
    expect(p.getByText(OWNER, { exact: false })).toBeInTheDocument();
    expect(p.getByText(REG2, { exact: false })).toBeInTheDocument();
    expect(p.getByText(S.location.registryVersion('v2', false))).toBeInTheDocument();
    expect(S.location.registryVersion('v2', false)).toBe('Version 2');
    expect(p.getByText('3')).toBeInTheDocument();
    expect(p.getByText(S.location.publicNote)).toBeInTheDocument();
    // Unknown after a plain unlock: no last-save row, no Arweave row.
    expect(p.queryByText(S.location.lastSave)).toBeNull();
    expect(p.queryByText(S.location.arweave)).toBeNull();
  });

  it('links addresses to the explorer in a new tab with noopener noreferrer', async () => {
    await openVault();
    const p = within(await expand());
    const owner = p.getByRole('link', { name: new RegExp(`^${S.location.owner}: .*${OWNER}`) });
    expect(owner).toHaveAttribute('href', `${EXPLORER}/address/${OWNER}`);
    const registry = p.getByRole('link', { name: new RegExp(`^${S.location.registry}: .*${REG2}`) });
    expect(registry).toHaveAttribute('href', `${EXPLORER}/address/${REG2}`);
    for (const a of p.getAllByRole('link')) {
      expect(a).toHaveAttribute('target', '_blank');
      expect(a).toHaveAttribute('rel', 'noopener noreferrer');
      expect(a).not.toHaveAttribute('aria-label');
      // WCAG 2.5.3: the visible (truncated) text is part of the accessible name, with the full value and the new tab.
      const visible = a.querySelector('.loc-short')!.textContent!;
      expect(a).toHaveAccessibleName(expect.stringContaining(visible));
      expect(a).toHaveAccessibleName(expect.stringContaining(S.location.newTab));
    }
  });

  it('copies the full value and announces it', async () => {
    await openVault();
    const p = within(await expand());
    fireEvent.click(p.getByRole('button', { name: `${S.location.copy} ${S.location.vaultId}` }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(VAULT_ID));
    expect(await p.findByText(S.location.copied(S.location.vaultId))).toBeInTheDocument();
    const status = p.getByRole('status');
    const first = status.textContent;
    fireEvent.click(p.getByRole('button', { name: `${S.location.copy} ${S.location.vaultId}` }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(status.textContent).not.toBe(first)); // the same copy again is announced again
    expect(status.textContent!.trim()).toBe(S.location.copied(S.location.vaultId));
    fireEvent.click(p.getByRole('button', { name: `${S.location.copy} ${S.location.owner}` }));
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(OWNER));
  });

  it('never shows the key locator or credential IDs', async () => {
    const { container } = await openVault();
    const panel = await expand();
    const html = container.innerHTML.toLowerCase();
    expect(html).not.toContain(LOCATOR_HEX);
    expect(html).not.toContain('01'.repeat(48));
    // Every copy button copies one of the public values only.
    for (const b of within(panel).getAllByRole('button', { name: /^Copy / })) fireEvent.click(b);
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(5));
    for (const [v] of writeText.mock.calls) expect([`${11155420}`, REG2, VAULT_ID, OWNER, '3']).toContain(v);
  });

  it('shows the Arweave copy, linked on the configured gateway, once it is known', async () => {
    vi.mocked(ops.ensureMirror).mockResolvedValue({ status: 'saved', itemId: AR_ID });
    await openVault();
    const p = within(await expand());
    const link = await p.findByRole('link', { name: new RegExp(`^${S.location.arweave}: .*${AR_ID}`) });
    expect(link).toHaveAttribute('href', `https://arweave.net/${AR_ID}`);
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('shows the last save after a save in this session', async () => {
    vi.spyOn(ops, 'saveEdit').mockImplementation(async (_svc, s, items) => ({ ...s, items, version: 4, lastSave: { version: 4, txHash: HASH } }));
    vi.spyOn(ops, 'mirrorWrite').mockResolvedValue({ status: 'saved', itemId: AR_ID });
    await openVault();
    fireEvent.click(screen.getByRole('button', { name: S.vault.edit }));
    fireEvent.click(await screen.findByRole('button', { name: S.editor.save }));
    await screen.findByText(S.save.saved);
    const p = within(await expand());
    expect(p.getByText('4')).toBeInTheDocument();
    expect(p.getByRole('link', { name: new RegExp(`^${S.location.lastSave}: .*${HASH}`) })).toHaveAttribute('href', `${EXPLORER}/tx/${HASH}`);
    expect(p.getByRole('link', { name: new RegExp(`^${S.location.arweave}: .*${AR_ID}`) })).toBeInTheDocument();
  });

  it('says a legacy v1 vault is read-only and points at the v1 registry', async () => {
    await openVault(OP_SEPOLIA, 'v1');
    const p = within(await expand());
    expect(p.getByText(REG1, { exact: false })).toBeInTheDocument();
    expect(p.getByText(S.location.registryVersion('v1', true))).toBeInTheDocument();
    expect(S.location.registryVersion('v1', true)).toBe('Version 1 (read-only)');
  });

  it('web-registry-versions D5: any registry is named by its version, and read-only unless it is the newest', async () => {
    const { default: VaultLocation } = await import('../../src/ui/VaultLocation');
    const { render } = await import('@testing-library/react');
    const REG3 = ('0x' + 'a3'.repeat(20)) as `0x${string}`;
    const base = { network: OP_SEPOLIA.network!, chainId: 11155420, vaultId: VAULT_ID, owner: OWNER, version: 1, arweaveGatewayUrl: 'https://arweave.net' };
    const registries = [{ version: 'v3', address: REG3 }, { version: 'v2', address: REG2 }, { version: 'v1', address: REG1 }];
    const v3 = render(<VaultLocation {...base} registries={registries} registry="v3" />);
    expect(within(v3.container).getByText('Version 3')).toBeInTheDocument();
    expect(within(v3.container).getByRole('link', { name: new RegExp(REG3) })).toHaveAttribute('href', `${EXPLORER}/address/${REG3}`);
    v3.unmount();
    const v2 = render(<VaultLocation {...base} registries={registries} registry="v2" />);
    expect(within(v2.container).getByText('Version 2 (read-only)')).toBeInTheDocument();
    expect(within(v2.container).getByText(REG2, { exact: false })).toBeInTheDocument();
    v2.unmount();
    const unknown = render(<VaultLocation {...base} registries={registries} registry="v9" />);
    expect(within(unknown.container).queryByText(L_REGISTRY)).toBeNull(); // no registry row rather than a wrong one
  });

  it('shows values without links where the network has no explorer', async () => {
    await openVault({ ...OP_SEPOLIA, chainId: 31337, network: { name: 'local test chain', explorerUrl: null } });
    const p = within(await expand());
    expect(p.queryAllByRole('link')).toEqual([]);
    expect(p.getByText(OWNER, { exact: false })).toBeInTheDocument();
    expect(p.getByRole('button', { name: `${S.location.copy} ${S.location.owner}` })).toBeInTheDocument();
  });

  it('is wiped with the rest of the vault on lock', async () => {
    await openVault();
    await expand();
    fireEvent.click(screen.getByRole('button', { name: S.vault.lock }));
    expect(screen.queryByText(VAULT_ID)).toBeNull();
    expect(screen.queryByText(OWNER)).toBeNull();
    expect(screen.queryByText(S.location.publicNote)).toBeNull();
    expect(document.body.innerHTML).not.toContain(VAULT_ID.slice(2));
  });

  it('has no axe violations when open', async () => {
    vi.mocked(ops.ensureMirror).mockResolvedValue({ status: 'saved', itemId: AR_ID });
    const { container } = await openVault();
    await expand();
    const r = await axe.run(container, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'], rules: { 'color-contrast': { enabled: false } } });
    expect(r.violations.map((v) => v.id)).toEqual([]);
  });

  it('version gate: an add-key save without a transaction hash hides the previous last save', async () => {
    vi.spyOn(ops, 'saveEdit').mockImplementation(async (_svc, s, items) => ({ ...s, items, version: 4, lastSave: { version: 4, txHash: HASH } }));
    vi.spyOn(ops, 'saveAddKey').mockImplementation(async (_svc, s) => ({ session: { ...s, version: 5, credIds: [...s.credIds, credId(3)] }, newLocator: ('0x' + '77'.repeat(32)) as `0x${string}` }));
    vi.spyOn(ops, 'mirrorWrite').mockResolvedValue({ status: 'failed', ref: 'UPLOAD_FAILED · upload' });
    await openVault();
    fireEvent.click(screen.getByRole('button', { name: S.vault.edit }));
    fireEvent.click(await screen.findByRole('button', { name: S.editor.save }));
    await screen.findByText(S.save.saved);
    fireEvent.click(await screen.findByRole('button', { name: S.vault.addKey }));
    await screen.findByRole('heading', { level: 2, name: S.addKey.title });
    await waitFor(() => expect(screen.getAllByRole('button', { name: S.addKey.start })).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: S.addKey.start }));
    await screen.findByText(S.addKey.done);
    const p = within(await expand());
    expect(p.getByText('5')).toBeInTheDocument();
    expect(p.queryByText(S.location.lastSave)).toBeNull();
    expect(document.body.innerHTML).not.toContain(HASH.slice(2));
  });

  it('version gate: the Arweave copy of an older version is hidden', async () => {
    vi.mocked(ops.ensureMirror).mockResolvedValue({ status: 'saved', itemId: AR_ID });
    vi.spyOn(ops, 'saveEdit').mockImplementation(async (_svc, s, items) => ({ ...s, items, version: 4 }));
    vi.spyOn(ops, 'mirrorWrite').mockResolvedValue({ status: 'failed', ref: 'UPLOAD_FAILED · upload' });
    await openVault();
    await waitFor(() => expect(ops.ensureMirror).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: S.vault.edit }));
    fireEvent.click(await screen.findByRole('button', { name: S.editor.save }));
    await screen.findByText(S.save.saved);
    const p = within(await expand());
    expect(p.getByText('4')).toBeInTheDocument();
    expect(p.queryByText(S.location.arweave)).toBeNull();
  });

  it('a late mirror result for an older version never replaces the current one', async () => {
    let healLate!: (r: ops.MirrorResult) => void;
    vi.mocked(ops.ensureMirror).mockReturnValue(new Promise((r) => (healLate = r)));
    vi.spyOn(ops, 'saveEdit').mockImplementation(async (_svc, s, items) => ({ ...s, items, version: 4 }));
    vi.spyOn(ops, 'mirrorWrite').mockResolvedValue({ status: 'saved', itemId: AR_ID });
    await openVault();
    fireEvent.click(screen.getByRole('button', { name: S.vault.edit }));
    fireEvent.click(await screen.findByRole('button', { name: S.editor.save }));
    await screen.findByText(S.mirror.saved);
    healLate({ status: 'saved', itemId: 'Old' + 'o'.repeat(40) }); // v3's self-heal resolves after v4's upload
    const p = within(await expand());
    expect(await p.findByRole('link', { name: new RegExp(`^${S.location.arweave}: .*${AR_ID}`) })).toBeInTheDocument();
  });

  it('keeps the Arweave copy across opening the older test vault from "All vaults" and back', async () => {
    vi.mocked(ops.ensureMirror).mockResolvedValueOnce({ status: 'saved', itemId: AR_ID }).mockResolvedValue({ status: 'saved' });
    vi.spyOn(unlockMod, 'unlock').mockResolvedValue({
      credId: credId(1),
      locator: LOCATOR,
      matches: [
        { vaultId: VAULT_ID, owner: OWNER, version: 3, blob: new Uint8Array(400), items: [{ label: 'Seed', secret: 'abandon art' }], entryIndex: 0, archived: false, registry: 'v2' },
        { vaultId: ('0x' + '56'.repeat(32)) as `0x${string}`, owner: OWNER, version: 1, blob: new Uint8Array(400), items: [{ label: 'Old', secret: 'x' }], entryIndex: 0, archived: false, registry: 'v1' },
      ],
    });
    renderApp(OP_SEPOLIA);
    fireEvent.click(screen.getByRole('button', { name: 'Unlock my vault' }));
    fireEvent.click(screen.getByRole('button', { name: 'Unlock with my key' }));
    await screen.findByRole('heading', { name: 'Seed' });
    await waitFor(() => expect(ops.ensureMirror).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: S.vault.allVaults(2) }));
    const older = await screen.findByRole('region', { name: 'Read-only vaults (older format)' });
    fireEvent.click(within(older).getByRole('button', { name: 'Open Unnamed vault' }));
    await screen.findByRole('heading', { name: 'Old' });
    fireEvent.click(screen.getByRole('button', { name: S.vault.allVaults(2) }));
    const active = await screen.findByRole('region', { name: 'Active vaults' });
    fireEvent.click(within(active).getByRole('button', { name: 'Open Unnamed vault' }));
    await screen.findByRole('heading', { name: 'Seed' });
    const p = within(await expand());
    expect(p.getByRole('link', { name: new RegExp(`^${S.location.arweave}: .*${AR_ID}`) })).toBeInTheDocument();
  });

  it('never stores a malformed Arweave id', async () => {
    vi.mocked(ops.ensureMirror).mockResolvedValue({ status: 'saved', itemId: 'short-id' });
    await openVault();
    await waitFor(() => expect(ops.ensureMirror).toHaveBeenCalled());
    const p = within(await expand());
    expect(p.queryByText(S.location.arweave)).toBeNull();
    expect(document.body.innerHTML).not.toContain('short-id');
  });

  it('records the Arweave copy of a new vault even when it finishes after Continue', async () => {
    const u = userEvent.setup();
    let uploadDone!: (r: ops.MirrorResult) => void;
    vi.spyOn(ops, 'enrollWithPrf').mockImplementation(async (_s, n) => ({ credId: credId(n), publicKey: ('0x' + 'aa'.repeat(64)) as `0x${string}`, prf: new Uint8Array(32).fill(n) }));
    vi.spyOn(ops, 'saveNewVault').mockResolvedValue({
      session: { vaultId: VAULT_ID, owner: OWNER, version: 1, blob: new Uint8Array(10), items: [{ label: 'Seed', secret: 'abandon art' }], credIds: [], archived: false, registry: 'v2' as const, lastSave: { version: 1, txHash: HASH } },
      locators: [('0x' + '77'.repeat(32)) as `0x${string}`],
    });
    vi.spyOn(ops, 'mirrorWrite').mockReturnValue(new Promise((r) => (uploadDone = r)));
    renderApp(OP_SEPOLIA);
    await u.click(screen.getByRole('button', { name: 'Create a new vault' }));
    await u.click(screen.getByRole('button', { name: 'Get started' }));
    await u.click(screen.getByRole('button', { name: 'Set up key 1' }));
    await screen.findByText('Key 1 is ready.');
    await u.click(screen.getByRole('button', { name: 'Set up key 2' }));
    await screen.findByText('Key 2 is ready.');
    await u.click(screen.getByRole('button', { name: 'Continue' }));
    await u.type(screen.getByLabelText('Secret'), 'x');
    await acknowledge(u);
    await u.click(screen.getByRole('button', { name: 'Save' }));
    await u.click(await screen.findByRole('button', { name: 'Continue' })); // mirror still pending
    await screen.findByRole('heading', { name: 'Seed' });
    uploadDone({ status: 'saved', itemId: AR_ID });
    const p = within(await expand());
    expect(await p.findByRole('link', { name: new RegExp(`^${S.location.arweave}: .*${AR_ID}`) })).toBeInTheDocument();
    expect(p.getByRole('link', { name: new RegExp(`^${S.location.lastSave}: .*${HASH}`) })).toBeInTheDocument();
  });
});
