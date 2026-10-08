/**
 * Build-time configuration schema (design D9). Pure: used by the Vite plugin at build time and by unit tests.
 * Every endpoint is a third-party or public service; none is operated by CryoShield.
 */

export const REQUIRED_ENV = [
  'VITE_CHAIN_ID',
  'VITE_RPC_URL',
  'VITE_BUNDLER_URL',
  'VITE_SPONSORSHIP_POLICY_ID',
  'VITE_TURBO_UPLOAD_URL',
  'VITE_ARWEAVE_GATEWAY_URL',
  'VITE_RP_ID',
  'VITE_RP_NAME',
] as const;

export type EnvName = (typeof REQUIRED_ENV)[number] | 'VITE_ARWEAVE_FAST_INDEX_URL';

/** Turbo's fast-finality index (fix-arweave-mirror-status D4); optional, https only. */
export const DEFAULT_ARWEAVE_FAST_INDEX_URL = 'https://turbo-gateway.com';

export interface AppEnvConfig {
  chainId: number;
  rpcUrl: string;
  bundlerUrl: string;
  sponsorshipPolicyId: string;
  turboUploadUrl: string;
  arweaveGatewayUrl: string;
  rpId: string;
  rpName: string;
  /** Turbo's fast-finality Arweave index, for looking up and linking the mirror copy. */
  arweaveFastIndexUrl: string;
  /** Distinct origins every page's CSP lists in connect-src (landing included). */
  connectOrigins: string[];
  /** Origins only the app's CSP adds (never the landing document, which runs third-party analytics). */
  appOnlyOrigins: string[];
}

/** One VaultRegistry deployment (web-registry-versions D1); `abi` is its interface: 1 = VaultRegistry, 2 = VaultRegistryV2. */
export interface RegistryConfig {
  version: `v${number}`;
  abi: 1 | 2;
  address: `0x${string}`;
  deployBlock: number;
}

export class ConfigError extends Error {
  override name = 'ConfigError';
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

function endpoint(env: Record<string, string | undefined>, name: EnvName): string {
  const raw = env[name];
  let url: URL;
  try {
    url = new URL(raw ?? '');
  } catch {
    throw new ConfigError(`${name} must be an absolute URL`);
  }
  const loopback = LOOPBACK.has(url.hostname);
  if (url.protocol !== 'https:' && !(loopback && url.protocol === 'http:')) {
    throw new ConfigError(`${name} must use https (http is allowed only for localhost)`);
  }
  if (url.username || url.password) throw new ConfigError(`${name} must not contain credentials`);
  return raw!.replace(/\/+$/, '');
}

const RP_ID_RE = /^(?=.{1,64}$)([a-z0-9]([a-z0-9-]*[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;

export function parseEnv(env: Record<string, string | undefined>): AppEnvConfig {
  const missing = REQUIRED_ENV.filter((n) => !env[n] || env[n]!.trim() === '');
  if (missing.length > 0) {
    throw new ConfigError(`Missing required build variable(s): ${missing.join(', ')} (see apps/web/.env.example)`);
  }
  const chainIdRaw = env.VITE_CHAIN_ID!;
  if (!/^[1-9][0-9]{0,15}$/.test(chainIdRaw)) throw new ConfigError('VITE_CHAIN_ID must be a positive integer');
  const rpId = env.VITE_RP_ID!.trim();
  if (!RP_ID_RE.test(rpId)) throw new ConfigError('VITE_RP_ID must be a bare lowercase host name (no scheme, port or path)');
  const policy = env.VITE_SPONSORSHIP_POLICY_ID!.trim();
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(policy)) throw new ConfigError('VITE_SPONSORSHIP_POLICY_ID has invalid characters');

  const rpcUrl = endpoint(env, 'VITE_RPC_URL');
  const bundlerUrl = endpoint(env, 'VITE_BUNDLER_URL');
  const turboUploadUrl = endpoint(env, 'VITE_TURBO_UPLOAD_URL');
  const arweaveGatewayUrl = endpoint(env, 'VITE_ARWEAVE_GATEWAY_URL');
  const connectOrigins = [...new Set([rpcUrl, bundlerUrl, turboUploadUrl, arweaveGatewayUrl].map((u) => new URL(u).origin))];
  const arweaveFastIndexUrl = env.VITE_ARWEAVE_FAST_INDEX_URL?.trim()
    ? endpoint(env, 'VITE_ARWEAVE_FAST_INDEX_URL')
    : DEFAULT_ARWEAVE_FAST_INDEX_URL;
  const appOnlyOrigins = [new URL(arweaveFastIndexUrl).origin].filter((o) => !connectOrigins.includes(o));

  return {
    chainId: Number(chainIdRaw),
    rpcUrl,
    bundlerUrl,
    sponsorshipPolicyId: policy,
    turboUploadUrl,
    arweaveGatewayUrl,
    arweaveFastIndexUrl,
    rpId,
    rpName: env.VITE_RP_NAME!.trim().slice(0, 64),
    connectOrigins,
    appOnlyOrigins,
  };
}
