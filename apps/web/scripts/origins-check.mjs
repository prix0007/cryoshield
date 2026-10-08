/**
 * add-privacy-and-compliance 2.2: every origin a build may contact (CSP connect-src / script-src) must be listed in
 * docs/compliance/origins.json (mapped to a data-flow inventory row). Loopback and *.invalid origins (dev, E2E and
 * verify-build fixtures) are exempt.
 */
export function checkOrigins(csp, inventory) {
  const directive = (name) =>
    (csp.split(';').map((d) => d.trim()).find((d) => d.startsWith(`${name} `)) ?? '')
      .split(/\s+/)
      .slice(1)
      .filter((s) => !s.startsWith("'"));
  const origins = [...new Set([...directive('connect-src'), ...directive('script-src')].map((s) => new URL(s).origin))];
  const exempt = (o) => {
    const h = new URL(o).hostname;
    return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h.endsWith('.invalid');
  };
  const listed = [];
  const missing = [];
  for (const o of origins) {
    if (exempt(o)) continue;
    const row = inventory.origins[o];
    if (row) listed.push({ origin: o, row: row.row, role: row.role, vendor: row.vendor });
    else missing.push(o);
  }
  return { listed, missing };
}

/**
 * launch-op-mainnet 4.4 (spec legal-pages "RPC origin must be disclosed"): the built /privacy page's
 * "Blockchain access (RPC)" row must name the host of the configured VITE_RPC_URL. Returns the missing host (or []).
 * Loopback and *.invalid endpoints (dev, E2E, verify-build fixtures) are exempt.
 */
export function checkRpcDisclosed(privacyHtml, rpcUrl) {
  const host = new URL(rpcUrl).hostname;
  if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host.endsWith('.invalid')) return [];
  const row = [...privacyHtml.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((m) => m[1]).find((r) => r.includes('Blockchain access (RPC)'));
  return row && row.includes(host) ? [] : [host];
}
