/**
 * Build-time wiring: validates VITE_* env (fails the build on any problem), loads the deployment record (registry v2,
 * legacy registry v1, and the wallet pair for VITE_RP_ID), exposes both through `virtual:cryoshield-config`, and
 * injects the CSP.
 */
import { join } from 'node:path';
import type { Plugin } from 'vite';
import { parseEnv } from '../src/config/schema.ts';
import { NETWORKS, networkFor } from '../src/config/networks.ts';
import { loadDeployment, type Deployment } from './deployment.ts';
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
  const deployment = loadDeployment(contractsDir, config.chainId, config.rpId);
  return {
    name: 'cryoshield-config',
    resolveId(id) {
      return id === VIRTUAL_ID ? RESOLVED_ID : null;
    },
    load(id) {
      if (id !== RESOLVED_ID) return null;
      const runtime = {
        ...config,
        registryV1: deployment.v1 ? { address: deployment.v1.address, deployBlock: deployment.v1.deployBlock } : null,
        registryV2: { address: deployment.v2.address, deployBlock: deployment.v2.deployBlock },
        wallet: { factory: deployment.wallet.factory, implementation: deployment.wallet.implementation },
        // show-vault-onchain-location D1: display name and explorer for the "Where your vault is stored" panel.
        network: networkFor(config.chainId),
      };
      return `export const config = Object.freeze(${JSON.stringify(runtime)});`;
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

export function architectureValues(html: string, chainId: number, dep: Pick<Deployment, 'v1' | 'v2' | 'wallet'>, rpId: string): string {
  const network = NETWORKS[chainId]?.name;
  if (!network) throw new Error(`add-architecture-page: no network name for chain ${chainId}`);
  return html
    .replaceAll('__CS_NETWORK_UPPER__', network.toUpperCase())
    .replaceAll('__CS_NETWORK__', network)
    .replaceAll('__CS_CHAIN_ID__', String(chainId))
    .replaceAll('__CS_REGISTRY_V1__', dep.v1 ? `${dep.v1.address} (read-only)` : 'not deployed on this network')
    .replaceAll('__CS_REGISTRY__', dep.v2.address)
    .replaceAll('__CS_DEPLOY_BLOCK__', String(dep.v2.deployBlock))
    .replaceAll('__CS_WALLET_FACTORY__', dep.wallet.factory)
    .replaceAll('__CS_RP_ID__', rpId);
}

export const defaultContractsDir = (root: string) => join(root, '..', '..', 'contracts');
