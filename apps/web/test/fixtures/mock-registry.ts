/**
 * In-memory VaultRegistry deployments behind a viem `custom` transport (eth_call only). Kind 2 (the v2 interface) follows
 * the harden-gas-sponsorship vault-registry delta: no locator cap, resolveLocator(locator, start, count) clamped to 256,
 * locatorLength, getVaults reverting above 32 ids. Kind 1 is the legacy v1 interface. Any version can be mocked (a fake
 * v3 with the v2 interface: `new MockRegistry('v3', { abi: 2, address })`, web-registry-versions).
 */
import { custom, decodeFunctionData, encodeErrorResult, encodeFunctionResult, type Abi, type Hex } from 'viem';
import { config } from 'virtual:cryoshield-config';
import registryV1Abi from '../../../../contracts/abi/VaultRegistry.json';
import { registryV2Abi } from '../../src/chain/contracts';
import type { RegistryConfig } from '../../src/config/schema';

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

  readonly kind: 1 | 2;
  readonly address: Hex;

  /** A configured registry by version, or any other deployment given its interface kind and address. */
  constructor(
    readonly version: `v${number}` = 'v2',
    at?: { abi: 1 | 2; address: Hex },
  ) {
    const c = at ?? (config.registries as readonly RegistryConfig[]).find((r) => r.version === version);
    if (!c) throw new Error(`no configured registry ${version}`);
    this.kind = c.abi;
    this.address = c.address;
  }

  /** This deployment as a reader config entry. */
  get config(): RegistryConfig {
    return { version: this.version, abi: this.kind, address: this.address, deployBlock: 1 };
  }

  get abi(): Abi {
    return (this.kind === 1 ? registryV1Abi : registryV2Abi) as Abi;
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
        if (this.kind === 1) return out(all.slice(0, 16));
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

  /** One transport for every registry: `this` plus any others; a configured registry not given behaves as empty. */
  transport(...others: MockRegistry[]) {
    const regs = [this, ...others];
    const empty = new Map<string, MockRegistry>();
    const route = (to: string): MockRegistry | null => {
      const at = to.toLowerCase();
      const given = regs.find((r) => r.address.toLowerCase() === at);
      if (given) return given;
      const c = (config.registries as readonly RegistryConfig[]).find((r) => r.address.toLowerCase() === at);
      if (!c) return null;
      if (!empty.has(at)) empty.set(at, new MockRegistry(c.version));
      return empty.get(at)!;
    };
    return custom({
      request: async ({ method, params }: { method: string; params: any }) => {
        if (method === 'eth_chainId') return '0x' + config.chainId.toString(16);
        if (method !== 'eth_call') throw new Error(`unsupported ${method}`);
        const { to, data } = params[0];
        const reg = route(to);
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
