/** Injects the rendered legal text and the shared header/footer partials into the legal page shells (pre-transform). */
import type { Plugin } from 'vite';
import { partial, renderLegalPage } from './legal.ts';

export function legalPagesPlugin(root: string): Plugin {
  // Clean URLs like production (Caddy rewrites /privacy -> /privacy/index.html): dev server and `vite preview`.
  const rewrite = (req: { url?: string }, _res: unknown, next: () => void) => {
    const m = req.url?.match(/^\/(privacy|terms|cookies|architecture)(\?.*)?$/);
    if (m) req.url = `/${m[1]}/index.html${m[2] ?? ''}`;
    next();
  };
  return {
    name: 'cryoshield-legal-pages',
    configureServer(server) {
      server.middlewares.use(rewrite);
    },
    configurePreviewServer(server) {
      server.middlewares.use(rewrite);
    },
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        return html
          .replace(/<!--partial:header(?::([^>]+))?-->/, (_m, name?: string) => partial(root, 'header').replace('<p class="sub-nav-name">Legal</p>', `<p class="sub-nav-name">${(name ?? 'Legal').replace(/[<>&"]/g, '')}</p>`))
          .replace('<!--partial:footer-->', () => partial(root, 'footer'))
          .replace(/<!--legal:(privacy|terms|cookies)-->/, (_m, name: string) => renderLegalPage(root, name));
      },
    },
  };
}
