/** fix-arweave-mirror-status 1.2: retry with known locators, Details reference, item link after upload. */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MirrorError } from '../../src/mirror/mirror';
import * as ops from '../../src/ui/operations';
import { MirrorLine } from '../../src/ui/CreateFlow';
import { acknowledge, fakeServices, renderApp } from './helpers';

const vaultId = ('0x' + '12'.repeat(32)) as `0x${string}`;
const LOC = ('0x' + 'ab'.repeat(32)) as `0x${string}`;
const ITEM = 'B'.repeat(43);

beforeEach(() => vi.restoreAllMocks());

describe('mirrorWrite', () => {
  it('still uploads with the known locators when eth_getLogs fails (public-RPC range limits)', async () => {
    const upload = vi.fn(async () => ITEM);
    const svc = fakeServices({
      reader: { locatorsOf: async () => { throw new Error('range too large'); } } as never,
      mirror: { upload, ensure: vi.fn(), lookup: vi.fn() } as never,
    });
    const r = await ops.mirrorWrite(svc, { vaultId, version: 1, blob: new Uint8Array(10), locators: [LOC] });
    expect(r).toEqual({ status: 'saved', itemId: ITEM });
    expect(upload).toHaveBeenCalledWith(expect.objectContaining({ locators: [LOC] }));
  });

  it('reports a sanitized reference: UPLOAD_FAILED, HTTP status and step; NO_LOCATORS when none are known', async () => {
    const svc = fakeServices({
      reader: { locatorsOf: async () => [LOC] } as never,
      mirror: { upload: async () => { throw new MirrorError('UPLOAD_FAILED', 402); } } as never,
    });
    expect(await ops.mirrorWrite(svc, { vaultId, version: 1, blob: new Uint8Array(10) })).toEqual({ status: 'failed', ref: 'UPLOAD_FAILED · HTTP 402 · upload' });
    const none = fakeServices({ reader: { locatorsOf: async () => { throw new Error('x'); } } as never });
    expect(await ops.mirrorWrite(none, { vaultId, version: 1, blob: new Uint8Array(10) })).toEqual({ status: 'failed', ref: 'NO_LOCATORS · lookup' });
  });
});

describe('MirrorLine', () => {
  it('failed: Retry plus a collapsed Details reference', async () => {
    render(<MirrorLine result={{ status: 'failed', ref: 'UPLOAD_FAILED · HTTP 402 · upload' }} fastIndexUrl="https://turbo-gateway.com" onRetry={() => {}} />);
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    const toggle = screen.getByRole('button', { name: 'Details' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await userEvent.setup().click(toggle);
    const panel = document.getElementById(toggle.getAttribute('aria-controls')!)!;
    expect(within(panel).getByText('UPLOAD_FAILED · HTTP 402 · upload')).toBeInTheDocument();
  });

  it('saved: the item id linked on the fast index, with the settlement note', () => {
    render(<MirrorLine result={{ status: 'saved', itemId: ITEM }} fastIndexUrl="https://turbo-gateway.com" onRetry={() => {}} />);
    expect(screen.getByText('Backup copy saved.')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: ITEM });
    expect(link).toHaveAttribute('href', `https://turbo-gateway.com/${ITEM}`);
    expect(link.getAttribute('rel')).toContain('noopener');
    expect(screen.getByText(/arweave\.net link works once it settles/)).toBeInTheDocument();
  });
});

describe('create flow Retry (regression for bug 2)', () => {
  it('passes the locators known from creation on Retry', async () => {
    const u = userEvent.setup();
    vi.spyOn(await import('@cryoshield/vault-crypto'), 'decodeVault').mockReturnValue({ entries: [] } as never);
    vi.spyOn(ops, 'enrollWithPrf').mockImplementation(async (_s, n) => ({ credId: new Uint8Array(48).fill(n), publicKey: ('0x' + 'aa'.repeat(64)) as `0x${string}`, prf: new Uint8Array(32).fill(n) }));
    vi.spyOn(ops, 'saveNewVault').mockResolvedValue({ session: { vaultId, owner: ('0x' + '34'.repeat(20)) as `0x${string}`, version: 1, blob: new Uint8Array(10), items: [], archived: false, credIds: [], registry: 'v2' as const }, locators: [LOC] });
    const write = vi.spyOn(ops, 'mirrorWrite').mockResolvedValue({ status: 'failed', ref: 'UPLOAD_FAILED · HTTP 503 · upload' });
    renderApp();
    await u.click(screen.getByRole('button', { name: 'Create a new vault' }));
    await u.click(screen.getByRole('button', { name: 'Get started' }));
    await u.click(screen.getByRole('button', { name: 'Set up key 1' }));
    await screen.findByText('Key 1 is ready.');
    await u.click(screen.getByRole('button', { name: 'Set up key 2' }));
    await screen.findByText('Key 2 is ready.');
    await u.click(screen.getByRole('button', { name: 'Continue' }));
    await u.type(screen.getByLabelText('Secret'), 'x');
    await acknowledge(u);
    await u.click(screen.getByRole('button', { name: 'Save' }));
    await u.click(await screen.findByRole('button', { name: 'Retry' }));
    expect(write).toHaveBeenCalledTimes(2);
    expect(write.mock.calls[1]![1]).toMatchObject({ vaultId, locators: [LOC] });
  });
});
