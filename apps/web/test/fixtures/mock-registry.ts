/** In-memory VaultRegistry behind a viem `custom` transport (eth_call only). */
import { custom, decodeFunctionData, encodeFunctionResult, type Hex } from 'viem';
import { registryAbi, config } from 'virtual:cryoshield-config';

export interface StoredVault {
  owner: Hex;
  blob: Hex;
  version: number;
}

export class MockRegistry {
  vaults = new Map<string, StoredVault>();
  index = new Map<string, Hex[]>();
  calls: string[] = [];

  put(vaultId: Hex, v: StoredVault, locators: Hex[]) {
    this.vaults.set(vaultId.toLowerCase(), v);
    for (const l of locators) {
      const k = l.toLowerCase();
      this.index.set(k, [...(this.index.get(k) ?? []), vaultId]);
    }
  }

  transport() {
    return custom({
      request: async ({ method, params }: { method: string; params: any }) => {
        if (method === 'eth_chainId') return '0x' + config.chainId.toString(16);
        if (method !== 'eth_call') throw new Error(`unsupported ${method}`);
        const { to, data } = params[0];
        if (to.toLowerCase() !== config.registry.address.toLowerCase()) throw new Error('wrong registry address');
        const { functionName, args } = decodeFunctionData({ abi: registryAbi as any, data });
        this.calls.push(functionName);
        if (functionName === 'resolveLocator') {
          return encodeFunctionResult({ abi: registryAbi as any, functionName, result: this.index.get((args![0] as string).toLowerCase()) ?? [] });
        }
        if (functionName === 'getVault') {
          const v = this.vaults.get((args![0] as string).toLowerCase());
          const r = v ? [v.owner, v.blob, v.version] : ['0x0000000000000000000000000000000000000000', '0x', 0];
          return encodeFunctionResult({ abi: registryAbi as any, functionName, result: r as any });
        }
        throw new Error(`unsupported fn ${functionName}`);
      },
    });
  }
}
