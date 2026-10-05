// @vitest-environment node
/**
 * Deployment record loader (spec deployment-targets "Per-chain deployment records", harden-gas-sponsorship 5.1):
 * v1 top-level (optional, legacy reads), contracts.vaultRegistryV2 (required), contracts.wallets[VITE_RP_ID]
 * (required, selected by RP ID, never another RP ID's), every abiHash checked, and the app's ABI fragments
 * checked against the exported ABIs.
 */
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { keccak256, sha256, toHex, type Abi } from 'viem';
import { describe, expect, it } from 'vitest';
import { assertAbiCovers, loadDeployment } from '../../vite-plugins/deployment';

import { registryV2Abi, smartWalletAbi, walletFactoryAbi } from '../../src/chain/contracts';

const V1 = '0xB43f58cF17e64B603aE5588a1DD17E96a0849e44';
const V2 = '0x00000000000000000000000000000000000000a2';
const PROD = { rpId: 'cryoshield.app', factory: '0x00000000000000000000000000000000000000f1', implementation: '0x00000000000000000000000000000000000000e1' };
const DEV = { rpId: 'cryoshield-web-dev.fly.dev', factory: '0x00000000000000000000000000000000000000f2', implementation: '0x00000000000000000000000000000000000000e2' };

const json = (abi: Abi | readonly unknown[]) => JSON.stringify(abi);
const hash = (s: string) => keccak256(toHex(new TextEncoder().encode(s)));
const rpIdHash = (rpId: string) => sha256(toHex(new TextEncoder().encode(rpId)));

interface Opts {
  v1?: boolean;
  v2?: boolean;
  wallets?: (typeof PROD)[];
  chainId?: number;
  abis?: Partial<Record<'v1' | 'v2' | 'wallet' | 'factory', string>>;
  patchWallet?: (w: Record<string, unknown>) => void;
}

function contracts(o: Opts = {}) {
  const chainId = o.chainId ?? 11155420;
  const abis = {
    v1: o.abis?.v1 ?? '[{"type":"function","name":"x","inputs":[],"outputs":[],"stateMutability":"view"}]',
    v2: o.abis?.v2 ?? json(registryV2Abi),
    wallet: o.abis?.wallet ?? json(smartWalletAbi),
    factory: o.abis?.factory ?? json(walletFactoryAbi),
  };
  const dir = mkdtempSync(join(tmpdir(), 'cs-dep-'));
  mkdirSync(join(dir, 'abi'));
  mkdirSync(join(dir, 'deployments'));
  writeFileSync(join(dir, 'abi', 'VaultRegistry.json'), abis.v1);
  writeFileSync(join(dir, 'abi', 'VaultRegistryV2.json'), abis.v2);
  writeFileSync(join(dir, 'abi', 'CryoShieldSmartWallet.json'), abis.wallet);
  writeFileSync(join(dir, 'abi', 'CryoShieldSmartWalletFactory.json'), abis.factory);
  const rec: Record<string, unknown> = { chainId };
  if (o.v1 ?? true) Object.assign(rec, { address: V1, deployBlock: 7, txHash: '0x' + '11'.repeat(32), abiHash: hash(abis.v1) });
  const c: Record<string, unknown> = {};
  if (o.v2 ?? true) c.vaultRegistryV2 = { address: V2, deployBlock: 9, txHash: '0x' + '22'.repeat(32), abiHash: hash(abis.v2) };
  const wallets: Record<string, Record<string, unknown>> = {};
  for (const w of o.wallets ?? [PROD, DEV]) {
    wallets[w.rpId] = {
      implementation: w.implementation,
      factory: w.factory,
      rpIdHash: rpIdHash(w.rpId),
      deployBlock: 10,
      txHash: '0x' + '33'.repeat(32),
      abiHash: hash(abis.wallet),
      factoryAbiHash: hash(abis.factory),
    };
    o.patchWallet?.(wallets[w.rpId]!);
  }
  c.wallets = wallets;
  rec.contracts = c;
  writeFileSync(join(dir, 'deployments', `${chainId}.json`), JSON.stringify(rec));
  return dir;
}

describe('loadDeployment: registries', () => {
  it('reads v1 (legacy) and v2 with their deploy blocks', () => {
    const d = loadDeployment(contracts(), 11155420, 'cryoshield.app');
    expect(d.v1).toMatchObject({ address: V1, deployBlock: 7 });
    expect(d.v1!.abi).toHaveLength(1);
    expect([d.v2.address.toLowerCase(), d.v2.deployBlock]).toEqual([V2, 9]);
  });

  it('a record with no top-level v1 address (OP Mainnet) uses only v2', () => {
    const d = loadDeployment(contracts({ v1: false, chainId: 10, wallets: [PROD] }), 10, 'cryoshield.app');
    expect(d.v1).toBeNull();
    expect(d.v2.address).toMatch(/^0x/);
  });

  it('refuses a v1 entry on OP Mainnet (v1 is never deployed there)', () => {
    expect(() => loadDeployment(contracts({ chainId: 10, wallets: [PROD] }), 10, 'cryoshield.app')).toThrow(/v1.*OP Mainnet|chain 10/);
  });

  it('fails naming the expected path when the chain has no record', () => {
    expect(() => loadDeployment(contracts(), 421614, 'cryoshield.app')).toThrow(join('deployments', '421614.json'));
  });

  it('fails when contracts.vaultRegistryV2 is missing', () => {
    expect(() => loadDeployment(contracts({ v2: false }), 11155420, 'cryoshield.app')).toThrow(/vaultRegistryV2/);
  });

  it('fails naming both hashes on v1 or v2 ABI drift', () => {
    const dir = contracts();
    writeFileSync(join(dir, 'abi', 'VaultRegistryV2.json'), json([...registryV2Abi, { type: 'function', name: 'extra', inputs: [], outputs: [], stateMutability: 'view' }]));
    expect(() => loadDeployment(dir, 11155420, 'cryoshield.app')).toThrow(/VaultRegistryV2.*abiHash/);
    const dir1 = contracts();
    writeFileSync(join(dir1, 'abi', 'VaultRegistry.json'), '[]');
    expect(() => loadDeployment(dir1, 11155420, 'cryoshield.app')).toThrow(/VaultRegistry ABI drift/);
  });

  it('fails when the exported v2 ABI lacks a fragment the app uses (interface drift)', () => {
    const changed = registryV2Abi.map((i) => (i.type === 'function' && i.name === 'resolveLocator' ? { ...i, inputs: i.inputs.slice(0, 1) } : i));
    expect(() => loadDeployment(contracts({ abis: { v2: json(changed) } }), 11155420, 'cryoshield.app')).toThrow(/resolveLocator/);
  });

  it('fails on a chainId mismatch or a malformed address', () => {
    const dir = contracts();
    expect(() => loadDeployment(dir, 11155420, 'cryoshield.app')).not.toThrow();
    writeFileSync(join(dir, 'deployments', '1.json'), JSON.stringify({ chainId: 2 }));
    expect(() => loadDeployment(dir, 1, 'cryoshield.app')).toThrow(/chainId/);
    expect(() => loadDeployment(contracts({ wallets: [{ ...PROD, factory: '0x1234' }] }), 11155420, 'cryoshield.app')).toThrow(/factory/);
  });
});

describe('loadDeployment: wallet entry selected by VITE_RP_ID (5.1)', () => {
  it('two RP IDs on one chain: each build gets only its own factory and implementation', () => {
    const dir = contracts();
    const prod = loadDeployment(dir, 11155420, 'cryoshield.app');
    const dev = loadDeployment(dir, 11155420, 'cryoshield-web-dev.fly.dev');
    expect([prod.wallet.rpId, prod.wallet.factory.toLowerCase(), prod.wallet.implementation.toLowerCase()]).toEqual([PROD.rpId, PROD.factory, PROD.implementation]);
    expect([dev.wallet.rpId, dev.wallet.factory.toLowerCase(), dev.wallet.implementation.toLowerCase()]).toEqual([DEV.rpId, DEV.factory, DEV.implementation]);
  });

  it('fails only when the build’s RP ID has no entry, naming the RP ID and the record, even if others exist', () => {
    const dir = contracts({ wallets: [PROD] });
    expect(() => loadDeployment(dir, 11155420, 'cryoshield.app')).not.toThrow();
    let msg = '';
    try {
      loadDeployment(dir, 11155420, 'cryoshield-web-dev.fly.dev');
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toContain('cryoshield-web-dev.fly.dev');
    expect(msg).toContain(join('deployments', '11155420.json'));
  });

  it('never falls back to Coinbase’s factory', () => {
    const dir = contracts({ wallets: [{ ...PROD, factory: '0xBA5ED110eFDBa3D005bfC882d75358ACBbB85842' }] });
    expect(() => loadDeployment(dir, 11155420, 'cryoshield.app')).toThrow(/Coinbase/);
  });

  it('fails when the entry’s rpIdHash is not sha256(VITE_RP_ID)', () => {
    const dir = contracts({ patchWallet: (w) => (w.rpIdHash = rpIdHash('evil.example')) });
    expect(() => loadDeployment(dir, 11155420, 'cryoshield.app')).toThrow(/rpIdHash/);
  });

  it('fails on wallet or factory ABI drift, and when the factory ABI lacks a fragment the app uses', () => {
    expect(() => loadDeployment(contracts({ patchWallet: (w) => (w.abiHash = '0x' + 'ab'.repeat(32)) }), 11155420, 'cryoshield.app')).toThrow(/CryoShieldSmartWallet\.json/);
    expect(() => loadDeployment(contracts({ patchWallet: (w) => (w.factoryAbiHash = '0x' + 'ab'.repeat(32)) }), 11155420, 'cryoshield.app')).toThrow(/CryoShieldSmartWalletFactory\.json/);
    const noGetAddress = walletFactoryAbi.filter((i) => i.name !== 'getAddress');
    expect(() => loadDeployment(contracts({ abis: { factory: json(noGetAddress) } }), 11155420, 'cryoshield.app')).toThrow(/getAddress/);
  });
});

describe('assertAbiCovers', () => {
  it('matches on name, parameter types, outputs, mutability and indexed flags', () => {
    expect(() => assertAbiCovers(registryV2Abi, registryV2Abi as Abi, 'x')).not.toThrow();
    const asView = registryV2Abi.map((i) => (i.type === 'function' && i.name === 'vaultIdFor' ? { ...i, stateMutability: 'view' } : i));
    expect(() => assertAbiCovers(registryV2Abi, asView as Abi, 'x')).toThrow(/vaultIdFor/);
    const unindexed = registryV2Abi.map((i) => (i.type === 'event' ? { ...i, inputs: i.inputs.map((p) => ({ ...p, indexed: false })) } : i));
    expect(() => assertAbiCovers(registryV2Abi, unindexed as Abi, 'x')).toThrow(/LocatorAdded/);
  });
});
