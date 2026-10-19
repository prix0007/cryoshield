/**
 * footer-release-version D7: `vite dev` and `vite preview` answer /release.json the way the development site does
 * ({ commit, release: null }), so both footers show "Version dev <commit>" locally and in E2E, and no page logs a 404
 * (the E2E specs fail on any console error). Server middleware only: the built files never contain a release.json
 * (gen-context.mjs refuses one); a deploy publishes the real file next to the site.
 */
import { execFileSync } from 'node:child_process';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';

export interface DevReleaseIdentity {
  name: 'cryoshield-web';
  commit: string;
  release: null;
}

/** The checked-out commit; forty zeros where there is no git (an exported archive), which the footers show as such. */
export function devReleaseIdentity(root: string): DevReleaseIdentity {
  let commit = '0'.repeat(40);
  try {
    const out = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (/^[0-9a-f]{40}$/.test(out)) commit = out;
  } catch {
    /* not a git checkout */
  }
  return { name: 'cryoshield-web', commit, release: null };
}

/** Serves exactly /release.json (any query) as uncached JSON; everything else passes through. */
export function releaseHandler(identity: DevReleaseIdentity) {
  const body = JSON.stringify(identity, null, 2) + '\n';
  return (req: IncomingMessage, res: ServerResponse, next: () => void): void => {
    if ((req.url ?? '/').split('?')[0] !== '/release.json') return next();
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(body);
  };
}

export function releasePreviewPlugin(root: string): Plugin {
  return {
    name: 'cryoshield:release-preview',
    configureServer(server) {
      server.middlewares.use(releaseHandler(devReleaseIdentity(root)));
    },
    configurePreviewServer(server) {
      server.middlewares.use(releaseHandler(devReleaseIdentity(root)));
    },
  };
}
