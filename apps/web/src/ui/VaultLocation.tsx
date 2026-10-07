/**
 * "Where your vault is stored" panel content (show-vault-onchain-location). Loaded lazily when the disclosure opens.
 * Public facts only, all already in memory: no locator, credential ID, salt or key material, and no network request.
 * Links are user-started navigations (new tab, noopener noreferrer); their targets are built from build-time bases and
 * strictly formatted values only (src/config/networks.ts).
 */
import { useState } from 'react';
import type { Hex } from 'viem';
import { addressUrl, arweaveUrl, txUrl } from '../config/networks';
import { copyPublic } from './clipboard';
import { Btn } from './motionkit';
import { LOCATION as L } from './strings-location';

export interface VaultLocationProps {
  network: { name: string; explorerUrl: string | null };
  chainId: number;
  /** Every configured registry, newest first, and the version of the one holding the vault (web-registry-versions D5). */
  registries: readonly { version: string; address: Hex }[];
  registry: string;
  vaultId: Hex;
  owner: Hex;
  version: number;
  /** Only when this session made the save that produced `version`. */
  lastSaveTx?: Hex | undefined;
  /** Only when this session uploaded or byte-verified the Arweave copy of `version`. */
  mirrorId?: string | undefined;
  arweaveGatewayUrl: string;
}

interface Row {
  label: string;
  /** The full value: copied, and given to assistive technology. */
  value: string;
  /** On-screen text when it differs from a truncated `value` (e.g. the network name). */
  text?: string;
  note?: string;
  href?: string | null;
}

const short = (v: string) => (v.length > 16 ? `${v.slice(0, 6)}…${v.slice(-4)}` : v);

export default function VaultLocation(p: VaultLocationProps) {
  // `n` makes a repeated copy of the same row change the live region's text, so it is announced again.
  const [copied, setCopied] = useState({ text: '', n: 0 });
  const ex = p.network.explorerUrl;
  const rows: Row[] = [
    { label: L.network, value: String(p.chainId), text: L.networkValue(p.network.name, p.chainId) },
    // Not the newest registry: read-only.
    ...p.registries
      .filter((r) => r.version === p.registry)
      .map((r) => ({ label: L.registry, value: r.address, note: L.registryVersion(r.version, r !== p.registries[0]), href: addressUrl(ex, r.address) })),
    { label: L.vaultId, value: p.vaultId },
    { label: L.owner, value: p.owner, href: addressUrl(ex, p.owner) },
    { label: L.version, value: String(p.version) },
    ...(p.lastSaveTx ? [{ label: L.lastSave, value: p.lastSaveTx, href: txUrl(ex, p.lastSaveTx) }] : []),
  ];
  const arHref = p.mirrorId ? arweaveUrl(p.arweaveGatewayUrl, p.mirrorId) : null;
  if (p.mirrorId && arHref) rows.push({ label: L.arweave, value: p.mirrorId, href: arHref, note: L.arweaveHint });

  return (
    <div className="vault-location">
      <p className="hint">{L.intro}</p>
      <dl className="loc-list">
        {rows.map((r) => (
          <div className="loc-row" key={r.label}>
            <dt>{r.label}</dt>
            <dd>
              <Value row={r} />
              {r.note && <span className="loc-note">{r.note}</span>}
              <Btn
                type="button"
                className="secondary loc-copy"
                onClick={async () => {
                  if (await copyPublic(r.value)) setCopied((c) => ({ text: L.copied(r.label), n: c.n + 1 }));
                }}
              >
                {L.copy} <span className="sr-only">{r.label}</span>
              </Btn>
            </dd>
          </div>
        ))}
      </dl>
      <p className="loc-public">{L.publicNote}</p>
      <p className="sr-only" role="status" aria-live="polite">
        {copied.text}
        {copied.n % 2 === 1 ? '\u00a0' : ''}
      </p>
    </div>
  );
}

function Value({ row }: { row: Row }) {
  const shown = row.text ?? short(row.value);
  const cls = row.text ? 'loc-value' : 'loc-value mono';
  if (row.href) {
    // The name is one text run (no aria-label) that contains the visible, possibly truncated text (WCAG 2.5.3), with the
    // row label before it and the full value and "opens in a new tab" after it.
    return (
      <a className={cls} href={row.href} target="_blank" rel="noopener noreferrer">
        <span className="loc-short" aria-hidden="true">
          {shown}
        </span>
        <span className="sr-only">{`${row.label}: ${shown}${shown === row.value ? '' : `, ${row.value}`}, ${L.newTab}`}</span>
      </a>
    );
  }
  // Not interactive: the truncated value on screen only, the full value for assistive technology.
  if (shown === row.value || row.text) return <span className={cls}>{shown}</span>;
  return (
    <span className={cls}>
      <span aria-hidden="true">{shown}</span>
      <span className="sr-only">{row.value}</span>
    </span>
  );
}
