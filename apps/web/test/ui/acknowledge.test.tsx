/**
 * add-privacy-and-compliance 4.1-4.3 (spec legal-pages "Permanence acknowledgement before first write", "Age
 * statement", "Testnet warning present"; spec privacy-compliance "No CryoShield-side identifiers").
 */
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as ops from '../../src/ui/operations';
import { renderApp } from './helpers';

const id = (n: number) => new Uint8Array(48).fill(n);
const key = (n: number) => ({ credId: id(n), publicKey: ('0x' + 'aa'.repeat(64)) as `0x${string}`, prf: new Uint8Array(32).fill(n) });
const PERMANENCE = /published permanently on a public blockchain and on Arweave/;

beforeEach(async () => {
  vi.restoreAllMocks();
  vi.spyOn(ops, 'mirrorWrite').mockResolvedValue({ status: 'saved' });
  vi.spyOn(ops, 'enrollWithPrf').mockImplementation(async (_s, n) => key(n));
});

async function toSecrets(u: ReturnType<typeof userEvent.setup>) {
  await u.click(screen.getByRole('button', { name: 'Create a new vault' }));
  await u.click(screen.getByRole('button', { name: 'Get started' }));
  await u.click(screen.getByRole('button', { name: 'Set up key 1' }));
  await screen.findByText('Key 1 is ready.');
  await u.click(screen.getByRole('button', { name: 'Set up key 2' }));
  await screen.findByText('Key 2 is ready.');
  await u.click(screen.getByRole('button', { name: 'Continue' }));
  await u.type(screen.getByLabelText('Secret'), 'abandon art');
}

describe('permanence + 18+ acknowledgement before the first write', () => {
  it('Save stays disabled, and nothing is sent, until both boxes are ticked', async () => {
    const u = userEvent.setup();
    const save = vi.spyOn(ops, 'saveNewVault').mockResolvedValue({ session: { vaultId: '0x01', owner: '0x02', version: 1, blob: new Uint8Array(1), items: [], credIds: [], registry: 'v2' as const } as never, locators: [] });
    renderApp();
    await toSecrets(u);
    const saveBtn = screen.getByRole('button', { name: 'Save' });
    expect(saveBtn).toBeDisabled();
    await u.click(saveBtn);
    await u.keyboard('{Enter}');
    expect(save).not.toHaveBeenCalled();
    await u.click(screen.getByRole('checkbox', { name: PERMANENCE }));
    expect(saveBtn).toBeDisabled();
    await u.click(screen.getByRole('checkbox', { name: 'I am 18 or over.' }));
    expect(saveBtn).toBeEnabled();
    await u.click(saveBtn);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('lists the public fields in plain language and explains why Save is off (under-18 path)', async () => {
    const u = userEvent.setup();
    renderApp();
    await toSecrets(u);
    const label = screen.getByRole('checkbox', { name: PERMANENCE }).closest('label')!.textContent!;
    for (const f of ['encrypted vault', 'account address', 'locator', 'number of keys', 'credential IDs', 'nobody, including CryoShield, can delete']) expect(label).toContain(f);
    await u.click(screen.getByRole('checkbox', { name: PERMANENCE }));
    expect(screen.getByText('CryoShield is only for people aged 18 or over. You can’t save a vault unless you confirm this.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toHaveAccessibleDescription(/18 or over/);
  });

  it('must be given again on every new create (not remembered)', async () => {
    const u = userEvent.setup();
    const first = renderApp();
    await toSecrets(u);
    await u.click(screen.getByRole('checkbox', { name: PERMANENCE }));
    await u.click(screen.getByRole('checkbox', { name: 'I am 18 or over.' }));
    first.unmount();
    renderApp();
    await toSecrets(u);
    expect(screen.getByRole('checkbox', { name: PERMANENCE })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'I am 18 or over.' })).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('the acknowledgement leaves no cookie or browser storage behind', async () => {
    const u = userEvent.setup();
    vi.spyOn(ops, 'saveNewVault').mockResolvedValue({ session: { vaultId: '0x01', owner: '0x02', version: 1, blob: new Uint8Array(1), items: [], credIds: [], registry: 'v2' as const } as never, locators: [] });
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const cookie = vi.spyOn(document, 'cookie', 'set');
    renderApp();
    await toSecrets(u);
    await u.click(screen.getByRole('checkbox', { name: PERMANENCE }));
    await u.click(screen.getByRole('checkbox', { name: 'I am 18 or over.' }));
    await u.click(screen.getByRole('button', { name: 'Save' }));
    expect(setItem).not.toHaveBeenCalled();
    expect(cookie).not.toHaveBeenCalled();
    expect(localStorage.length + sessionStorage.length).toBe(0);
  });
});

describe('testnet warning in the app shell (4.3)', () => {
  it('shows the testnet + unaudited warning on OP Sepolia', () => {
    renderApp({ chainId: 11155420 });
    expect(screen.getByText(/stored on OP Sepolia \(a test network\).*has not been independently audited/)).toBeInTheDocument();
  });

  it('shows no testnet warning on a mainnet chain', () => {
    renderApp({ chainId: 10 });
    expect(screen.queryByText(/a test network/)).toBeNull();
  });
});
