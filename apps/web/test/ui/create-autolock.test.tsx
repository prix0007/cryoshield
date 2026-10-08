/**
 * WEB-M2 (security review vault-list-labels-archive N1): the create flow's "saved" screen holds the new decrypted
 * vault, so it is under the same auto-lock as an unlocked vault (5 min idle, pagehide, 60 s hidden), and locking from
 * there wipes it: the app returns home, locked, and Continue can no longer open it.
 */
import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as ops from '../../src/ui/operations';
import { HIDDEN_MS, IDLE_MS } from '../../src/ui/useAutoLock';
import { acknowledge, renderApp } from './helpers';

const id = (n: number) => new Uint8Array(48).fill(n);
const key = (n: number) => ({ credId: id(n), publicKey: ('0x' + 'aa'.repeat(64)) as `0x${string}`, prf: new Uint8Array(32).fill(n) });
const session = {
  vaultId: ('0x' + '12'.repeat(32)) as `0x${string}`,
  owner: ('0x' + '34'.repeat(20)) as `0x${string}`,
  version: 1,
  blob: new Uint8Array(400),
  items: [{ label: 'Seed', secret: 'abandon art' }],
  credIds: [id(1), id(2)],
  archived: false,
  registry: 'v2' as const,
};

beforeEach(async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.spyOn(ops, 'mirrorWrite').mockResolvedValue({ status: 'saved' });
  vi.spyOn(ops, 'ensureMirror').mockResolvedValue({ status: 'saved' });
  vi.spyOn(ops, 'enrollWithPrf').mockImplementation(async (_s, n) => key(n));
  vi.spyOn(ops, 'saveNewVault').mockResolvedValue({ session: { ...session, items: [...session.items] }, locators: [] });
  vi.spyOn(await import('@cryoshield/vault-crypto'), 'decodeVault').mockReturnValue({ entries: [{ credId: id(1) }, { credId: id(2) }] } as never);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function toSaved() {
  const u = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  renderApp();
  await u.click(screen.getByRole('button', { name: 'Create a new vault' }));
  await u.click(screen.getByRole('button', { name: 'Get started' }));
  await u.click(screen.getByRole('button', { name: 'Set up key 1' }));
  await screen.findByText('Key 1 is ready.');
  await u.click(screen.getByRole('button', { name: 'Set up key 2' }));
  await screen.findByText('Key 2 is ready.');
  await u.click(screen.getByRole('button', { name: 'Continue' }));
  await u.type(screen.getByLabelText('Secret'), 'abandon art');
  await acknowledge(u);
  await u.click(screen.getByRole('button', { name: 'Save' }));
  await screen.findByRole('button', { name: 'Continue' });
  return u;
}

const expectLockedHome = () => {
  expect(screen.getByText('Your vault is locked.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull();
  expect(screen.queryByText('abandon art')).toBeNull();
  expect(screen.queryByDisplayValue('abandon art')).toBeNull();
};

describe('WEB-M2: the create "saved" screen is under auto-lock', () => {
  it('Continue still opens the new vault', async () => {
    const u = await toSaved();
    await u.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('heading', { name: 'Seed' })).toBeInTheDocument();
  });

  it('locks on pagehide', async () => {
    await toSaved();
    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });
    expectLockedHome();
  });

  it('locks after 5 minutes idle (with the 30 s warning first)', async () => {
    await toSaved();
    await act(async () => vi.advanceTimersByTimeAsync(IDLE_MS - 30_000));
    expect(screen.getByText('For your safety, your vault will lock in 30 seconds.')).toBeInTheDocument();
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expectLockedHome();
  });

  it('locks after being hidden for more than 60 s', async () => {
    await toSaved();
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await act(async () => vi.advanceTimersByTimeAsync(HIDDEN_MS));
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    expectLockedHome();
  });
});
