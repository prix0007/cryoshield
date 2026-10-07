/**
 * Per-chain display name and block explorer (show-vault-onchain-location D1). Pure: used by the Vite plugin at build
 * time (runtime `config.network`, the architecture page) and by the vault-location panel's link builders.
 * The OP explorers are the canonical Blockscout hosts the deploy script uses (optimism-*.blockscout.com redirects there).
 */
export interface NetworkInfo {
  name: string;
  /** Explorer base URL (no trailing slash), or null where there is none (local chain). */
  explorerUrl: string | null;
}

export const NETWORKS: Readonly<Record<number, NetworkInfo>> = {
  11155420: { name: 'OP Sepolia testnet', explorerUrl: 'https://testnet-explorer.optimism.io' },
  10: { name: 'OP Mainnet', explorerUrl: 'https://explorer.optimism.io' },
  421614: { name: 'Arbitrum Sepolia testnet', explorerUrl: 'https://arbitrum-sepolia.blockscout.com' },
  42161: { name: 'Arbitrum One', explorerUrl: 'https://arbitrum.blockscout.com' },
  31337: { name: 'local test chain', explorerUrl: null },
};

export function networkFor(chainId: number): NetworkInfo {
  return NETWORKS[chainId] ?? { name: `chain ${chainId}`, explorerUrl: null };
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HASH32 = /^0x[0-9a-fA-F]{64}$/;
const ARWEAVE_ID = /^[A-Za-z0-9_-]{43}$/;

/** Link targets only ever combine a build-time base with a strictly formatted value; anything else gets no link. */
export const addressUrl = (explorer: string | null, address: string): string | null =>
  explorer && ADDRESS.test(address) ? `${explorer}/address/${address}` : null;
export const txUrl = (explorer: string | null, hash: string): string | null => (explorer && HASH32.test(hash) ? `${explorer}/tx/${hash}` : null);
export const arweaveUrl = (gateway: string, id: string): string | null => (ARWEAVE_ID.test(id) ? `${gateway}/${id}` : null);
export const isArweaveId = (id: string): boolean => ARWEAVE_ID.test(id);
