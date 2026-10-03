/** app-motion-ux 3.x: motion is driven by real state only, and never holds back a security behaviour. */
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as ops from '../../src/ui/operations';
import * as unlockMod from '../../src/chain/unlock';
import { CLIPBOARD_CLEAR_MS } from '../../src/ui/clipboard';
import type { SaveStage } from '../../src/account/writes';
import { acknowledge, renderApp } from './helpers';

const id = (n: number) => new Uint8Array(48).fill(n);
const key = (n: number) => ({ credId: id(n), publicKey: ('0x' + 'aa'.repeat(64)) as `0x${string}`, prf: new Uint8Array(32).fill(n) });
const session = {
  vaultId: ('0x' + '12'.repeat(32)) as `0x${string}`,
  owner: ('0x' + '34'.repeat(20)) as `0x${string}`,
  version: 1,
  blob: new Uint8Array(400).fill(1),
  items: [{ label: 'Seed', secret: 'abandon art' }],
  credIds: [id(1), id(2)],
};
type OnProgress = (s: SaveStage) => void;

beforeEach(async () => {
  vi.spyOn(await import('@cryoshield/vault-crypto'), 'decodeVault').mockReturnValue({ entries: [{ credId: id(1) }, { credId: id(2) }] } as never);
  vi.spyOn(ops, 'mirrorWrite').mockResolvedValue({ status: 'saved' });
  vi.spyOn(ops, 'ensureMirror').mockResolvedValue({ status: 'saved' });
  vi.spyOn(ops, 'enrollWithPrf').mockImplementation(async (_s, n) => key(n));
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function toSave(u: ReturnType<typeof userEvent.setup>) {
  renderApp();
  await u.click(screen.getByRole('button', { name: 'Create a new vault' }));
  await u.click(await screen.findByRole('button', { name: 'Get started' }));
  await u.click(await screen.findByRole('button', { name: 'Set up key 1' }));
  await u.click(await screen.findByRole('button', { name: 'Set up key 2' }));
  await u.click(await screen.findByRole('button', { name: 'Continue' }));
  await u.type(await screen.findByLabelText('Secret'), 'abandon art');
  await acknowledge(u);
  await u.click(screen.getByRole('button', { name: 'Save' }));
}
const doneStages = () =>
  within(screen.getByRole('list', { name: 'Save progress' }))
    .getAllByRole('listitem')
    .filter((li) => li.textContent!.endsWith(': done'))
    .map((li) => li.textContent!.replace(': done', ''));

describe('save checklist reflects real write events only (D5)', () => {
  it('stalled at signing: exactly "encrypted" and "sponsored" are checked', async () => {
    const u = userEvent.setup();
    vi.spyOn(ops, 'saveNewVault').mockImplementation((_s, _k, _i, onSign, _r, onProgress?: OnProgress) => {
      onProgress?.('encrypted');
      onSign();
      onProgress?.('sponsored');
      return new Promise(() => undefined);
    });
    await toSave(u);
    expect(await screen.findByRole('heading', { name: 'Saving your vault' })).toBeInTheDocument();
    await waitFor(() => expect(doneStages()).toEqual(['Encrypted on this device', 'Network fee sponsored']));
  });

  it('with no events, nothing is checked (no timers advance it)', async () => {
    const u = userEvent.setup();
    vi.spyOn(ops, 'saveNewVault').mockImplementation(() => new Promise(() => undefined));
    await toSave(u);
    await screen.findByRole('heading', { name: 'Saving your vault' });
    await new Promise((r) => setTimeout(r, 300));
    expect(doneStages()).toEqual([]);
  });

  it('a VaultIdTaken retry unchecks everything', async () => {
    const u = userEvent.setup();
    vi.spyOn(ops, 'saveNewVault').mockImplementation((_s, _k, _i, _sign, onRetry, onProgress?: OnProgress) => {
      onProgress?.('encrypted');
      onRetry?.();
      return new Promise(() => undefined);
    });
    await toSave(u);
    await screen.findByRole('heading', { name: 'Saving your vault' });
    await waitFor(() => expect(screen.getByText(/touch key 1 once more/)).toBeInTheDocument());
    expect(doneStages()).toEqual([]);
  });

  it('done: all four write stages plus the Arweave copy once the mirror reports it', async () => {
    const u = userEvent.setup();
    vi.spyOn(ops, 'saveNewVault').mockImplementation(async (_s, _k, items, _sign, _r, onProgress?: OnProgress) => {
      for (const st of ['encrypted', 'sponsored', 'sent', 'confirmed'] as const) onProgress?.(st);
      return { session: { ...session, items }, locators: [] };
    });
    await toSave(u);
    await screen.findByRole('heading', { name: 'Your vault is saved' });
    await waitFor(() =>
      expect(doneStages()).toEqual(['Encrypted on this device', 'Network fee sponsored', 'Signed and sent', 'Confirmed on-chain', 'Backup copy saved to Arweave']),
    );
  });
});

describe('key slots', () => {
  it('a slot fills (with a decorative ✓) only after the key is really set up', async () => {
    const u = userEvent.setup();
    let release!: () => void;
    vi.spyOn(ops, 'enrollWithPrf').mockImplementation((_s, n) => new Promise((r) => (release = () => r(key(n)))));
    renderApp();
    await u.click(screen.getByRole('button', { name: 'Create a new vault' }));
    await u.click(await screen.findByRole('button', { name: 'Get started' }));
    await u.click(await screen.findByRole('button', { name: 'Set up key 1' }));
    expect(screen.queryByText('Key 1 is ready.')).toBeNull();
    await act(async () => release());
    const slot = (await screen.findByText('Key 1 is ready.')).closest('li')!;
    expect(slot.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  });
});

describe('security behaviour is never held back by an exit animation', () => {
  async function unlocked() {
    vi.spyOn(unlockMod, 'unlock').mockResolvedValue({ credId: id(1), locator: new Uint8Array(32), matches: [{ ...session, entryIndex: 0 }] } as never);
    renderApp();
    fireEvent.click(screen.getByRole('button', { name: 'Unlock my vault' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Unlock with my key' }));
    await screen.findByRole('heading', { name: 'Seed' });
  }

  it('Lock removes revealed secrets from the DOM in the same commit (no exit animation)', async () => {
    await unlocked();
    fireEvent.click(screen.getByRole('button', { name: 'Show Seed' }));
    expect(screen.getByText('abandon art')).toBeInTheDocument();
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
    fireEvent.click(screen.getByRole('button', { name: 'Lock' }));
    expect(screen.queryByText('abandon art')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Seed' })).toBeNull();
  });

  it('copy: a pop chip and countdown bar keyed by a counter; the clipboard is cleared by its own timer, then the chip goes', async () => {
    let clip = '';
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn(async (t: string) => void (clip = t)) }, configurable: true });
    await unlocked();
    vi.useFakeTimers({ shouldAdvanceTime: false });
    fireEvent.click(screen.getByRole('button', { name: 'Copy Seed' }));
    await act(async () => vi.advanceTimersByTimeAsync(0));
    const fb = document.querySelector('.copy-feedback')!;
    expect(fb).not.toBeNull();
    expect(fb.textContent).toContain('Copied');
    expect(fb.textContent).toContain('Clipboard clears in 30 s');
    expect(fb.textContent).not.toContain('abandon art');
    expect(clip).toBe('abandon art');
    await act(async () => vi.advanceTimersByTimeAsync(CLIPBOARD_CLEAR_MS));
    expect(clip).toBe('');
    expect(document.querySelector('.copy-feedback')).toBeNull();
  });
});
