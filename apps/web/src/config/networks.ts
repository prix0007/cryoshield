/**
 * Per-chain display name and block explorer (show-vault-onchain-location D1). Pure: used by the Vite plugin at build
 * time (runtime `config.network`, the architecture page) and by the vault-location panel's link builders.
 * The OP explorers are the canonical Blockscout hosts the deploy script uses (optimism-*.blockscout.com redirects there).
 *
 * launch-op-mainnet D6: `status` drives every public network statement (landing, legal pages, app banner, llms.txt).
 * An unknown chain is a testnet, so the testnet and unaudited warning shows (fail safe).
 */
export type NetworkStatus = 'testnet' | 'mainnet';

export interface NetworkInfo {
  name: string;
  /** The name used in sentences ("stored on OP Sepolia, a test network"). */
  shortName: string;
  status: NetworkStatus;
  /** Explorer base URL (no trailing slash), or null where there is none (local chain). */
  explorerUrl: string | null;
}

export const NETWORKS: Readonly<Record<number, NetworkInfo>> = {
  11155420: { name: 'OP Sepolia testnet', shortName: 'OP Sepolia', status: 'testnet', explorerUrl: 'https://testnet-explorer.optimism.io' },
  10: { name: 'OP Mainnet', shortName: 'OP Mainnet', status: 'mainnet', explorerUrl: 'https://explorer.optimism.io' },
  421614: { name: 'Arbitrum Sepolia testnet', shortName: 'Arbitrum Sepolia', status: 'testnet', explorerUrl: 'https://arbitrum-sepolia.blockscout.com' },
  42161: { name: 'Arbitrum One', shortName: 'Arbitrum One', status: 'mainnet', explorerUrl: 'https://arbitrum.blockscout.com' },
  31337: { name: 'local test chain', shortName: 'a local test chain', status: 'testnet', explorerUrl: null },
};

export function networkFor(chainId: number): NetworkInfo {
  return NETWORKS[chainId] ?? { name: `chain ${chainId}`, shortName: `chain ${chainId}`, status: 'testnet', explorerUrl: null };
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
