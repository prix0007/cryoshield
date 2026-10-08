/**
 * The honesty denylist (spec landing-page "Honest landing content"), shared by every test of public copy.
 *
 * launch-op-mainnet D6: "mainnet" depends on the build's chain. On a testnet build it never appears. On a mainnet build
 * it may appear only as the network's name, "OP Mainnet"; an affirmative readiness claim ("mainnet-ready",
 * "production-ready", "battle-tested") stays banned on every chain.
 */
import { networkFor } from '../../src/config/networks';

const ALWAYS: readonly RegExp[] = [
  /\bis audited\b/i,
  /\baudited by\b/i,
  /\bfully audited\b/i,
  /\b(mainnet|production)[- ]ready\b/i,
  /battle[- ]tested/i,
  /military[- ]grade/i,
  /bank[- ]grade/i,
  /unhackable/i,
  /100% (secure|safe)/i,
  /quantum[- ](proof|safe|resistant)/i,
  /\bL1 (hash )?anchor/i,
  /\bguarantee/i,
  /\bIPFS\b|\bENS\b/,
  /recover(y)? (after|without) (losing )?(all|every) keys?/i,
  /guaranteed/i,
  /\bforever\b/i,
  /unbreakable/i,
  /never lose/i,
  /risk[- ]free/i,
  /\binsured\b/i,
  /(stays|always|will (always )?be) available/i,
];

/** "mainnet" anywhere (testnet builds), or "mainnet" not preceded by "OP " (mainnet builds). */
const ANY_MAINNET = /\bmainnet\b/i;
const MAINNET_NOT_AS_NAME = /(?<!\bOP )\bmainnet\b/i;

export function bannedFor(chainId: number): readonly RegExp[] {
  return [...ALWAYS, networkFor(chainId).status === 'mainnet' ? MAINNET_NOT_AS_NAME : ANY_MAINNET];
}

/** The testnet list (the live production chain until the switch). */
export const BANNED: readonly RegExp[] = bannedFor(11155420);
