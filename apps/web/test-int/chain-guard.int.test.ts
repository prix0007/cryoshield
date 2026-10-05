/** target-op-sepolia review: a real RPC on another chain is refused, never reported as "no vault". */
import { spawn, type ChildProcess } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { http } from 'viem';
import { FakeAuthenticators } from '../test/fixtures/fake-webauthn';
import { enrollKey } from '../src/webauthn';
import { createRegistryReader } from '../src/chain/registry';
import { unlock } from '../src/chain/unlock';
import { ChainMismatchError } from '../src/chain/guard';
import { makePublicClient, newVaultAccount } from '../src/account/account';
import { preflight } from '../src/account/writes';

const PORT = 8557;
let other: ChildProcess;

beforeAll(async () => {
  // A second node that claims to be OP Sepolia while the build is configured for 31337.
  other = spawn('anvil', ['--port', String(PORT), '--chain-id', '11155420', '--silent'], { stdio: 'ignore' });
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' });
      if (r.ok) break;
    } catch {
      /* not up */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
});
afterAll(() => {
  other?.kill();
});

describe('chain ID guard against a real node on the wrong chain', () => {
  it('unlock is refused with ChainMismatchError instead of "no vault"', async () => {
    const f = new FakeAuthenticators();
    f.addKey();
    await enrollKey({ rpId: 'localhost', rpName: 'x', label: 'a', exclude: [] }, f.credentials);
    const err = await unlock({ rpId: 'localhost' }, { credentials: f.credentials, reader: createRegistryReader(http(`http://127.0.0.1:${PORT}`)) }).catch((e) => e);
    expect(err).toBeInstanceOf(ChainMismatchError);
    expect(err.actual).toBe(11155420);
    expect(err.expected).toBe(31337);
  });

  it('account actions and write preflight are refused before any call', async () => {
    const client = makePublicClient(http(`http://127.0.0.1:${PORT}`));
    await expect(
      newVaultAccount({ client, owners: [{ credId: new Uint8Array(16), publicKey: ('0x' + 'aa'.repeat(64)) as `0x${string}` }], signerIndex: 0, expectedLocator: new Uint8Array(32) }),
    ).rejects.toBeInstanceOf(ChainMismatchError);
    await expect(preflight(client, '0x00000000000000000000000000000000000000aa', [])).rejects.toBeInstanceOf(ChainMismatchError);
  });

  it('the correctly configured node passes', async () => {
    const r = createRegistryReader(http('http://127.0.0.1:8545'));
    expect(await r.candidatesFor(('0x' + '12'.repeat(32)) as `0x${string}`)).toEqual([]);
  });
});
