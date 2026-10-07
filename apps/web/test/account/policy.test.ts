import { describe, expect, it } from 'vitest';
import { encodeFunctionData, type Hex } from 'viem';
import { config } from 'virtual:cryoshield-config';
import registryV1Abi from '../../../../contracts/abi/VaultRegistry.json';
import { registryV2Abi } from '../../src/chain/contracts';
import { assertSponsorableCalls, assertSponsorableCallData, smartWalletAbi, PolicyError } from '../../src/account/policy';

const account = '0x00000000000000000000000000000000000000aa' as Hex;
const reg = config.registries[0].address;
const registryAbi = registryV2Abi;
const vaultId = ('0x' + '01'.repeat(32)) as Hex;
const create = { to: reg, value: 0n, data: encodeFunctionData({ abi: registryAbi as any, functionName: 'createVault', args: [vaultId, '0x01', [vaultId, vaultId]] }) };
const update = { to: reg, value: 0n, data: encodeFunctionData({ abi: registryAbi as any, functionName: 'updateVault', args: [vaultId, '0x01'] }) };
const addOwner = { to: account, value: 0n, data: encodeFunctionData({ abi: smartWalletAbi, functionName: 'addOwnerPublicKey', args: [vaultId, vaultId] }) };

describe('sponsorship allowlist (6.2)', () => {
  it('allows registry create/update/addLocators and self addOwnerPublicKey', () => {
    expect(() => assertSponsorableCalls([create], account)).not.toThrow();
    expect(() => assertSponsorableCalls([addOwner, update], account)).not.toThrow();
  });

  it.each([
    ['another target', [{ ...update, to: '0x00000000000000000000000000000000000000bb' as Hex }]],
    ['non-zero value', [{ ...update, value: 1n }]],
    ['a registry selector outside the allowlist', [{ to: reg, value: 0n, data: encodeFunctionData({ abi: registryAbi as any, functionName: 'vaultOf', args: [account] }) }]],
    ['a self-call other than addOwnerPublicKey', [{ to: account, value: 0n, data: encodeFunctionData({ abi: smartWalletAbi, functionName: 'removeOwnerAtIndex', args: [0n, '0x'] }) }]],
    ['addOwnerAddress (EOA owner)', [{ to: account, value: 0n, data: encodeFunctionData({ abi: smartWalletAbi, functionName: 'addOwnerAddress', args: [account] }) }]],
    ['an empty call list', []],
    // harden-gas-sponsorship: clients never write to VaultRegistry v1.
    ['a VaultRegistry v1 write', [{ to: config.registries.find((r: { version: string }) => r.version === 'v1')!.address, value: 0n, data: encodeFunctionData({ abi: registryV1Abi as any, functionName: 'updateVault', args: [vaultId, '0x01'] }) }]],
  ])('refuses %s', (_n, calls) => {
    expect(() => assertSponsorableCalls(calls as any, account)).toThrow(PolicyError);
  });

  it('decodes execute / executeBatch callData', () => {
    const one = encodeFunctionData({ abi: smartWalletAbi, functionName: 'execute', args: [reg, 0n, update.data] });
    expect(() => assertSponsorableCallData(one, account)).not.toThrow();
    const batch = encodeFunctionData({ abi: smartWalletAbi, functionName: 'executeBatch', args: [[{ target: account, value: 0n, data: addOwner.data }, { target: reg, value: 0n, data: update.data }]] });
    expect(() => assertSponsorableCallData(batch, account)).not.toThrow();
    const bad = encodeFunctionData({ abi: smartWalletAbi, functionName: 'execute', args: [reg, 5n, update.data] });
    expect(() => assertSponsorableCallData(bad, account)).toThrow(PolicyError);
    const upgrade = encodeFunctionData({ abi: smartWalletAbi, functionName: 'upgradeToAndCall', args: [reg, '0x'] });
    expect(() => assertSponsorableCallData(upgrade, account)).toThrow(PolicyError);
  });
});
