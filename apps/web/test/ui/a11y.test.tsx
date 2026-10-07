import axe from 'axe-core';
import { describe, expect, it } from 'vitest';
import { renderApp } from './helpers';

describe('home screen accessibility (unit-level; full audit in e2e/specs/30-a11y.spec.ts)', () => {
  it('has no axe violations', async () => {
    const { container } = renderApp();
    const r = await axe.run(container, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'], rules: { 'color-contrast': { enabled: false } } });
    expect(r.violations.map((v) => v.id)).toEqual([]);
  });
});

describe('vault list and Edit vault sheet accessibility (vault-list-labels-archive 3.5, unit level)', () => {
  const run = async (el: Element) =>
    (await axe.run(el, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'], rules: { 'color-contrast': { enabled: false } } })).violations.map((v) => v.id);

  it('has no axe violations in picker mode, menu mode and the sheet with Archive and clear open', async () => {
    const { screen } = await import('@testing-library/react');
    const userEvent = (await import('@testing-library/user-event')).default;
    const { vi } = await import('vitest');
    const ops = await import('../../src/ui/operations');
    const unlockMod = await import('../../src/chain/unlock');
    vi.spyOn(ops, 'ensureMirror').mockResolvedValue({ status: 'saved' });
    vi.spyOn(await import('@cryoshield/vault-crypto'), 'decodeVault').mockReturnValue({ entries: [{ credId: new Uint8Array(48).fill(1) }, { credId: new Uint8Array(48).fill(2) }] } as never);
    const v = (n: number, over = {}) => ({
      vaultId: ('0x' + String(n).repeat(64)) as `0x${string}`,
      owner: ('0x' + '34'.repeat(20)) as `0x${string}`,
      version: 1,
      blob: new Uint8Array(400),
      items: [{ label: `Label ${n}`, secret: 's' }],
      archived: false,
      entryIndex: 0,
      registry: 'v2' as const,
      ...over,
    });
    vi.spyOn(unlockMod, 'unlock').mockResolvedValue({ credId: new Uint8Array(48), locator: new Uint8Array(32), matches: [v(1, { name: 'Work' }), v(2), v(3, { archived: true }), v(4, { registry: 'v1' })] });
    const u = userEvent.setup();
    const { container } = renderApp();
    await u.click(screen.getByRole('button', { name: 'Unlock my vault' }));
    await u.click(screen.getByRole('button', { name: 'Unlock with my key' }));
    await screen.findByRole('heading', { name: 'Your vaults' });
    await u.click(screen.getByRole('button', { name: 'Show archived (1)' }));
    expect(await run(container)).toEqual([]);
    await u.click(screen.getByRole('button', { name: 'Open Work' }));
    await u.click(await screen.findByRole('button', { name: 'All vaults (4)' }));
    await screen.findByRole('region', { name: 'Older test vaults' });
    expect(await run(container)).toEqual([]);
    await u.click(screen.getByRole('button', { name: 'Edit vault Work' }));
    await u.click(await screen.findByRole('button', { name: 'Archive and clear…' }));
    expect(await run(container)).toEqual([]);
    vi.restoreAllMocks();
  });
});
