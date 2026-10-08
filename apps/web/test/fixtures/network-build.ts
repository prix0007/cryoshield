/**
 * launch-op-mainnet 4.2–4.7: production-mode builds of the whole site for a given chain, into a temp dir. Chain 10
 * builds read the TEST-ONLY fixture contracts directory (mainnet-contracts.mjs), never contracts/deployments/10.json.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error plain ESM helper without types
import { makeMainnetContracts } from './mainnet-contracts.mjs';

const web = join(__dirname, '..', '..');

export const RPC = { 10: 'https://mainnet.optimism.io', 11155420: 'https://sepolia.optimism.io' } as const;

export interface NetworkBuild {
  out: string;
  html: (p: string) => string;
  doc: (p: string) => Document;
  text: (p: string) => string;
  cleanup: () => void;
}

export function buildForChain(chainId: 10 | 11155420, extra: Record<string, string> = {}): NetworkBuild {
  const tmp = mkdtempSync(join(tmpdir(), `cs-chain-${chainId}-`));
  const out = join(tmp, 'dist');
  const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('VITE_') && k !== 'CRYOSHIELD_CONTRACTS_DIR'));
  const env: Record<string, string | undefined> = {
    ...clean,
    NODE_ENV: 'production',
    VITE_CHAIN_ID: String(chainId),
    VITE_RPC_URL: RPC[chainId],
    VITE_BUNDLER_URL: `https://api.pimlico.io/v2/${chainId}/rpc?apikey=pim_fixture`,
    VITE_SPONSORSHIP_POLICY_ID: 'sp_fixture',
    VITE_TURBO_UPLOAD_URL: 'https://upload.ardrive.io',
    VITE_ARWEAVE_GATEWAY_URL: 'https://arweave.net',
    VITE_RP_ID: 'cryoshield.app',
    VITE_RP_NAME: 'CryoShield',
    ...extra,
  };
  if (chainId === 10) env.CRYOSHIELD_CONTRACTS_DIR = makeMainnetContracts(join(tmp, 'contracts'), join(web, '..', '..', 'contracts'));
  execFileSync('pnpm', ['exec', 'vite', 'build', '--mode', 'network-fixture', '--outDir', out, '--emptyOutDir'], { cwd: web, stdio: 'pipe', env });
  const html = (p: string) => readFileSync(join(out, p), 'utf8');
  const doc = (p: string) => new DOMParser().parseFromString(html(p), 'text/html');
  return {
    out,
    html,
    doc,
    text: (p: string) => (doc(p).body.textContent ?? '').replace(/\s+/g, ' '),
    cleanup: () => rmSync(tmp, { recursive: true, force: true }),
  };
}
