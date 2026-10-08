/**
 * launch-op-mainnet (design D6, Communications; founder decisions Q4 and Q5): the dated notices around the switch of
 * cryoshield.app from OP Sepolia to OP Mainnet. Pure: used by the app at run time and by the landing page at build time.
 *
 * The dates are set by an agent PR once the founder fixes the switch day (design → Launch-day runbook). Until then
 * both are null: the "moving" notice stays off, and a chain-10 build shows the testnet-vaults help (fail safe).
 */
import { networkFor } from './networks';

export interface LaunchDates {
  /** First UTC day the testnet build says "CryoShield is moving to OP Mainnet". */
  moveNoticeFrom: string | null;
  /** UTC day production switches to OP Mainnet (runbook step 8): ends the "moving" notice, starts the 90-day help. */
  switchDate: string | null;
}

export const LAUNCH: LaunchDates = { moveNoticeFrom: null, switchDate: null };

/** The production RP ID. The dev site (cryoshield-web-dev.fly.dev) and local builds never show launch notices. */
export const PRODUCTION_RP_ID = 'cryoshield.app';
export const TESTNET_VAULTS_NOTICE_DAYS = 90;
const OP_MAINNET = 10;
const DAY_MS = 86_400_000;

/** "YYYY-MM-DD" -> that day's 00:00 UTC in ms; anything else throws. */
export function parseLaunchDate(d: string): number {
  const ms = /^\d{4}-\d{2}-\d{2}$/.test(d) ? Date.parse(`${d}T00:00:00Z`) : NaN;
  if (Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 10) !== d) throw new Error(`launch date must be a real YYYY-MM-DD day, got "${d}"`);
  return ms;
}

/** 4.6: the testnet build's "moving to OP Mainnet" notice, on the production site only, from the start to the switch. */
export function moveNoticeActive(o: { now: number; chainId: number; rpId: string; dates?: LaunchDates }): boolean {
  const { moveNoticeFrom, switchDate } = o.dates ?? LAUNCH;
  if (networkFor(o.chainId).status !== 'testnet' || o.rpId !== PRODUCTION_RP_ID || moveNoticeFrom === null) return false;
  if (o.now < parseLaunchDate(moveNoticeFrom)) return false;
  return switchDate === null || o.now < parseLaunchDate(switchDate);
}

/** 4.5 (Q4): on OP Mainnet, the no-vault state explains where testnet-preview vaults are, for 90 days after the switch. */
export function testnetVaultsNoticeActive(o: { now: number; chainId: number; dates?: LaunchDates }): boolean {
  if (o.chainId !== OP_MAINNET) return false;
  const { switchDate } = o.dates ?? LAUNCH;
  return switchDate === null || o.now < parseLaunchDate(switchDate) + TESTNET_VAULTS_NOTICE_DAYS * DAY_MS;
}

/** The app's view: evaluated at the current time (callers keep the result for the session, so rendering stays pure). */
export const moveNoticeNow = (chainId: number, rpId: string): boolean => moveNoticeActive({ now: Date.now(), chainId, rpId });
export const testnetVaultsNoticeNow = (chainId: number): boolean => testnetVaultsNoticeActive({ now: Date.now(), chainId });
