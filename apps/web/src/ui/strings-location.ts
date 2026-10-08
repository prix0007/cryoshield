/**
 * Strings of the lazily loaded "Where your vault is stored" panel (show-vault-onchain-location D3). Kept out of
 * strings.ts so they ship in the panel's chunk; the same plain-language rules apply (checked by guards.test.tsx).
 * Public facts only: never locators or key material.
 */
export const LOCATION = {
  intro: 'These public details let you check, on your own, that your locked vault exists. They can’t open it.',
  publicNote: 'Anyone can see that this encrypted vault exists at this address; only your keys can open it.',
  network: 'Network',
  networkValue: (name: string, chainId: number) => `${name} (chain ID ${chainId})`,
  registry: 'Vault registry',
  registryVersion: (version: string, readOnly: boolean) => `Version ${version.slice(1)}${readOnly ? ' (read-only)' : ''}`,
  vaultId: 'Vault ID',
  owner: 'Vault account',
  version: 'Version',
  lastSave: 'Last save',
  arweave: 'Arweave copy',
  arweaveHint: 'The Arweave link can take a few hours to work after a save.',
  copy: 'Copy',
  copied: (label: string) => `${label} copied.`,
  newTab: 'opens in a new tab',
} as const;
