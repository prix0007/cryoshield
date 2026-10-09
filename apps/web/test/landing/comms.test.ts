// @vitest-environment node
/**
 * launch-op-mainnet 5.4 (design → Communications and copy plan): the prepared launch texts and the `vA` release-notes
 * template pass the same honesty denylist as the site (the OP Mainnet build's list), keep the unaudited and
 * all-keys-lost statements, and reuse the app's exact notice wording.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bannedFor } from './banned';
import { S } from '../../src/ui/strings';

const md = readFileSync(join(__dirname, '..', '..', '..', '..', 'docs', 'launch', 'op-mainnet-comms.md'), 'utf8');
const flat = md.replace(/\s+/g, ' ');
/**
 * Prose only: inline code spans are identifiers (the change name `launch-op-mainnet`, file paths), not claims. The
 * fenced release-notes template is public text, so only its fence lines are dropped and its body is checked.
 */
const prose = md
  .replace(/^```[a-z]*$/gm, '')
  .replace(/`[^`\n]+`/g, '')
  .replace(/\s+/g, ' ');

describe('docs/launch/op-mainnet-comms.md', () => {
  it('has every planned text, unpublished', () => {
    const h2 = [...md.replace(/```[\s\S]*?```/g, '').matchAll(/^## (.+)$/gm)].map((m) => m[1]);
    expect(h2).toEqual(['Before the switch', 'At the switch', 'Release notes template for vA', 'Announcement (after the soft launch)', 'Incident wording', 'Checklist before publishing']);
    expect(flat).toMatch(/Prepared, not published/);
  });

  it('passes the honesty denylist; "OP Mainnet" only as the network name', () => {
    for (const b of bannedFor(10)) expect(prose, String(b)).not.toMatch(b);
  });

  it('says unaudited and the all-keys-lost rule, and never promises an audit', () => {
    expect(flat).toMatch(/has not been independently audited/);
    expect(flat).toMatch(/if you lose every key, nobody, including CryoShield, can open it/i);
    expect(flat).not.toMatch(/audit (is )?(planned|coming|scheduled)|will be audited|audited (soon|later)|not (yet )?audited yet/i);
  });

  it('reuses the app and landing wording verbatim', () => {
    expect(flat).toContain(S.network.moving);
    expect(flat).toContain(S.network.testnetVaults.replace(/\s+/g, ' '));
    expect(flat).toContain(S.network.mainnet('OP Mainnet'));
    // Founder decision 2026-10-09: the mainnet refusal message, mirrored exactly.
    expect(flat).toContain(S.save.pausedMainnet);
    expect(flat).toContain('Saving is paused');
  });

  it('holds no secret: no API key, no key-shaped hex, no private key', () => {
    expect(md).not.toMatch(/apikey=|pim_[A-Za-z0-9]{8,}|ETHERSCAN_API_KEY=\S/);
    expect(md).not.toMatch(/\b0x[0-9a-fA-F]{64}\b/);
  });
});
