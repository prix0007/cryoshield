import { useEffect, useId, useRef, type ReactNode } from 'react';
import { capacity } from '../vault/adapter';
import { MAX_LABEL_CHARS, type SecretItem } from '../vault/payload';
import { S } from './strings';
import { ActionBar } from './chrome';
import { CEREMONY_WAITING, noticeTitle } from './ceremony';
import { AnimatePresence, Btn, Collapse, Disclosure, Pulse, Shake, SlideIn } from './motionkit';

/** Step heading that receives focus when the step appears (WCAG 2.4.3 focus order). */
export function StepHeading({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <h2 ref={ref} tabIndex={-1} className="step-heading">
      {children}
    </h2>
  );
}

export function Notice({ kind, title, reference, children }: { kind: 'error' | 'info' | 'success'; title?: string; reference?: string | undefined; children: ReactNode }) {
  const heading = title ?? (kind === 'error' && typeof children === 'string' ? noticeTitle(children) : undefined);
  const text = typeof children === 'string' ? <p className="notice-text">{children}</p> : children;
  const body = (
    <>
      <NoticeIcon kind={kind} />
      <div className="notice-body">
        {heading && <p className="notice-title">{heading}</p>}
        {/* Errors: the card shakes once and the message slides in under the title (all text: no motion-only info). */}
        {kind === 'error' ? <SlideIn>{text}</SlideIn> : text}
        {kind === 'error' && pointsToDevices(heading, children) && (
          <p className="notice-link">
            <a href="/devices">See supported devices</a>
          </p>
        )}
        {reference && (
          <Disclosure label={S.save.details}>
            <code className="mono">{reference}</code>
          </Disclosure>
        )}
      </div>
    </>
  );
  return kind === 'error' ? (
    <Shake className="notice notice-error" role="alert">
      {body}
    </Shake>
  ) : (
    <div className={`notice notice-${kind}`} role="status">
      {body}
    </div>
  );
}

/** add-supported-devices-page: errors about the key or browser itself link the supported-devices page. */
const DEVICE_TITLES = new Set(['Key not supported', 'Browser not supported']);
function pointsToDevices(heading: string | undefined, children: ReactNode): boolean {
  // An enrollment "cancel" may also mean a key without credProtect level 3 (the browser reports both the same way).
  return (heading !== undefined && DEVICE_TITLES.has(heading)) || children === S.enrollCancelled;
}

function NoticeIcon({ kind }: { kind: 'error' | 'info' | 'success' }) {
  return (
    <svg className="notice-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="10" />
      {kind === 'error' && <path d="M12 6.5v7M12 16.5v.5" />}
      {kind === 'info' && <path d="M12 11v6M12 7v.5" />}
      {kind === 'success' && <path d="m7.5 12.5 3 3 6-6.5" />}
    </svg>
  );
}

/** Key-ceremony panel: the "Touch your key" waiting state (errors are shown by Notice with a ceremony title). */
export function KeyPrompt({ text, onContinue }: { text: string; onContinue?: () => void }) {
  return (
    <div className="key-prompt card" role="status" aria-live="assertive">
      <span className="key-visual" aria-hidden="true">
        <Pulse />
        <svg className="key-glyph" viewBox="0 0 48 24" aria-hidden="true" focusable="false">
          <rect x="1" y="3" width="34" height="18" rx="6" />
          <rect className="key-plug" x="35" y="7" width="10" height="10" rx="2" />
          <circle className="key-pad" cx="20" cy="12" r="5" />
        </svg>
      </span>
      <div className="key-prompt-body">
        <p className="key-state">{CEREMONY_WAITING}</p>
        <p className="key-text">{text}</p>
        {onContinue && <AutoFocusButton onClick={onContinue}>{S.continue}</AutoFocusButton>}
      </div>
    </div>
  );
}

function AutoFocusButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <Btn ref={ref} onClick={onClick}>
      {children}
    </Btn>
  );
}

export function SecretsEditor(props: {
  rpId: string;
  credIds: readonly Uint8Array[];
  items: SecretItem[];
  onChange: (items: SecretItem[]) => void;
  onSave: () => void;
  onCancel?: () => void;
  busy?: boolean;
  /** Extra confirmation shown above Save (create flow: permanence + 18+). Save stays disabled until `ok`. */
  gate?: { ok: boolean; content: ReactNode; hintId: string };
}) {
  const { items, onChange } = props;
  const cap = capacity(props.rpId, props.credIds, items);
  const nonEmpty = items.some((i) => i.secret.trim() !== '');
  const meterId = useId();
  const over = !cap.fits && nonEmpty;
  const update = (i: number, patch: Partial<SecretItem>) => onChange(items.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  // Row keys for the enter/exit animation: a local counter, never derived from a label or secret (guardrail d).
  const rowKeys = useRef<number[]>([]);
  const nextKey = useRef(0);
  while (rowKeys.current.length < items.length) rowKeys.current.push(nextKey.current++);
  rowKeys.current.length = items.length;
  const remove = (i: number) => {
    rowKeys.current.splice(i, 1);
    onChange(items.filter((_, j) => j !== i));
  };
  return (
    <form
      className="editor"
      onSubmit={(e) => {
        e.preventDefault();
        if (cap.fits && nonEmpty && (props.gate?.ok ?? true)) props.onSave();
      }}
      aria-describedby={meterId}
    >
      <AnimatePresence initial={false}>
        {items.map((it, i) => {
          // Input ids follow the row key (equal to the index until a row is removed), so an exiting row never
          // shares an id with the row that took its place.
          const k = rowKeys.current[i]!;
          return (
          <Collapse key={k}>
            <fieldset className="item card">
              <legend>{it.label || `${S.editor.secret} ${i + 1}`}</legend>
              <label htmlFor={`label-${k}`}>{S.editor.label}</label>
              <input
                id={`label-${k}`}
                value={it.label}
                maxLength={MAX_LABEL_CHARS}
                autoComplete="off"
                spellCheck={false}
                aria-describedby={`label-hint-${k}`}
                onChange={(e) => update(i, { label: e.target.value })}
              />
              <p id={`label-hint-${k}`} className="hint">
                {S.editor.labelHint}
              </p>
              <label htmlFor={`secret-${k}`}>{S.editor.secret}</label>
              <textarea
                id={`secret-${k}`}
                value={it.secret}
                rows={3}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                data-1p-ignore=""
                data-lpignore="true"
                aria-invalid={over ? true : undefined}
                aria-describedby={over ? meterId : undefined}
                onChange={(e) => update(i, { secret: e.target.value })}
              />
              {items.length > 1 && (
                <Btn type="button" className="secondary" onClick={() => remove(i)}>
                  {S.editor.removeItem(it.label)}
                </Btn>
              )}
            </fieldset>
          </Collapse>
          );
        })}
      </AnimatePresence>
      <Btn type="button" className="secondary" onClick={() => onChange([...items, { label: '', secret: '' }])}>
        {S.editor.addItem}
      </Btn>
      <p id={meterId} className={cap.fits || !nonEmpty ? 'meter' : 'meter meter-over'} aria-live="polite">
        {cap.remaining >= 0 ? S.editor.space(cap.remaining, cap.max) : S.editor.tooBig(-cap.remaining)}
      </p>
      {!nonEmpty && <p className="hint">{S.editor.needOne}</p>}
      {props.gate?.content}
      <ActionBar>
        <Btn
          type="submit"
          disabled={!cap.fits || !nonEmpty || props.busy || (props.gate ? !props.gate.ok : false)}
          {...(props.gate && !props.gate.ok ? { 'aria-describedby': props.gate.hintId } : {})}
        >
          {S.editor.save}
        </Btn>
        {props.onCancel && (
          <Btn type="button" className="secondary" onClick={props.onCancel} disabled={props.busy}>
            {S.editor.cancel}
          </Btn>
        )}
      </ActionBar>
    </form>
  );
}

/** Items to store: drop fully empty rows; labels default to "Secret n". */
export function cleanItems(items: SecretItem[]): SecretItem[] {
  return items
    .filter((i) => i.secret.trim() !== '' || i.label.trim() !== '')
    .map((i, n) => ({ label: i.label.trim() || `${S.editor.secret} ${n + 1}`, secret: i.secret }));
}

/** Permanence + age acknowledgement (add-privacy-and-compliance 4.1). Held in component state only: never stored. */
export function PermanenceAck(props: { permanent: boolean; adult: boolean; onPermanent: (v: boolean) => void; onAdult: (v: boolean) => void; hintId: string }) {
  return (
    <fieldset className="ack card">
      <legend>{S.ack.title}</legend>
      <label className="check">
        <input type="checkbox" checked={props.permanent} onChange={(e) => props.onPermanent(e.target.checked)} />
        <span>{S.ack.permanent}</span>
      </label>
      <label className="check">
        <input type="checkbox" checked={props.adult} onChange={(e) => props.onAdult(e.target.checked)} />
        <span>{S.ack.adult}</span>
      </label>
      <p id={props.hintId} className="hint" aria-live="polite">
        {props.permanent && !props.adult ? S.ack.adultRequired : !(props.permanent && props.adult) ? S.ack.needBoth : null}
      </p>
    </fieldset>
  );
}
