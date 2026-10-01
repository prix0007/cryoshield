import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as ops from '../../src/ui/operations';
import * as unlockMod from '../../src/chain/unlock';
import { copySecret, CLIPBOARD_CLEAR_MS } from '../../src/ui/clipboard';
import { HIDDEN_MS, IDLE_MS, WARN_MS } from '../../src/ui/useAutoLock';
import { renderApp } from './helpers';

const id = (n: number) => new Uint8Array(48).fill(n);
const s = {
  vaultId: ('0x' + '12'.repeat(32)) as `0x${string}`,
  owner: ('0x' + '34'.repeat(20)) as `0x${string}`,
  version: 1,
  blob: new Uint8Array(400),
  items: [{ label: 'Seed', secret: 'abandon art' }],
};

async function unlocked() {
  vi.spyOn(unlockMod, 'unlock').mockResolvedValue({ credId: id(1), locator: new Uint8Array(32), matches: [{ ...s, entryIndex: 0 }] });
  renderApp();
  fireEvent.click(screen.getByRole('button', { name: 'Unlock my vault' }));
  fireEvent.click(screen.getByRole('button', { name: 'Unlock with my key' }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(screen.getByRole('heading', { name: 'Seed' })).toBeInTheDocument();
}

beforeEach(async () => {
  vi.useFakeTimers({ shouldAdvanceTime: false });
  vi.spyOn(ops, 'ensureMirror').mockResolvedValue('saved');
  vi.spyOn(await import('@cryoshield/vault-crypto'), 'decodeVault').mockReturnValue({ entries: [{ credId: id(1) }, { credId: id(2) }] } as never);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('auto-lock (8.4)', () => {
  it('warns 30 s before 5 min idle, can be extended, then locks and removes secrets from the DOM', async () => {
    await unlocked();
    fireEvent.click(screen.getByRole('button', { name: 'Show Seed' }));
    expect(screen.getByText('abandon art')).toBeInTheDocument();
    await act(async () => vi.advanceTimersByTimeAsync(IDLE_MS - WARN_MS));
    expect(screen.getByText('For your safety, your vault will lock in 30 seconds.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'I’m still here' }));
    await act(async () => vi.advanceTimersByTimeAsync(IDLE_MS - 1000));
    expect(screen.getByText('abandon art')).toBeInTheDocument();
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(screen.queryByText('abandon art')).toBeNull();
    expect(screen.getByText('Your vault is locked.')).toBeInTheDocument();
  });

  it('locks on pagehide', async () => {
    await unlocked();
    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });
    expect(screen.queryByRole('heading', { name: 'Seed' })).toBeNull();
  });

  it('locks after being hidden for more than 60 s', async () => {
    await unlocked();
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await act(async () => vi.advanceTimersByTimeAsync(HIDDEN_MS));
    expect(screen.queryByRole('heading', { name: 'Seed' })).toBeNull();
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  });

  it('the Lock button drops the session', async () => {
    await unlocked();
    fireEvent.click(screen.getByRole('button', { name: 'Lock' }));
    expect(screen.queryByRole('heading', { name: 'Seed' })).toBeNull();
  });
});

describe('clipboard (8.5)', () => {
  it('copies, then clears after 30 s when focused', async () => {
    let clip = '';
    const fake = { writeText: vi.fn(async (t: string) => void (clip = t)) };
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    expect(await copySecret('secret', fake)).toBe(true);
    expect(clip).toBe('secret');
    await vi.advanceTimersByTimeAsync(CLIPBOARD_CLEAR_MS);
    expect(clip).toBe('');
  });

  it('does not attempt to clear when the page lost focus', async () => {
    let clip = '';
    const fake = { writeText: vi.fn(async (t: string) => void (clip = t)) };
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    await copySecret('secret', fake);
    await vi.advanceTimersByTimeAsync(CLIPBOARD_CLEAR_MS);
    expect(fake.writeText).toHaveBeenCalledTimes(1);
    expect(clip).toBe('secret');
  });

  it('the Copy button tells the user it will be cleared', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => undefined }, configurable: true });
    await unlocked();
    fireEvent.click(screen.getByRole('button', { name: 'Copy Seed' }));
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(screen.getByText('Copied. It will be cleared from your clipboard in 30 seconds.')).toBeInTheDocument();
  });
});

describe('vault details (8.6)', () => {
  it('shows the vault ID and downloads exactly the blob', async () => {
    await unlocked();
    const created: Blob[] = [];
    const orig = URL.createObjectURL;
    URL.createObjectURL = ((b: Blob) => (created.push(b), 'blob:x')) as typeof URL.createObjectURL;
    URL.revokeObjectURL = () => undefined;
    const clicks: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicks.push(this.download);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Vault details' }));
    expect(screen.getByTestId('vault-id')).toHaveTextContent(s.vaultId);
    fireEvent.click(screen.getByRole('button', { name: 'Download encrypted backup file' }));
    expect(clicks).toEqual([`cryoshield-${s.vaultId.slice(2, 10)}.cryo`]);
    expect(new Uint8Array(await created[0]!.arrayBuffer())).toEqual(s.blob);
    URL.createObjectURL = orig;
  });
});
