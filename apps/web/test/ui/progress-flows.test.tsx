/** progress-feedback 2.1: the shared progress view wired into the save, create and unlock flows. */
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as unlockMod from '../../src/chain/unlock';
import { WriteError, type SaveStage } from '../../src/account/errors';
import * as ops from '../../src/ui/operations';
import { ServicesProvider } from '../../src/ui/services';
import { S } from '../../src/ui/strings';
import { VaultView } from '../../src/ui/VaultView';
import { acknowledge, fakeServices, renderApp } from './helpers';

type OnProgress = (s: SaveStage) => void;
const credIds = [new Uint8Array(48).fill(1), new Uint8Array(48).fill(2)];
const session: ops.VaultSession = {
  vaultId: ('0x' + '12'.repeat(32)) as `0x${string}`,
  owner: ('0x' + '34'.repeat(20)) as `0x${string}`,
  version: 1,
  blob: new Uint8Array(4),
  items: [{ label: 'Bitcoin seed', secret: 'abandon art' }],
  archived: false,
  credIds,
  registry: 'v2',
};

beforeEach(() => {
  vi.spyOn(ops, 'ensureMirror').mockResolvedValue({ status: 'saved' });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const bar = () => screen.getByRole('progressbar', { name: S.progress.label });
const states = () =>
  within(screen.getByRole('list', { name: S.progress.steps }))
    .getAllByRole('listitem')
    .map((li) => li.className.replace('stage stage-', ''));

async function editAndSave(write: (onProgress: OnProgress) => Promise<ops.VaultSession>) {
  vi.spyOn(ops, 'saveEdit').mockImplementation((_svc, _s, _items, _sign, onProgress) => write(onProgress as OnProgress));
  const u = userEvent.setup();
  render(
    <ServicesProvider value={fakeServices()}>
      <VaultView session={session} locator="0x" onChange={() => {}} onLock={() => {}} />
    </ServicesProvider>,
  );
  await u.click(screen.getByRole('button', { name: S.vault.edit }));
  await u.click(await screen.findByRole('button', { name: S.editor.save }));
  return u;
}

describe('save of an existing vault: five steps, starting with the key', () => {
  it('follows the real callbacks: encrypted + sponsored -> step 4 of 5 in progress', async () => {
    let progress!: OnProgress;
    await editAndSave((p) => {
      progress = p;
      return new Promise(() => undefined);
    });
    expect(bar()).toHaveAttribute('aria-valuemax', '5');
    expect(bar()).toHaveAttribute('aria-valuetext', 'Step 1 of 5: Touch your key');
    expect(states()).toEqual(['current', 'todo', 'todo', 'todo', 'todo']);
    await act(async () => progress('encrypted'));
    await act(async () => progress('sponsored'));
    expect(bar()).toHaveAttribute('aria-valuenow', '3');
    expect(bar()).toHaveAttribute('aria-valuetext', 'Step 4 of 5: Signed and sent');
    expect(states()).toEqual(['done', 'done', 'done', 'current', 'todo']);
  });

  it('failure: the bar stops at the failed step, next to the error', async () => {
    await editAndSave(async (p) => {
      p('encrypted');
      p('sponsored');
      throw new WriteError('NETWORK');
    });
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(states()).toEqual(['done', 'done', 'done', 'failed', 'todo']);
    expect(bar()).toHaveAttribute('aria-valuetext', S.progress.stopped('Signed and sent'));
    expect(document.querySelector('.progress .spinner')).toBeNull();
  });

  it('"Saved." does not wait for the Arweave copy, which runs in the background', async () => {
    vi.spyOn(ops, 'mirrorWrite').mockReturnValue(new Promise(() => undefined));
    await editAndSave(async (p) => {
      for (const st of ['encrypted', 'sponsored', 'sent', 'confirmed'] as const) p(st);
      return { ...session, version: 2 };
    });
    expect(await screen.findByText(S.save.saved)).toBeInTheDocument();
    expect(bar()).toHaveAttribute('aria-valuetext', S.progress.complete);
    const line = document.querySelector('.stage-background')!;
    expect(line).toHaveTextContent(S.progress.background);
    expect(line.querySelector('.spinner')).not.toBeNull();
    expect(within(screen.getByRole('list', { name: S.progress.steps })).queryByText(S.progress.arweave)).toBeNull(); // not a step
  });
});

describe('create: four steps (the keys were touched during setup)', () => {
  async function toSave(u: ReturnType<typeof userEvent.setup>) {
    vi.spyOn(ops, 'enrollWithPrf').mockImplementation(async (_s, n) => ({ credId: new Uint8Array(48).fill(n), publicKey: ('0x' + 'aa'.repeat(64)) as `0x${string}`, prf: new Uint8Array(32).fill(n) }));
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

  it('starts at Encrypted', async () => {
    const u = userEvent.setup();
    vi.spyOn(ops, 'saveNewVault').mockImplementation(() => new Promise(() => undefined));
    await toSave(u);
    await screen.findByRole('heading', { name: 'Saving your vault' });
    expect(bar()).toHaveAttribute('aria-valuemax', '4');
    expect(bar()).toHaveAttribute('aria-valuetext', 'Step 1 of 4: Encrypted on this device');
  });

  it('failure: back on the secrets step with the stopped progress and the error; a new Save resets it', async () => {
    const u = userEvent.setup();
    const save = vi.spyOn(ops, 'saveNewVault').mockImplementation(async (_s, _k, _i, _sign, onProgress) => {
      onProgress?.('encrypted');
      throw new WriteError('SPONSORSHIP_REFUSED');
    });
    await toSave(u);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(states()).toEqual(['done', 'failed', 'todo', 'todo']);
    save.mockImplementation(() => new Promise(() => undefined));
    await u.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByRole('heading', { name: 'Saving your vault' });
    expect(states()).toEqual(['current', 'todo', 'todo', 'todo']);
  });
});

describe('review M4: the create idle wipe also drops a stopped save progress', () => {
  it('after a failed save and the idle wipe, the secrets step shows no old progress', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const u = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      vi.spyOn(ops, 'enrollWithPrf').mockImplementation(async (_s, n) => ({ credId: new Uint8Array(48).fill(n), publicKey: ('0x' + 'aa'.repeat(64)) as `0x${string}`, prf: new Uint8Array(32).fill(n) }));
      vi.spyOn(ops, 'saveNewVault').mockImplementation(async (_s, _k, _i, _sign, onProgress) => {
        onProgress?.('encrypted');
        throw new WriteError('SPONSORSHIP_REFUSED');
      });
      renderApp();
      await u.click(screen.getByRole('button', { name: 'Create a new vault' }));
      await u.click(await screen.findByRole('button', { name: 'Get started' }));
      await u.click(await screen.findByRole('button', { name: 'Set up key 1' }));
      await u.click(await screen.findByRole('button', { name: 'Set up key 2' }));
      await u.click(await screen.findByRole('button', { name: 'Continue' }));
      await u.type(await screen.findByLabelText('Secret'), 'abandon art');
      await acknowledge(u);
      await u.click(screen.getByRole('button', { name: 'Save' }));
      expect(await screen.findByRole('list', { name: S.progress.steps })).toBeInTheDocument();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5 * 60_000 + 10);
      });
      await u.click(await screen.findByRole('button', { name: 'Set up key 1' }));
      await u.click(await screen.findByRole('button', { name: 'Set up key 2' }));
      await u.click(await screen.findByRole('button', { name: 'Continue' }));
      await screen.findByLabelText('Secret');
      expect(screen.queryByRole('list', { name: S.progress.steps })).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('unlock: Touch your key -> Finding your vaults -> Opening, only after 300 ms', () => {
  async function start(impl: (deps: { onPhase?: (p: 'finding' | 'opening') => void }) => Promise<unlockMod.UnlockResult>) {
    vi.spyOn(unlockMod, 'unlock').mockImplementation((_p, deps) => impl(deps as never));
    const u = userEvent.setup();
    renderApp();
    await u.click(screen.getByRole('button', { name: 'Unlock my vault' }));
    await u.click(screen.getByRole('button', { name: 'Unlock with my key' }));
  }

  it('no progress for a quick unlock (no flicker)', async () => {
    await start(async () => {
      throw new unlockMod.UnlockError('NO_VAULT');
    });
    expect(await screen.findByText(S.unlock.notFound)).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 400));
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('H1: a retry on the same screen waits 300 ms again (no flash)', async () => {
    let n = 0;
    vi.spyOn(unlockMod, 'unlock').mockImplementation(async () => {
      if (++n === 1) {
        await new Promise((r) => setTimeout(r, 400));
        throw new unlockMod.UnlockError('NO_VAULT');
      }
      return new Promise(() => undefined);
    });
    const u = userEvent.setup();
    renderApp();
    await u.click(screen.getByRole('button', { name: 'Unlock my vault' }));
    await u.click(screen.getByRole('button', { name: 'Unlock with my key' }));
    expect(await screen.findByRole('progressbar', { name: S.progress.openLabel }, { timeout: 1_000 })).toBeInTheDocument();
    await u.click(await screen.findByRole('button', { name: S.unlock.tryAgain }));
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(await screen.findByRole('progressbar', { name: S.progress.openLabel }, { timeout: 1_000 })).toBeInTheDocument();
  });

  it('after 300 ms: the steps follow the unlock phases; the key prompt is shown at once', async () => {
    let phase!: (p: 'finding' | 'opening') => void;
    await start((deps) => {
      phase = deps.onPhase!;
      return new Promise(() => undefined);
    });
    expect(screen.getByText(S.unlock.working)).toBeInTheDocument(); // the ceremony is never delayed
    expect(screen.queryByRole('progressbar')).toBeNull();
    const open = await screen.findByRole('progressbar', { name: S.progress.openLabel }, { timeout: 1_000 });
    expect(open).toHaveAttribute('aria-valuetext', 'Step 1 of 3: Touch your key');
    act(() => phase('finding'));
    expect(open).toHaveAttribute('aria-valuetext', 'Step 2 of 3: Finding your vaults');
    act(() => phase('opening'));
    await waitFor(() => expect(open).toHaveAttribute('aria-valuetext', 'Step 3 of 3: Opening'));
  });
});
