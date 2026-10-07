import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { S } from '../../src/ui/strings';
import { LOCATION } from '../../src/ui/strings-location';
import { VAULTS } from '../../src/ui/strings-vaults';
import { renderApp } from './helpers';

describe('jargon (8.7)', () => {
  it('no default-flow string uses wallet / gas / transaction / smart account / bundler / paymaster / ETH', () => {
    const all: string[] = [];
    const walk = (v: unknown): void => {
      if (typeof v === 'string') all.push(v);
      else if (typeof v === 'function') {
        for (const arg of [1, 2, 8, 'Label']) {
          try {
            all.push(String((v as (...a: unknown[]) => unknown)(arg, 3)));
          } catch {
            /* ignore */
          }
        }
      } else if (v && typeof v === 'object') Object.values(v).forEach(walk);
    };
    walk(S);
    walk(LOCATION); // show-vault-onchain-location: the lazily loaded panel's strings
    walk(VAULTS); // vault-list-labels-archive: the lazily loaded vault list and Edit vault sheet
    const banned = /\b(gas|wallet|transactions?|smart account|bundler|paymaster|ETH)\b/i;
    expect(all.filter((t) => banned.test(t))).toEqual([]);
  });
});

describe('RP ID guard (3.4)', () => {
  it('disables key actions with a plain message on a host that does not match the RP ID', () => {
    const create = vi.fn();
    const get = vi.fn();
    renderApp({ host: 'ipfs.io', rpId: 'cryoshield.app', credentials: { create, get } });
    expect(screen.getByRole('alert')).toHaveTextContent('This site is set up incorrectly');
    expect(screen.getByRole('button', { name: 'Unlock my vault' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Create a new vault' })).toBeDisabled();
    expect(create).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
  });

  it('shows the browser message when PRF is unsupported', async () => {
    (globalThis as { PublicKeyCredential?: unknown }).PublicKeyCredential = { getClientCapabilities: async () => ({ 'extension:prf': false }) };
    renderApp();
    expect(await screen.findByText(/This browser can’t use security keys for encryption/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create a new vault' })).toBeDisabled();
    (globalThis as { PublicKeyCredential?: unknown }).PublicKeyCredential = { getClientCapabilities: async () => ({ 'extension:prf': true }) };
  });
});
