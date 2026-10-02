import { useEffect, useId, useRef, type ReactNode } from 'react';
import { capacity } from '../vault/adapter';
import { MAX_LABEL_CHARS, type SecretItem } from '../vault/payload';
import { S } from './strings';
import { ActionBar } from './chrome';
import { CEREMONY_WAITING, noticeTitle } from './ceremony';

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

export function Notice({ kind, title, children }: { kind: 'error' | 'info' | 'success'; title?: string; children: ReactNode }) {
  const heading = title ?? (kind === 'error' && typeof children === 'string' ? noticeTitle(children) : undefined);
  return (
    <div className={`notice notice-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      <NoticeIcon kind={kind} />
      <div className="notice-body">
        {heading && <p className="notice-title">{heading}</p>}
        {typeof children === 'string' ? <p className="notice-text">{children}</p> : children}
      </div>
    </div>
  );
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
        <span className="key-pulse" />
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
    <button ref={ref} onClick={onClick}>
      {children}
    </button>
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
}) {
  const { items, onChange } = props;
  const cap = capacity(props.rpId, props.credIds, items);
  const nonEmpty = items.some((i) => i.secret.trim() !== '');
  const meterId = useId();
  const over = !cap.fits && nonEmpty;
  const update = (i: number, patch: Partial<SecretItem>) => onChange(items.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  return (
    <form
      className="editor"
      onSubmit={(e) => {
        e.preventDefault();
        if (cap.fits && nonEmpty) props.onSave();
      }}
      aria-describedby={meterId}
    >
      {items.map((it, i) => (
        <fieldset key={i} className="item card">
          <legend>{it.label || `${S.editor.secret} ${i + 1}`}</legend>
          <label htmlFor={`label-${i}`}>{S.editor.label}</label>
          <input
            id={`label-${i}`}
            value={it.label}
            maxLength={MAX_LABEL_CHARS}
            autoComplete="off"
            spellCheck={false}
            aria-describedby={`label-hint-${i}`}
            onChange={(e) => update(i, { label: e.target.value })}
          />
          <p id={`label-hint-${i}`} className="hint">
            {S.editor.labelHint}
          </p>
          <label htmlFor={`secret-${i}`}>{S.editor.secret}</label>
          <textarea
            id={`secret-${i}`}
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
            <button type="button" className="secondary" onClick={() => onChange(items.filter((_, j) => j !== i))}>
              {S.editor.removeItem(it.label)}
            </button>
          )}
        </fieldset>
      ))}
      <button type="button" className="secondary" onClick={() => onChange([...items, { label: '', secret: '' }])}>
        {S.editor.addItem}
      </button>
      <p id={meterId} className={cap.fits || !nonEmpty ? 'meter' : 'meter meter-over'} aria-live="polite">
        {cap.remaining >= 0 ? S.editor.space(cap.remaining, cap.max) : S.editor.tooBig(-cap.remaining)}
      </p>
      {!nonEmpty && <p className="hint">{S.editor.needOne}</p>}
      <ActionBar>
        <button type="submit" disabled={!cap.fits || !nonEmpty || props.busy}>
          {S.editor.save}
        </button>
        {props.onCancel && (
          <button type="button" className="secondary" onClick={props.onCancel} disabled={props.busy}>
            {S.editor.cancel}
          </button>
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
