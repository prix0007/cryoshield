import { describe, expect, it } from 'vitest';
import { parseEnv, REQUIRED_ENV } from '../../src/config/schema';

const good = {
  VITE_CHAIN_ID: '31337',
  VITE_RPC_URL: 'http://127.0.0.1:8545',
  VITE_BUNDLER_URL: 'http://127.0.0.1:4337',
  VITE_SPONSORSHIP_POLICY_ID: 'sp_e2e',
  VITE_TURBO_UPLOAD_URL: 'https://upload.ardrive.io',
  VITE_ARWEAVE_GATEWAY_URL: 'https://arweave.net',
  VITE_RP_ID: 'localhost',
  VITE_RP_NAME: 'CryoShield',
};

describe('parseEnv', () => {
  it('accepts a complete environment', () => {
    const c = parseEnv(good);
    expect(c.chainId).toBe(31337);
    expect(c.rpId).toBe('localhost');
    expect(c.bundlerUrl).toBe('http://127.0.0.1:4337');
  });

  it.each(REQUIRED_ENV)('fails naming %s when it is missing', (name) => {
    const env: Record<string, string> = { ...good };
    delete env[name];
    expect(() => parseEnv(env)).toThrow(name);
  });

  it('rejects a non-numeric chain id', () => {
    expect(() => parseEnv({ ...good, VITE_CHAIN_ID: 'arb' })).toThrow('VITE_CHAIN_ID');
  });

  it('rejects non-https endpoints except loopback', () => {
    expect(() => parseEnv({ ...good, VITE_RPC_URL: 'http://rpc.example.com' })).toThrow('VITE_RPC_URL');
    expect(parseEnv({ ...good, VITE_RPC_URL: 'https://rpc.example.com' }).rpcUrl).toBe('https://rpc.example.com');
  });

  it('rejects an RP ID with a scheme or path', () => {
    expect(() => parseEnv({ ...good, VITE_RP_ID: 'https://cryoshield.app' })).toThrow('VITE_RP_ID');
  });

  it('lists every configured origin for the CSP', () => {
    const c = parseEnv(good);
    expect(c.connectOrigins.sort()).toEqual(
      ['http://127.0.0.1:8545', 'http://127.0.0.1:4337', 'https://upload.ardrive.io', 'https://arweave.net'].sort(),
    );
  });
});

describe('VITE_ARWEAVE_FAST_INDEX_URL (fix-arweave-mirror-status 1.3)', () => {
  it('defaults to Turbo’s gateway and is an app-only origin (not in the shared connect origins)', () => {
    const c = parseEnv(good);
    expect(c.arweaveFastIndexUrl).toBe('https://turbo-gateway.com');
    expect(c.appOnlyOrigins).toEqual(['https://turbo-gateway.com']);
    expect(c.connectOrigins).not.toContain('https://turbo-gateway.com');
  });
  it('is configurable and validated like the other endpoints', () => {
    expect(parseEnv({ ...good, VITE_ARWEAVE_FAST_INDEX_URL: 'https://index.example/' }).arweaveFastIndexUrl).toBe('https://index.example');
    expect(() => parseEnv({ ...good, VITE_ARWEAVE_FAST_INDEX_URL: 'http://index.example' })).toThrow('VITE_ARWEAVE_FAST_INDEX_URL');
    expect(() => parseEnv({ ...good, VITE_ARWEAVE_FAST_INDEX_URL: 'https://u:p@index.example' })).toThrow('VITE_ARWEAVE_FAST_INDEX_URL');
  });
});
