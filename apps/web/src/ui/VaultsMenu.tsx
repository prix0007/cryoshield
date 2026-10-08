/**
 * "Your vaults" (vault-list-labels-archive D5, D6, D9, D13) and the Edit vault sheet (D4, D10), one lazily loaded
 * chunk together with chain/history.ts. Picker mode after an unlock tap; menu mode from an open vault.
 *
 * Every vault name and label is rendered as its own text inside <bdi>, so its direction can't bleed into the UI, and
 * is never interpolated into a string, logged or stored. Rows never hold a secret value (vault/summary.ts).
 */
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { datesKey, vaultDates, type HistorySource, type VaultDates } from '../chain/history';
import { summarize, visibleName } from '../vault/summary';
import { validName } from '../vault/payload';
// Value imports from ./operations would make the bundler split the initial /app chunk; config is already shared.
import type { VaultSession } from './operations';
import { isOlder } from '../config';
import { KeyPrompt, Notice } from './components';
import { ActionBar } from './chrome';
import { Btn, CeremonyPresence, Disclosure, OpenProgress, PHASE_STEP, Spinner } from './motionkit';
import type { UnlockPhase } from '../chain/unlock';
import { VAULTS as V } from './strings-vaults';

export { archiveAndClear, saveVaultMeta } from './vault-meta';

export const vaultKey = (v: Pick<VaultSession, 'registry' | 'vaultId'>) => datesKey(v.registry, v.vaultId);
const fmt = (sec: number | null | undefined) => {
  try {
    return sec ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(sec * 1000)) : V.unavailable;
  } catch {
    return V.unavailable; // review M3: whatever an RPC returns, a date never breaks the list
  }
};

/** The vault name, isolated; "Unnamed vault" when it has no visible glyph. */
export function VaultName({ name }: { name: string | undefined }) {
  const n = visibleName(name);
  return n === undefined ? <>{V.unnamed}</> : <bdi>{n}</bdi>;
}

function Row(props: { v: VaultSession; dates: ReadonlyMap<string, VaultDates>; onOpen: () => void; onEdit?: (() => void) | undefined }) {
  const { v } = props;
  const s = summarize({ ...v, older: isOlder(v.registry), keyCount: v.credIds.length });
  const d = props.dates.get(vaultKey(v));
  const status = v.payloadError ? V.newer : s.status === 'active' ? V.active : s.status === 'archived' ? V.archived : V.older;
  return (
    <li className="card vault-row">
      <h3>
        <VaultName name={v.name} />
      </h3>
      <p>
        {status}
        {!v.payloadError && ` · ${V.items(s.count)} · ${V.keys(s.keys)}`}
      </p>
      {s.labels.length > 0 && !v.payloadError && (
        <p className="hint">
          {V.labels}{' '}
          {s.labels.map((l, i) => (
            <span key={i}>
              {i > 0 && ', '}
              <bdi>{l}</bdi>
            </span>
          ))}
          {s.more > 0 && ` ${V.more(s.more)}`}
        </p>
      )}
      <p className={d === undefined ? 'hint loading' : 'hint'} aria-live="polite" aria-busy={d === undefined}>
        {d === undefined && <Spinner />}
        {d === undefined ? V.loadingDates : `${V.created} ${fmt(d.created)} · ${V.saved} ${fmt(d.saved)}`}
      </p>
      {!v.payloadError && (
        <div className="actions">
          <Btn className="secondary" onClick={props.onOpen}>
            {V.open} <span className="sr-only"><VaultName name={v.name} /></span>
          </Btn>
          {props.onEdit && (
            <Btn className="secondary" onClick={props.onEdit}>
              {V.edit} <span className="sr-only"><VaultName name={v.name} /></span>
            </Btn>
          )}
        </div>
      )}
    </li>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id}>
      <h2 id={id} className="step-heading">
        {title}
      </h2>
      <ul className="plain-list vault-list">{children}</ul>
    </section>
  );
}

export default function VaultsMenu(props: {
  mode: 'picker' | 'menu';
  vaults: readonly VaultSession[];
  onOpen: (v: VaultSession) => void;
  /** Menu mode: open the vault's Edit vault sheet (vaults in the newest registry only). */
  onEdit?: (v: VaultSession) => void;
  /** One more key ceremony, merged by vault ID (D6). Resolves to a message to show, or null when vaults were added. */
  onCheckAnother: (onPhase: (p: UnlockPhase) => void) => Promise<string | null>;
  onBack: () => void;
  /** Public RPC, keccak-256 and registries for the dates (D9); passed in, see chain/history.ts. */
  history: HistorySource;
}) {
  const [dates, setDates] = useState<ReadonlyMap<string, VaultDates>>(new Map());
  /** Which `registry:vaultId` has been fetched (or is being fetched), at which version. */
  const fetched = useRef(new Map<string, number>());
  const [busy, setBusy] = useState(false);
  /** progress-feedback D4: Check another key's unlock step; null when idle. */
  const [at, setAt] = useState<number | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);

  // D9: fetched after the list renders, only for vaults (or versions) not fetched yet, so "Check another key" adds one
  // lookup instead of repeating all of them. Public data only, never the decrypted session. Aborted when the list closes
  // (lock, unmount). A failure leaves "Date unavailable". Never used for order or selection.
  const list = props.vaults;
  const { history } = props;
  const listRef = useRef(list);
  listRef.current = list;
  const want = list.map((v) => `${vaultKey(v)}:${v.version}`).join('|');
  useEffect(() => {
    const missing = listRef.current.filter((v) => fetched.current.get(vaultKey(v)) !== v.version);
    if (missing.length === 0) return;
    for (const v of missing) fetched.current.set(vaultKey(v), v.version);
    const ctl = new AbortController();
    const pub = missing.map(({ vaultId, version, blob, registry }) => ({ vaultId, version, blob, registry }));
    let done = false;
    const forget = () => {
      for (const v of missing) fetched.current.delete(vaultKey(v)); // fetch again next time
    };
    vaultDates(history, pub, { signal: ctl.signal })
      .then((d) => {
        done = true;
        setDates((prev) => new Map([...prev, ...d]));
      })
      .catch(forget);
    return () => {
      ctl.abort();
      if (!done) forget(); // synchronously, so an immediate re-run (StrictMode, a new key) fetches them again
    };
  }, [history, want]);

  const writable = (v: VaultSession) => !isOlder(v.registry) && !v.payloadError;
  const active = list.filter((v) => writable(v) && !v.archived);
  const archived = list.filter((v) => writable(v) && v.archived);
  const newer = list.filter((v) => v.payloadError);
  const older = list.filter((v) => isOlder(v.registry));
  const expand = props.mode === 'menu' || active.length === 0;
  const row = (v: VaultSession) => (
    <Row key={vaultKey(v)} v={v} dates={dates} onOpen={() => props.onOpen(v)} onEdit={props.mode === 'menu' && !isOlder(v.registry) && props.onEdit ? () => props.onEdit!(v) : undefined} />
  );

  async function another() {
    if (busy) return; // not `disabled`: disabling the pressed button mid-press would leave its press animation stuck
    setBusy(true);
    setAt(0);
    setNote(null);
    try {
      setNote(await props.onCheckAnother((p) => setAt(PHASE_STEP[p])));
    } finally {
      setBusy(false);
      setAt(null);
    }
  }

  return (
    <section aria-labelledby="vaults-title" className="step">
      <h1 id="vaults-title" ref={heading} tabIndex={-1}>
        {V.title}
      </h1>
      {props.mode === 'picker' && active.length > 1 && <p>{V.pickerIntro}</p>}
      {props.mode === 'picker' && active.length === 0 && archived.length > 0 && <Notice kind="info">{V.archivedOnly}</Notice>}
      {note && <Notice kind="info">{note}</Notice>}
      <CeremonyPresence>{busy && at === 0 && <KeyPrompt text={V.checking} />}</CeremonyPresence>
      <OpenProgress at={at} />
      {active.length > 0 && <Group title={V.groupActive}>{active.map(row)}</Group>}
      {archived.length > 0 &&
        (expand ? (
          <Group title={V.groupArchived}>{archived.map(row)}</Group>
        ) : (
          <Disclosure label={V.showArchived(archived.length)}>
            <ul className="plain-list vault-list">{archived.map(row)}</ul>
          </Disclosure>
        ))}
      {newer.length > 0 && <Group title={V.groupNewer}>{newer.map(row)}</Group>}
      {older.length > 0 &&
        (expand ? (
          <Group title={V.groupOlder}>{older.map(row)}</Group>
        ) : (
          <Disclosure label={V.showOlder}>
            <ul className="plain-list vault-list">{older.map(row)}</ul>
          </Disclosure>
        ))}
      <ActionBar>
        <Btn className="secondary" onClick={another} aria-disabled={busy || undefined}>
          {V.checkAnother}
        </Btn>
        <Btn className="secondary" onClick={props.onBack} disabled={busy}>
          {props.mode === 'menu' ? V.back : V.lock}
        </Btn>
      </ActionBar>
    </section>
  );
}

/**
 * Edit vault (D10): the name and the archived flag, saved together in ONE update by the caller; unchanged means no
 * write. "Archive and clear" (D4) sits behind an inline confirmation that must be checked.
 */
export function EditVaultSheet(props: {
  session: VaultSession;
  busy: boolean;
  /** Review M5: no free saves left (testnet). Blocks Save and Archive and clear; Cancel stays available. */
  saveBlocked?: boolean;
  onSave: (meta: { name?: string; archived: boolean }) => void;
  onClear: () => void;
  onCancel: () => void;
}) {
  const s = props.session;
  const [name, setName] = useState(s.name ?? '');
  const [archived, setArchived] = useState(s.archived);
  const [clearing, setClearing] = useState(false);
  const [understood, setUnderstood] = useState(false);
  const invalid = name !== '' && !validName(name);
  const nameId = useId();
  const hintId = useId();
  const errId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  const changed = (name === '' ? undefined : name) !== s.name || archived !== s.archived;

  return (
    <div className="card">
      <h2 ref={heading} tabIndex={-1} className="step-heading">
        {V.sheet.title}
      </h2>
      <form
        className="editor"
        onSubmit={(e) => {
          e.preventDefault();
          if (invalid || props.busy) return;
          if (!changed) return props.onCancel(); // nothing changed: nothing is sent
          props.onSave({ ...(name === '' ? {} : { name }), archived });
        }}
      >
        <label htmlFor={nameId}>{V.sheet.name}</label>
        <input
          id={nameId}
          value={name}
          autoComplete="off"
          spellCheck={false}
          dir="auto"
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? `${hintId} ${errId}` : hintId}
          onChange={(e) => setName(e.target.value)}
        />
        <p id={hintId} className="hint">
          {V.sheet.nameHint}
        </p>
        {invalid && (
          <p id={errId} className="hint meter-over">
            {V.sheet.nameInvalid}
          </p>
        )}
        <label className="check">
          <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} />
          <span>{V.sheet.archive}</span>
        </label>
        <p className="hint">{V.sheet.archiveHint}</p>
        <p className="hint">{V.sheet.anyKey}</p>
        <ActionBar>
          <Btn type="submit" disabled={invalid || props.busy || props.saveBlocked}>
            {V.sheet.save}
          </Btn>
          <Btn type="button" className="secondary" onClick={props.onCancel} disabled={props.busy}>
            {V.sheet.cancel}
          </Btn>
        </ActionBar>
      </form>
      {s.archived && s.items.length === 0 ? null : !clearing ? (
        <Btn type="button" className="link-button" onClick={() => setClearing(true)} disabled={props.busy || props.saveBlocked}>
          {V.clear.open}
        </Btn>
      ) : (
        <fieldset className="ack card">
          <legend>{V.clear.title}</legend>
          <p>{V.clear.intro}</p>
          <ul className="plain-list">
            {V.clear.points.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
          <label className="check">
            <input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} />
            <span>{V.clear.confirm}</span>
          </label>
          <ActionBar>
            <Btn type="button" onClick={props.onClear} disabled={!understood || props.busy || props.saveBlocked}>
              {V.clear.button}
            </Btn>
            <Btn type="button" className="secondary" onClick={() => { setClearing(false); setUnderstood(false); }} disabled={props.busy}>
              {V.clear.cancel}
            </Btn>
          </ActionBar>
        </fieldset>
      )}
    </div>
  );
}
