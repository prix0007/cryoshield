/**
 * launch-op-mainnet 4.5 / 4.6 (design D6, Communications; founder Q4): the dated notices around the switch to OP Mainnet.
 *  - testnet build: "CryoShield is moving to OP Mainnet", only between the configured start and the switch date, and
 *    never on the dev site (its RP ID is not the production one);
 *  - OP Mainnet build: the "where did my testnet vault go" help in the no-vault state, for 90 days after the switch.
 */
import { describe, expect, it } from 'vitest';
import { LAUNCH, PRODUCTION_RP_ID, TESTNET_VAULTS_NOTICE_DAYS, moveNoticeActive, parseLaunchDate, testnetVaultsNoticeActive } from '../../src/config/launch';

const at = (iso: string) => Date.parse(iso);
const DATES = { moveNoticeFrom: '2026-10-12', switchDate: '2026-10-19' };
const DAY = 86_400_000;

describe('launch dates', () => {
  it('the committed dates are unset or real UTC dates, and the window is 90 days', () => {
    for (const d of [LAUNCH.moveNoticeFrom, LAUNCH.switchDate]) if (d !== null) expect(Number.isNaN(parseLaunchDate(d))).toBe(false);
    if (LAUNCH.moveNoticeFrom && LAUNCH.switchDate) expect(parseLaunchDate(LAUNCH.moveNoticeFrom)).toBeLessThan(parseLaunchDate(LAUNCH.switchDate));
    expect(TESTNET_VAULTS_NOTICE_DAYS).toBe(90);
    expect(PRODUCTION_RP_ID).toBe('cryoshield.app');
  });

  it('refuses a malformed or impossible date', () => {
    for (const bad of ['2026-02-30', '2026-10-9', '10/19/2026', '', '2026-10-19T00:00:00Z']) expect(() => parseLaunchDate(bad), bad).toThrow(/YYYY-MM-DD/);
    expect(parseLaunchDate('2026-10-19')).toBe(at('2026-10-19T00:00:00Z'));
  });
});

describe('"moving to OP Mainnet" notice (4.6)', () => {
  const on = (now: number, over: Partial<Parameters<typeof moveNoticeActive>[0]> = {}) =>
    moveNoticeActive({ now, chainId: 11155420, rpId: PRODUCTION_RP_ID, dates: DATES, ...over });

  it('shows on the production testnet build only between the start and the switch date', () => {
    expect(on(at('2026-10-11T23:59:59Z'))).toBe(false);
    expect(on(at('2026-10-12T00:00:00Z'))).toBe(true);
    expect(on(at('2026-10-18T23:59:59Z'))).toBe(true);
    expect(on(at('2026-10-19T00:00:00Z'))).toBe(false);
  });

  it('never shows on the dev site, on a local build, or on a mainnet build', () => {
    const mid = at('2026-10-15T12:00:00Z');
    expect(on(mid, { rpId: 'cryoshield-web-dev.fly.dev' })).toBe(false);
    expect(on(mid, { rpId: 'localhost' })).toBe(false);
    expect(on(mid, { chainId: 10 })).toBe(false);
  });

  it('stays off until a start date is configured; with no switch date it runs from the start', () => {
    const mid = at('2026-10-15T12:00:00Z');
    expect(on(mid, { dates: { moveNoticeFrom: null, switchDate: '2026-10-19' } })).toBe(false);
    expect(on(mid, { dates: { moveNoticeFrom: null, switchDate: null } })).toBe(false);
    expect(on(mid, { dates: { moveNoticeFrom: '2026-10-12', switchDate: null } })).toBe(true);
  });
});

describe('testnet-vaults help on OP Mainnet (4.5, Q4)', () => {
  const on = (now: number, over: Partial<Parameters<typeof testnetVaultsNoticeActive>[0]> = {}) =>
    testnetVaultsNoticeActive({ now, chainId: 10, dates: DATES, ...over });
  const sw = at('2026-10-19T00:00:00Z');

  it('shows on chain 10 for 90 days after the switch date', () => {
    expect(on(sw)).toBe(true);
    expect(on(sw + 90 * DAY - 1)).toBe(true);
    expect(on(sw + 90 * DAY)).toBe(false);
  });

  it('shows on chain 10 when the switch date is not recorded yet (fail safe), never on a testnet', () => {
    expect(on(sw + 400 * DAY, { dates: { moveNoticeFrom: null, switchDate: null } })).toBe(true);
    expect(on(sw, { chainId: 11155420 })).toBe(false);
    expect(on(sw, { chainId: 31337 })).toBe(false);
    expect(on(sw, { chainId: 42161 })).toBe(false); // the testnet preview was on OP Sepolia; only OP Mainnet replaces it
  });
});
