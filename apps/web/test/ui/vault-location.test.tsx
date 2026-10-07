import axe from 'axe-core';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as ops from '../../src/ui/operations';
import * as unlockMod from '../../src/chain/unlock';
import { S as S0 } from '../../src/ui/strings';
import { LOCATION } from '../../src/ui/strings-location';

const S = { ...S0, location: { ...S0.location, ...LOCATION } };
import type { Services } from '../../src/ui/services';
import { renderApp } from './helpers';

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
  registries: { v1: REG1, v2: REG2 },
  arweaveGatewayUrl: 'https://arweave.net',
};

async function openVault(over: Partial<Services> = OP_SEPOLIA, registry: 'v1' | 'v2' = 'v2') {
  vi.spyOn(unlockMod, 'unlock').mockResolvedValue({
    credId: credId(1),
    locator: LOCATOR,
    matches: [{ vaultId: VAULT_ID, owner: OWNER, version: 3, blob: new Uint8Array(400), items: [{ label: 'Seed', secret: 'abandon art' }], entryIndex: 0, registry }],
  });
  const r = renderApp(over);
  fireEvent.click(screen.getByRole('button', { name: 'Unlock my vault' }));
  fireEvent.click(screen.getByRole('button', { name: 'Unlock with my key' }));
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
    expect(p.getByText(OWNER)).toBeInTheDocument();
    expect(p.getByText(REG2)).toBeInTheDocument();
    expect(p.getByText(S.location.registryV2)).toBeInTheDocument();
    expect(p.getByText('3')).toBeInTheDocument();
    expect(p.getByText(S.location.publicNote)).toBeInTheDocument();
    // Unknown after a plain unlock: no last-save row, no Arweave row.
    expect(p.queryByText(S.location.lastSave)).toBeNull();
    expect(p.queryByText(S.location.arweave)).toBeNull();
  });

  it('links addresses to the explorer in a new tab with noopener noreferrer', async () => {
    await openVault();
    const p = within(await expand());
    const owner = p.getByRole('link', { name: new RegExp(`^${S.location.owner}: ${OWNER}`) });
    expect(owner).toHaveAttribute('href', `${EXPLORER}/address/${OWNER}`);
    const registry = p.getByRole('link', { name: new RegExp(`^${S.location.registry}: ${REG2}`) });
    expect(registry).toHaveAttribute('href', `${EXPLORER}/address/${REG2}`);
    for (const a of p.getAllByRole('link')) {
      expect(a).toHaveAttribute('target', '_blank');
      expect(a).toHaveAttribute('rel', 'noopener noreferrer');
      expect(a.getAttribute('aria-label')).toContain(S.location.newTab);
    }
  });

  it('copies the full value and announces it', async () => {
    await openVault();
    const p = within(await expand());
    fireEvent.click(p.getByRole('button', { name: `${S.location.copy} ${S.location.vaultId}` }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(VAULT_ID));
    expect(await p.findByText(S.location.copied(S.location.vaultId))).toBeInTheDocument();
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
    const link = await p.findByRole('link', { name: new RegExp(`^${S.location.arweave}: ${AR_ID}`) });
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
    expect(p.getByRole('link', { name: new RegExp(`^${S.location.lastSave}: ${HASH}`) })).toHaveAttribute('href', `${EXPLORER}/tx/${HASH}`);
    expect(p.getByRole('link', { name: new RegExp(`^${S.location.arweave}: ${AR_ID}`) })).toBeInTheDocument();
  });

  it('says a legacy v1 vault is read-only and points at the v1 registry', async () => {
    await openVault(OP_SEPOLIA, 'v1');
    const p = within(await expand());
    expect(p.getByText(REG1)).toBeInTheDocument();
    expect(p.getByText(S.location.registryV1)).toBeInTheDocument();
  });

  it('shows values without links where the network has no explorer', async () => {
    await openVault({ ...OP_SEPOLIA, chainId: 31337, network: { name: 'local test chain', explorerUrl: null } });
    const p = within(await expand());
    expect(p.queryAllByRole('link')).toEqual([]);
    expect(p.getByText(OWNER)).toBeInTheDocument();
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
});
