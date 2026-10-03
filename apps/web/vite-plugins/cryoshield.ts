/**
 * Build-time wiring: validates VITE_* env (fails the build on any problem), loads the registry deployment record,
 * exposes both through `virtual:cryoshield-config`, and injects the CSP.
 */
import { join } from 'node:path';
import type { Plugin } from 'vite';
import { parseEnv } from '../src/config/schema.ts';
import { loadDeployment } from './deployment.ts';
import { headersFile, injectCsp } from './csp.ts';
import { analyticsFor, beaconTemplate, landingCspExtras } from './analytics.ts';
import { LANDING_PERMISSIONS_POLICY, PERMISSIONS_POLICY } from './security-headers.ts';

const VIRTUAL_ID = 'virtual:cryoshield-config';
const RESOLVED_ID = '\0' + VIRTUAL_ID;

export function cryoshield(env: Record<string, string | undefined>, contractsDir: string, mode = 'production', root = join(contractsDir, '..', 'apps', 'web')): Plugin {
  const config = parseEnv(env);
  // Landing-only analytics (never in the virtual config, so the token can't reach the app bundle).
  const analytics = analyticsFor(env, mode, root, config.rpId);
  const landingExtras = analytics ? landingCspExtras(analytics) : {};
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
        if (ctx.path === '/index.html') {
          const out = injectCsp(html, config.connectOrigins, landingExtras);
          return analytics ? out.replace('</body>', `${beaconTemplate(analytics)}\n  </body>`) : out;
        }
        // add-architecture-page D3: live reference values from the deployment record and the config.
        if (ctx.path === '/architecture/index.html') html = architectureValues(html, config.chainId, deployment, config.rpId);
        return injectCsp(html, [...config.connectOrigins, ...config.appOnlyOrigins]);
      },
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: '_headers', source: headersFile([...config.connectOrigins, ...config.appOnlyOrigins], config.connectOrigins, landingExtras) });
    },
    // `vite preview` (E2E) sends the per-route Permissions-Policy like production: no WebAuthn on the landing page.
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? '/').split('?')[0];
        res.setHeader('Permissions-Policy', path === '/' || path === '/index.html' ? LANDING_PERMISSIONS_POLICY : PERMISSIONS_POLICY);
        next();
      });
    },
  };
}

const NETWORKS: Record<number, string> = { 11155420: 'OP Sepolia testnet', 10: 'OP Mainnet', 31337: 'local test chain' };
export function architectureValues(html: string, chainId: number, dep: { address: string; deployBlock: number }, rpId: string): string {
  const network = NETWORKS[chainId];
  if (!network) throw new Error(`add-architecture-page: no network name for chain ${chainId}`);
  return html
    .replaceAll('__CS_NETWORK_UPPER__', network.toUpperCase())
    .replaceAll('__CS_NETWORK__', network)
    .replaceAll('__CS_CHAIN_ID__', String(chainId))
    .replaceAll('__CS_REGISTRY__', dep.address)
    .replaceAll('__CS_DEPLOY_BLOCK__', String(dep.deployBlock))
    .replaceAll('__CS_RP_ID__', rpId);
}

export const defaultContractsDir = (root: string) => join(root, '..', '..', 'contracts');
