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
