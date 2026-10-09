/**
 * The honesty denylist (spec landing-page "Honest landing content"), shared by every test of public copy.
 *
 * launch-op-mainnet D6: "mainnet" depends on the build's chain. On a testnet build it never appears. On a mainnet build
 * it may appear only as the network's name, "OP Mainnet"; an affirmative readiness claim ("mainnet-ready",
 * "production-ready", "battle-tested") stays banned on every chain.
 */
const OP_MAINNET = 10;

/**
 * launch-op-mainnet pre-launch review H2 (founder: no audit is planned): nothing on the site may promise or fund-raise for
 * an audit. Applied to every public page (test/build/public-pages-honesty.test.ts), not only the landing page.
 */
export const AUDIT_PROMISES: readonly RegExp[] = [
  /\b(fund|funds|funding|toward|towards|for)\s+(an?\s+)?(future\s+)?(independent\s+)?(external\s+)?(security\s+)?audit\b/i,
  /\b(an?|future)\s+(future\s+)?(independent\s+)?(external\s+)?(security\s+)?audit\b/i,
  /\baudit\s+(is\s+)?(coming|planned|scheduled|underway)\b/i,
  /\b(will|to) be (independently )?audited\b/i,
  /\baudited yet\b/i,
];

const ALWAYS: readonly RegExp[] = [
  ...AUDIT_PROMISES,
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

/** Review L6: the "OP Mainnet" exception is for chain 10 only; every other chain (Arbitrum One included) bans "mainnet". */
export function bannedFor(chainId: number): readonly RegExp[] {
  return [...ALWAYS, chainId === OP_MAINNET ? MAINNET_NOT_AS_NAME : ANY_MAINNET];
}

/** The testnet list (the live production chain until the switch). */
export const BANNED: readonly RegExp[] = bannedFor(11155420);
