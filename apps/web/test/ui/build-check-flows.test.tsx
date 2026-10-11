/**
 * reload-on-new-build D2/D4: every write path asks the build check first. `outdated` stops it before the write stack
 * loads and before any key ceremony, keeps the draft, and offers Reload page; `unknown` lets it through.
 */
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Hex } from 'viem';
import * as ops from '../../src/ui/operations';
import * as unlockMod from '../../src/chain/unlock';
import * as buildCheck from '../../src/lib/build-check';
import { saveVaultMeta, archiveAndClear } from '../../src/ui/vault-meta';
import { S } from '../../src/ui/strings';
import { fakeServices, renderApp } from './helpers';
import type { Services } from '../../src/ui/services';
import { WriteError } from '../../src/account/errors';

const stack = vi.hoisted(() => ({ loaded: vi.fn() }));
vi.mock('../../src/account/stack', () => {
  stack.loaded();
  throw new TypeError('the write stack must not load for an outdated build');
});

const id = (n: number) => new Uint8Array(48).fill(n);
const credentials = () => ({ create: vi.fn(async () => null), get: vi.fn(async () => null) });
const outdated = vi.fn(async () => 'outdated' as const);

const session = (): ops.VaultSession => ({
  vaultId: ('0x' + '12'.repeat(32)) as Hex,
  owner: ('0x' + '34'.repeat(20)) as Hex,
  version: 1,
  blob: new Uint8Array(400).fill(1),
  items: [{ label: 'Bitcoin seed', secret: 'abandon art' }],
  archived: false,
  credIds: [id(1), id(2)],
  registry: 'v2',
});

beforeEach(async () => {
  stack.loaded.mockClear();
  outdated.mockClear();
  vi.spyOn(await import('../../src/account/budget'), 'pinIfCurrent').mockResolvedValue(0n);
  vi.spyOn(ops, 'mirrorWrite').mockResolvedValue({ status: 'saved' });
  vi.spyOn(ops, 'ensureMirror').mockResolvedValue({ status: 'saved' });
  vi.spyOn(await import('@cryoshield/vault-crypto'), 'decodeVault').mockReturnValue({ entries: [{ credId: id(1) }, { credId: id(2) }], keyCount: 2 } as never);
});
afterEach(() => vi.restoreAllMocks());

describe('operations refuse an outdated build before anything else', () => {
  const wp: ops.WritePath = { rewrite: ops.rewrite, withPayload: ops.withPayload };

  it.each([
    ['create', (svc: Services) => ops.saveNewVault(svc, [{ credId: id(1), publicKey: '0x', prf: new Uint8Array(32).fill(1) }, { credId: id(2), publicKey: '0x', prf: new Uint8Array(32).fill(2) }] as never, [{ label: 'a', secret: 'b' }], () => undefined)],
    ['edit', (svc: Services) => ops.saveEdit(svc, session(), [{ label: 'a', secret: 'c' }], () => undefined)],
    ['rename', (svc: Services) => saveVaultMeta(wp, svc, session(), { name: 'New name', archived: false }, () => undefined)],
    ['archive', (svc: Services) => saveVaultMeta(wp, svc, session(), { archived: true }, () => undefined)],
    ['archive and clear', (svc: Services) => archiveAndClear(wp, svc, session(), () => undefined)],
    ['add a key', (svc: Services) => ops.saveAddKey(svc, session(), { onInsertNew: vi.fn(), onNewAgain: vi.fn(), onSign: vi.fn() })],
  ])('%s: OUTDATED, no write stack, no ceremony, no send', async (_name, run) => {
    const creds = credentials();
    const sponsor = { send: vi.fn() };
    const svc = fakeServices({ buildCheck: outdated, credentials: creds, sponsor });
    await expect(run(svc)).rejects.toMatchObject({ code: 'OUTDATED' });
    expect(outdated).toHaveBeenCalledTimes(1);
    expect(stack.loaded).not.toHaveBeenCalled();
    expect(creds.get).not.toHaveBeenCalled();
    expect(creds.create).not.toHaveBeenCalled();
    expect(sponsor.send).not.toHaveBeenCalled();
  });

  it('unknown: the write goes on (here it reaches the write stack, which this file makes fail)', async () => {
    const svc = fakeServices({ buildCheck: async () => 'unknown' });
    await expect(ops.saveEdit(svc, session(), [{ label: 'a', secret: 'c' }], () => undefined)).rejects.toMatchObject({ code: 'LOAD_FAILED' });
    expect(stack.loaded).toHaveBeenCalled();
  });

  it('the message is plain and says what a reload does', () => {
    expect(ops.messageFor(new WriteError('OUTDATED'))).toBe(S.save.outdated);
    expect(ops.messageFor(new WriteError('OUTDATED'), 'create')).toBe(S.save.outdated);
    expect(S.save.outdated).toMatch(/updated/i);
    expect(S.save.outdated).toMatch(/reload/i);
    expect(S.save.outdated).toMatch(/unsaved/i);
  });
});

describe('the vault screen', () => {
  async function openVault(u: ReturnType<typeof userEvent.setup>, creds: ReturnType<typeof credentials>) {
    vi.spyOn(unlockMod, 'unlock').mockResolvedValue({
      credId: id(1),
      locator: new Uint8Array(32),
      matches: [{ ...session(), entryIndex: 0 }],
    } as never);
    renderApp({ credentials: creds, buildCheck: outdated });
    await u.click(screen.getByRole('button', { name: 'Unlock my vault' }));
    await u.click(screen.getByRole('button', { name: 'Unlock with my key' }));
    await screen.findByRole('button', { name: 'Edit secrets' });
  }

  it('edit: the alert says the app was updated, the draft stays, and Reload page reloads', async () => {
    const reload = vi.spyOn(buildCheck, 'reloadPage').mockImplementation(() => undefined);
    const u = userEvent.setup();
    const creds = credentials();
    await openVault(u, creds);
    await u.click(screen.getByRole('button', { name: 'Edit secrets' }));
    await u.clear(screen.getByLabelText('Secret'));
    await u.type(screen.getByLabelText('Secret'), 'new value');
    await u.click(screen.getByRole('button', { name: 'Save' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('CryoShield was updated');
    expect(alert).toHaveTextContent(S.save.outdated);
    expect(screen.getByLabelText('Secret')).toHaveValue('new value');
    expect(creds.get).not.toHaveBeenCalled();
    await u.click(screen.getAllByRole('button', { name: S.reloadPage }).at(-1)!);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('add a key: refused before any tap', async () => {
    const u = userEvent.setup();
    const creds = credentials();
    await openVault(u, creds);
    await u.click(screen.getByRole('button', { name: S.vault.addKey }));
    await screen.findByRole('heading', { name: S.addKey.title });
    const starts = screen.getAllByRole('button', { name: S.addKey.start });
    await u.click(starts[starts.length - 1]!);
    expect(await screen.findByRole('alert')).toHaveTextContent(S.save.outdated);
    expect(creds.get).not.toHaveBeenCalled();
    expect(creds.create).not.toHaveBeenCalled();
  });
});
