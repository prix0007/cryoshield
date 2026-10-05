/**
 * In-memory VaultRegistry v1 and v2 behind a viem `custom` transport (eth_call only). v2 follows the
 * harden-gas-sponsorship vault-registry delta: no locator cap, resolveLocator(locator, start, count) clamped to 256,
 * locatorLength, getVaults reverting above 32 ids.
 */
import { custom, decodeFunctionData, encodeErrorResult, encodeFunctionResult, type Abi, type Hex } from 'viem';
import { registryV1Abi, config } from 'virtual:cryoshield-config';
import { registryV2Abi } from '../../src/chain/contracts';

export interface StoredVault {
  owner: Hex;
  blob: Hex;
  version: number;
}

const ZERO = '0x0000000000000000000000000000000000000000';

class Revert extends Error {
  constructor(readonly data: Hex) {
    super('execution reverted');
  }
}

export class MockRegistry {
  vaults = new Map<string, StoredVault>();
  index = new Map<string, Hex[]>();
  calls: string[] = [];

  constructor(readonly version: 'v1' | 'v2' = 'v2') {}

  get address(): Hex {
    return this.version === 'v1' ? config.registryV1!.address : config.registryV2.address;
  }

  get abi(): Abi {
    return (this.version === 'v1' ? registryV1Abi : registryV2Abi) as Abi;
  }

  put(vaultId: Hex, v: StoredVault, locators: Hex[]) {
    this.vaults.set(vaultId.toLowerCase(), v);
    for (const l of locators) {
      const k = l.toLowerCase();
      this.index.set(k, [...(this.index.get(k) ?? []), vaultId]);
    }
  }

  private list(locator: string): Hex[] {
    return this.index.get(locator.toLowerCase()) ?? [];
  }

  private vault(id: string): [Hex, Hex, number] {
    const v = this.vaults.get(id.toLowerCase());
    return v ? [v.owner, v.blob, v.version] : [ZERO, '0x', 0];
  }

  handle(data: Hex): Hex {
    const { functionName, args } = decodeFunctionData({ abi: this.abi, data });
    const a = (args ?? []) as readonly unknown[];
    this.calls.push(functionName);
    const out = (result: unknown) => encodeFunctionResult({ abi: this.abi, functionName, result } as never);
    switch (functionName) {
      case 'resolveLocator': {
        const all = this.list(a[0] as string);
        if (this.version === 'v1') return out(all.slice(0, 16));
        const start = Number(a[1] as bigint);
        const count = Math.min(Number(a[2] as bigint), 256);
        return out(start >= all.length ? [] : all.slice(start, start + count));
      }
      case 'locatorLength':
        return out(BigInt(this.list(a[0] as string).length));
      case 'getVault':
        return out(this.vault(a[0] as string));
      case 'getVaults': {
        const ids = a[0] as Hex[];
        if (ids.length > 32) throw new Revert(encodeErrorResult({ abi: registryV2Abi, errorName: 'TooManyIds', args: [BigInt(ids.length)] }));
        return out(ids.map((id) => {
          const [owner, blob, version] = this.vault(id);
          return { owner, blob, version };
        }));
      }
      default:
        throw new Error(`unsupported fn ${functionName}`);
    }
  }

  /** One transport for both registries: `this` plus any others; a registry not given behaves as empty. */
  transport(...others: MockRegistry[]) {
    const regs = [this, ...others];
    const byVersion = (v: 'v1' | 'v2') => regs.find((r) => r.version === v) ?? new MockRegistry(v);
    const v1 = byVersion('v1');
    const v2 = byVersion('v2');
    return custom({
      request: async ({ method, params }: { method: string; params: any }) => {
        if (method === 'eth_chainId') return '0x' + config.chainId.toString(16);
        if (method !== 'eth_call') throw new Error(`unsupported ${method}`);
        const { to, data } = params[0];
        const reg = config.registryV1 && to.toLowerCase() === config.registryV1.address.toLowerCase() ? v1 : to.toLowerCase() === config.registryV2.address.toLowerCase() ? v2 : null;
        if (!reg) throw new Error('wrong registry address');
        try {
          return reg.handle(data);
        } catch (e) {
          if (e instanceof Revert) throw Object.assign(new Error('execution reverted'), { code: 3, data: e.data });
          throw e;
        }
      },
    });
  }
}
