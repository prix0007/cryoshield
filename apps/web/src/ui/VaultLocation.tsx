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
  registry: { address: Hex | null; version: 'v1' | 'v2' };
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
  const [copied, setCopied] = useState('');
  const ex = p.network.explorerUrl;
  const rows: Row[] = [
    { label: L.network, value: String(p.chainId), text: L.networkValue(p.network.name, p.chainId) },
    ...(p.registry.address
      ? [{ label: L.registry, value: p.registry.address, note: p.registry.version === 'v2' ? L.registryV2 : L.registryV1, href: addressUrl(ex, p.registry.address) }]
      : []),
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
                  if (await copyPublic(r.value)) setCopied(L.copied(r.label));
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
        {copied}
      </p>
    </div>
  );
}

function Value({ row }: { row: Row }) {
  const shown = short(row.value);
  // Full value for assistive technology; the truncated one on screen only.
  const body =
    row.text ??
    (shown === row.value ? (
      row.value
    ) : (
      <>
        <span aria-hidden="true">{shown}</span>
        <span className="sr-only">{row.value}</span>
      </>
    ));
  const cls = row.text ? 'loc-value' : 'loc-value mono';
  if (!row.href) return <span className={cls}>{body}</span>;
  return (
    <a className={cls} href={row.href} target="_blank" rel="noopener noreferrer" aria-label={`${row.label}: ${row.value}, ${L.newTab}`}>
      {body}
    </a>
  );
}
