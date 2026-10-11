/** add-compromised-key-guide D5: the vault view links the lost-or-compromised-key guide under "Manage vault". */
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as ops from '../../src/ui/operations';
import { ServicesProvider } from '../../src/ui/services';
import { S } from '../../src/ui/strings';
import { VaultView } from '../../src/ui/VaultView';
import { fakeServices } from './helpers';

const session = (over: Partial<ops.VaultSession> = {}): ops.VaultSession => ({
  vaultId: ('0x' + '12'.repeat(32)) as `0x${string}`,
  owner: ('0x' + '34'.repeat(20)) as `0x${string}`,
  version: 1,
  blob: new Uint8Array(4),
  items: [{ label: 'Bitcoin seed', secret: 'abandon art' }],
  archived: false,
  credIds: [new Uint8Array(48).fill(1), new Uint8Array(48).fill(2)],
  registry: 'v2',
  ...over,
});

const show = (over: Partial<ops.VaultSession> = {}) =>
  render(
    <ServicesProvider value={fakeServices()}>
      <VaultView session={session(over)} locator="0x" onChange={() => {}} onLock={() => {}} />
    </ServicesProvider>,
  );

beforeEach(() => {
  vi.spyOn(ops, 'ensureMirror').mockResolvedValue({ status: 'saved' });
});
afterEach(() => vi.restoreAllMocks());

describe('lost-key guide link in the vault view', () => {
  it('uses the agreed text', () => {
    expect(S.vault.lostKey).toBe('Lost a key, or think someone has it?');
  });

  it('is a same-origin link to /lost-key right after the Manage vault list', () => {
    show();
    const link = screen.getByRole('link', { name: S.vault.lostKey });
    expect(link).toHaveAttribute('href', '/lost-key');
    expect(link).not.toHaveAttribute('target');
    const list = screen.getByRole('list', { name: S.vault.manage });
    expect(list.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('is shown for a read-only vault too', () => {
    show({ registry: 'v1' });
    expect(screen.getByRole('link', { name: S.vault.lostKey })).toHaveAttribute('href', '/lost-key');
  });
});
