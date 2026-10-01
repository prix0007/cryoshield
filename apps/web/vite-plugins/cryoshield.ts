/**
 * Build-time wiring: validates VITE_* env (fails the build on any problem), loads the registry deployment record,
 * exposes both through `virtual:cryoshield-config`, and injects the CSP.
 */
import { join } from 'node:path';
import type { Plugin } from 'vite';
import { parseEnv } from '../src/config/schema.ts';
import { loadDeployment } from './deployment.ts';
import { headersFile, injectCsp } from './csp.ts';

const VIRTUAL_ID = 'virtual:cryoshield-config';
const RESOLVED_ID = '\0' + VIRTUAL_ID;

export function cryoshield(env: Record<string, string | undefined>, contractsDir: string): Plugin {
  const config = parseEnv(env);
  const deployment = loadDeployment(contractsDir, config.chainId);
  return {
    name: 'cryoshield-config',
    resolveId(id) {
      return id === VIRTUAL_ID ? RESOLVED_ID : null;
    },
    load(id) {
      if (id !== RESOLVED_ID) return null;
      const runtime = {
        ...config,
        registry: { address: deployment.address, deployBlock: deployment.deployBlock, abiHash: deployment.abiHash },
      };
      return [
        `export const config = Object.freeze(${JSON.stringify(runtime)});`,
        `export const registryAbi = ${JSON.stringify(deployment.abi)};`,
      ].join('\n');
    },
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        // The dev server needs inline HMR scripts; the CSP applies to built output only.
        if (ctx.server) return html;
        return injectCsp(html, config.connectOrigins);
      },
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: '_headers', source: headersFile(config.connectOrigins) });
    },
  };
}

export const defaultContractsDir = (root: string) => join(root, '..', '..', 'contracts');
