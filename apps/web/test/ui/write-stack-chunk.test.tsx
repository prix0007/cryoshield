/**
 * harden-gas-sponsorship 5.5: the write stack is a lazy chunk. If it fails to load (offline, a redeploy replaced the
 * chunk), saving says so in plain words, nothing crashes, the draft is kept, and Save can be tried again. Edit and
 * add-key load the chunk BEFORE asking for a key tap, so a failed load never wastes a tap.
 */
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as ops from '../../src/ui/operations';
import * as unlockMod from '../../src/chain/unlock';
import { S } from '../../src/ui/strings';
import { acknowledge, renderApp } from './helpers';

vi.mock('../../src/account/stack', () => {
  throw new TypeError('Failed to fetch dynamically imported module');
});

const id = (n: number) => new Uint8Array(48).fill(n);
const key = (n: number) => ({ credId: id(n), publicKey: ('0x' + 'aa'.repeat(64)) as `0x${string}`, prf: new Uint8Array(32).fill(n) });
const credentials = () => ({ create: vi.fn(async () => null), get: vi.fn(async () => null) });

beforeEach(async () => {
  vi.spyOn(ops, 'mirrorWrite').mockResolvedValue({ status: 'saved' });
  vi.spyOn(ops, 'ensureMirror').mockResolvedValue({ status: 'saved' });
  vi.spyOn(await import('@cryoshield/vault-crypto'), 'decodeVault').mockReturnValue({ entries: [{ credId: id(1) }, { credId: id(2) }], keyCount: 2 } as never);
});
afterEach(() => vi.restoreAllMocks());

describe('the save code fails to load', () => {
  it('create: a plain retryable error, the secrets are kept, and pressing Save again retries the load without crashing (success on retry: write-stack-retry.test.tsx)', async () => {
    const u = userEvent.setup();
    const sponsor = { send: vi.fn() };
    vi.spyOn(ops, 'enrollWithPrf').mockImplementation(async (_s, n) => key(n));
    renderApp({ sponsor });
    await u.click(screen.getByRole('button', { name: 'Create a new vault' }));
    await u.click(screen.getByRole('button', { name: 'Get started' }));
    await u.click(screen.getByRole('button', { name: 'Set up key 1' }));
    await screen.findByText('Key 1 is ready.');
    await u.click(screen.getByRole('button', { name: 'Set up key 2' }));
    await screen.findByText('Key 2 is ready.');
    await u.click(screen.getByRole('button', { name: 'Continue' }));
    await u.type(screen.getByLabelText('Name'), 'Bitcoin seed');
    await u.type(screen.getByLabelText('Secret'), 'abandon art');
    await acknowledge(u);
    await u.click(screen.getByRole('button', { name: 'Save' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Nothing was saved'); // the notice title (ceremony.ts)
    expect(alert).toHaveTextContent(S.save.loadFailed);
    expect(screen.getByLabelText('Secret')).toHaveValue('abandon art');
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    expect(sponsor.send).not.toHaveBeenCalled();

    // Trying again goes through the loader again (still failing here) and still does not crash.
    await u.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(S.save.loadFailed);
    expect(screen.getByRole('heading', { name: 'Add your secrets' })).toBeInTheDocument();
  });

  async function openVault(u: ReturnType<typeof userEvent.setup>, creds: ReturnType<typeof credentials>) {
    vi.spyOn(unlockMod, 'unlock').mockResolvedValue({
      credId: id(1),
      locator: new Uint8Array(32),
      matches: [
        {
          vaultId: ('0x' + '12'.repeat(32)) as `0x${string}`,
          owner: ('0x' + '34'.repeat(20)) as `0x${string}`,
          version: 1,
          blob: new Uint8Array(400).fill(1),
          items: [{ label: 'Bitcoin seed', secret: 'abandon art' }],
          entryIndex: 0,
          registry: 'v2',
        },
      ],
    });
    renderApp({ credentials: creds });
    await u.click(screen.getByRole('button', { name: 'Unlock my vault' }));
    await u.click(screen.getByRole('button', { name: 'Unlock with my key' }));
    await screen.findByRole('button', { name: 'Edit secrets' });
  }

  it('edit: the error shows before any key tap, and the draft is kept', async () => {
    const u = userEvent.setup();
    const creds = credentials();
    await openVault(u, creds);
    await u.click(screen.getByRole('button', { name: 'Edit secrets' }));
    await u.clear(screen.getByLabelText('Secret'));
    await u.type(screen.getByLabelText('Secret'), 'new value');
    await u.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(S.save.loadFailed);
    expect(screen.getByLabelText('Secret')).toHaveValue('new value');
    expect(creds.get).not.toHaveBeenCalled();
  });

  it('add a key: the error shows before any key tap', async () => {
    const u = userEvent.setup();
    const creds = credentials();
    await openVault(u, creds);
    await u.click(screen.getByRole('button', { name: S.vault.addKey }));
    await screen.findByRole('heading', { name: S.addKey.title });
    const starts = screen.getAllByRole('button', { name: S.addKey.start });
    await u.click(starts[starts.length - 1]!);
    expect(await screen.findByRole('alert')).toHaveTextContent(S.save.loadFailed);
    expect(creds.get).not.toHaveBeenCalled();
    expect(creds.create).not.toHaveBeenCalled();
  });
});
