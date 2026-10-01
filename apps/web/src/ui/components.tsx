import { useEffect, useId, useRef, type ReactNode } from 'react';
import { capacity } from '../vault/adapter';
import { MAX_LABEL_CHARS, type SecretItem } from '../vault/payload';
import { S } from './strings';

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

export function Notice({ kind, children }: { kind: 'error' | 'info' | 'success'; children: ReactNode }) {
  return (
    <div className={`notice notice-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      {children}
    </div>
  );
}

export function KeyPrompt({ text, onContinue }: { text: string; onContinue?: () => void }) {
  return (
    <div className="key-prompt" role="status" aria-live="assertive">
      <span className="key-icon" aria-hidden="true">
        🔑
      </span>
      <p>{text}</p>
      {onContinue && <AutoFocusButton onClick={onContinue}>{S.continue}</AutoFocusButton>}
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
        <fieldset key={i} className="item">
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
      <div className="actions">
        <button type="submit" disabled={!cap.fits || !nonEmpty || props.busy}>
          {S.editor.save}
        </button>
        {props.onCancel && (
          <button type="button" className="secondary" onClick={props.onCancel} disabled={props.busy}>
            {S.editor.cancel}
          </button>
        )}
      </div>
    </form>
  );
}

/** Items to store: drop fully empty rows; labels default to "Secret n". */
export function cleanItems(items: SecretItem[]): SecretItem[] {
  return items
    .filter((i) => i.secret.trim() !== '' || i.label.trim() !== '')
    .map((i, n) => ({ label: i.label.trim() || `${S.editor.secret} ${n + 1}`, secret: i.secret }));
}
