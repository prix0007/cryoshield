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

  it('concurrent loads share one import; its failure fails both with LOAD_FAILED; a later load re-imports', async () => {
    let reject!: (e: unknown) => void;
    const mod = { tag: 'stack' } as unknown as WriteStack;
    const importer = vi
      .fn<() => Promise<WriteStack>>()
      .mockImplementationOnce(() => new Promise<WriteStack>((_r, j) => (reject = j)))
      .mockResolvedValueOnce(mod);
    const load = writeStackLoader(importer);
    const a = load();
    const b = load();
    await Promise.resolve(); // let the deferred importer start
    expect(importer).toHaveBeenCalledTimes(1);
    reject(chunkError());
    const [ea, eb] = await Promise.all([a.catch((e: unknown) => e), b.catch((e: unknown) => e)]);
    expect(ea).toBeInstanceOf(WriteError);
    expect((ea as WriteError).code).toBe('LOAD_FAILED');
    expect((eb as WriteError).code).toBe('LOAD_FAILED');
    expect(await load()).toBe(mod);
    expect(importer).toHaveBeenCalledTimes(2);
  });

  it('an importer that throws synchronously is a LOAD_FAILED rejection, not a throw', async () => {
    const load = writeStackLoader(() => {
      throw chunkError();
    });
    const p = load(); // must not throw here
    await expect(p).rejects.toMatchObject({ code: 'LOAD_FAILED' });
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

  it('concurrent first sends share one load and one real sponsor', async () => {
    let resolve!: (m: WriteStack) => void;
    const send = vi.fn(async () => ({ userOpHash: '0xaa' as Hex, success: true }));
    const createSponsor = vi.fn(() => ({ send }));
    const load = vi.fn(() => new Promise<WriteStack>((r) => (resolve = r)));
    const sponsor = lazySponsor(client, load);
    const a = sponsor.send(account, calls);
    const b = sponsor.send(account, calls);
    resolve({ createSponsor } as unknown as WriteStack);
    await Promise.all([a, b]);
    expect(load).toHaveBeenCalledTimes(1);
    expect(createSponsor).toHaveBeenCalledTimes(1);
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
