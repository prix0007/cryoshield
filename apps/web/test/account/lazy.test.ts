/** harden-gas-sponsorship 5.5: the lazily loaded write stack (loader, retry after a failed chunk, deferred sponsor). */
import { describe, expect, it, vi } from 'vitest';
import type { Hex } from 'viem';
import { lazySponsor, writeStackLoader, type WriteStack } from '../../src/account/lazy';
import { WriteError } from '../../src/account/writes';

const chunkError = () => new TypeError('Failed to fetch dynamically imported module: /assets/stack-abc.js');

describe('writeStackLoader', () => {
  it('imports once and reuses the module', async () => {
    const mod = { tag: 'stack' } as unknown as WriteStack;
    const importer = vi.fn(async () => mod);
    const load = writeStackLoader(importer);
    expect(await load()).toBe(mod);
    expect(await load()).toBe(mod);
    expect(importer).toHaveBeenCalledTimes(1);
  });

  it('a failed chunk load is a LOAD_FAILED WriteError (cause kept) and the next attempt imports again', async () => {
    const mod = { tag: 'stack' } as unknown as WriteStack;
    const importer = vi.fn<() => Promise<WriteStack>>().mockRejectedValueOnce(chunkError()).mockResolvedValueOnce(mod);
    const load = writeStackLoader(importer);
    const err = await load().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WriteError);
    expect((err as WriteError).code).toBe('LOAD_FAILED');
    expect((err as WriteError).detail.cause).toBeInstanceOf(TypeError);
    expect(await load()).toBe(mod);
    expect(importer).toHaveBeenCalledTimes(2);
  });

  it('the default loader resolves the real write stack', async () => {
    const m = await writeStackLoader()();
    expect(typeof m.createVaultOnChain).toBe('function');
    expect(typeof m.newVaultAccount).toBe('function');
    expect(typeof m.createSponsor).toBe('function');
  });
});

describe('lazySponsor', () => {
  const client = { tag: 'client' } as never;
  const account = { tag: 'account' } as never;
  const calls = [{ to: '0x01' as Hex, value: 0n, data: '0x' as Hex }];

  it('creates the real sponsor on the first send only, then forwards every send', async () => {
    const send = vi.fn(async () => ({ userOpHash: '0xaa' as Hex, success: true }));
    const createSponsor = vi.fn(() => ({ send }));
    const load = vi.fn(async () => ({ createSponsor }) as unknown as WriteStack);
    const sponsor = lazySponsor(client, load);
    expect(load).not.toHaveBeenCalled(); // nothing loads until a write
    const onProgress = vi.fn();
    expect(await sponsor.send(account, calls, onProgress)).toEqual({ userOpHash: '0xaa', success: true });
    await sponsor.send(account, calls);
    expect(createSponsor).toHaveBeenCalledTimes(1);
    expect(createSponsor).toHaveBeenCalledWith(client);
    expect(send).toHaveBeenNthCalledWith(1, account, calls, onProgress);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('a failed load rejects the send with LOAD_FAILED, and a later send can still succeed', async () => {
    const send = vi.fn(async () => ({ userOpHash: '0xaa' as Hex, success: true }));
    const load = vi
      .fn<() => Promise<WriteStack>>()
      .mockRejectedValueOnce(new WriteError('LOAD_FAILED', { cause: chunkError() }))
      .mockResolvedValue({ createSponsor: () => ({ send }) } as unknown as WriteStack);
    const sponsor = lazySponsor(client, load);
    await expect(sponsor.send(account, calls)).rejects.toMatchObject({ code: 'LOAD_FAILED' });
    await expect(sponsor.send(account, calls)).resolves.toMatchObject({ success: true });
  });
});
