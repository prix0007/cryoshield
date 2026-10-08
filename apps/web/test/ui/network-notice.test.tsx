/**
 * launch-op-mainnet 4.5 / 4.6 (spec vault-web-app "Network status notice in the app"; design D6, Communications, Q4):
 *  - every network shows a status notice: the testnet banner on a test network (and on an unknown chain: fail safe),
 *    an "unaudited" notice on OP Mainnet, with the matching sub-nav chip;
 *  - on OP Mainnet, for 90 days after the switch, the no-vault state explains where testnet-preview vaults are;
 *  - the testnet build shows the dated "moving to OP Mainnet" notice only in its window, and never on the dev site.
 */
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as unlockMod from '../../src/chain/unlock';
import { LAUNCH } from '../../src/config/launch';
import { renderApp } from './helpers';

const saved = { ...LAUNCH };
beforeEach(() => vi.restoreAllMocks());
afterEach(() => {
  Object.assign(LAUNCH, saved);
  vi.useRealTimers();
});

const note = () => screen.getByRole('note');
const chip = () => document.querySelector('.sub-nav .chip');
const PROD = { rpId: 'cryoshield.app', host: 'cryoshield.app' };

describe('network status notice (4.5)', () => {
  it('OP Mainnet: an unaudited notice with the all-keys-lost rule, the "Unaudited" chip, and no testnet wording', () => {
    renderApp({ chainId: 10, network: { name: 'OP Mainnet', explorerUrl: 'https://explorer.optimism.io' } });
    expect(note()).toHaveTextContent(
      'CryoShield runs on OP Mainnet and has not been independently audited. Your vault is encrypted on your device and stored permanently, and only your keys can open it: if you lose every key, nobody, including CryoShield, can open it. Please keep your existing backups too.',
    );
    expect(chip()).toHaveTextContent(/^Unaudited$/);
    expect(screen.queryByText('Testnet')).toBeNull();
    expect(document.body.textContent).not.toMatch(/testnet|test network|OP Sepolia/i);
  });

  it('OP Sepolia: the existing testnet banner and the "Testnet" chip', () => {
    renderApp({ chainId: 11155420 });
    expect(note()).toHaveTextContent(/stored on OP Sepolia, a test network.*Test networks can be reset.*has not been independently audited/);
    expect(chip()).toHaveTextContent(/^Testnet$/);
  });

  it('an unknown chain fails safe: the testnet and unaudited banner', () => {
    renderApp({ chainId: 999 });
    expect(note()).toHaveTextContent(/stored on chain 999, a test network.*has not been independently audited/);
    expect(chip()).toHaveTextContent(/^Testnet$/);
  });
});

describe('testnet-preview vaults on OP Mainnet (4.5, Q4)', () => {
  async function noVault(chainId: number) {
    const u = userEvent.setup();
    vi.spyOn(unlockMod, 'unlock').mockRejectedValue(new unlockMod.UnlockError('NO_VAULT'));
    renderApp({ chainId });
    await u.click(screen.getByRole('button', { name: 'Unlock my vault' }));
    await u.click(screen.getByRole('button', { name: 'Unlock with my key' }));
    await screen.findByText('We couldn’t find a vault for this key.');
  }

  it('within 90 days of the switch, the no-vault state names the testnet preview, --testnet and creating a new vault', async () => {
    LAUNCH.switchDate = new Date(Date.now() - 10 * 86_400_000).toISOString().slice(0, 10);
    await noVault(10);
    const help = screen.getByText(/Vaults created during the testnet preview are not on OP Mainnet\./);
    expect(help).toHaveTextContent(
      'Vaults created during the testnet preview are not on OP Mainnet. They are still there, and you can read yours with the open-source recovery tool and its --testnet option. To use CryoShield on OP Mainnet, create a new vault.',
    );
    const link = screen.getByRole('link', { name: 'How to use the recovery tool' });
    expect(link).toHaveAttribute('href', 'https://github.com/prix0007/cryoshield/tree/main/tools/recover#readme');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByRole('button', { name: 'Create a vault' })).toBeInTheDocument();
  });

  it('shows while the switch date is not recorded (fail safe), and not after 90 days', async () => {
    LAUNCH.switchDate = null;
    await noVault(10);
    expect(screen.getByText(/testnet preview are not on OP Mainnet/)).toBeInTheDocument();
  });

  it('is gone 90 days after the switch', async () => {
    LAUNCH.switchDate = new Date(Date.now() - 91 * 86_400_000).toISOString().slice(0, 10);
    await noVault(10);
    expect(screen.queryByText(/testnet preview are not on OP Mainnet/)).toBeNull();
  });

  it('never shows on a testnet', async () => {
    await noVault(11155420);
    expect(screen.queryByText(/testnet preview are not on OP Mainnet/)).toBeNull();
  });
});

describe('"moving to OP Mainnet" notice (4.6)', () => {
  const MOVING = 'CryoShield is moving to OP Mainnet. Vaults created during the testnet preview will not move; you can still read them with the recovery tool. Create a new vault after the switch.';
  const window = () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-15T12:00:00Z'));
    LAUNCH.moveNoticeFrom = '2026-10-12';
    LAUNCH.switchDate = '2026-10-19';
  };

  it('shows on the production testnet build between the start and the switch date', () => {
    window();
    renderApp({ chainId: 11155420, ...PROD });
    expect(screen.getByText(MOVING)).toBeInTheDocument();
  });

  it('is hidden before the start and from the switch date on', () => {
    window();
    vi.setSystemTime(new Date('2026-10-11T23:00:00Z'));
    const a = renderApp({ chainId: 11155420, ...PROD });
    expect(screen.queryByText(MOVING)).toBeNull();
    a.unmount();
    vi.setSystemTime(new Date('2026-10-19T00:00:00Z'));
    renderApp({ chainId: 11155420, ...PROD });
    expect(screen.queryByText(MOVING)).toBeNull();
  });

  it('never shows on the dev site or on OP Mainnet', () => {
    window();
    const a = renderApp({ chainId: 11155420, rpId: 'cryoshield-web-dev.fly.dev', host: 'cryoshield-web-dev.fly.dev' });
    expect(screen.queryByText(MOVING)).toBeNull();
    a.unmount();
    renderApp({ chainId: 10, ...PROD });
    expect(screen.queryByText(MOVING)).toBeNull();
  });
});
