/**
 * Motion components for /app (app-motion-ux). Decoration only: nothing here is awaited by a flow, and no secret,
 * PRF output, key or address is ever passed in as an animated value or used as an animation key.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, LazyMotion, MotionConfig, PresenceContext, useIsPresent, useReducedMotion, type HTMLMotionProps } from 'motion/react';
import * as m from 'motion/react-m';
import { collapse, countdown, directionOf, HOVER, keyCheck, pop, pulse, shake, slideIn, slotFill, stepVariants, TAP } from './motion';
import { CLIPBOARD_CLEAR_MS } from './clipboard';
import { S } from './strings';

/**
 * Root: `m` only (`strict` throws on the full `motion` component) with the domAnimation features fetched as a separate
 * chunk after first render, plus the OS reduced-motion setting. Until the chunk arrives elements simply render in their
 * final state; nothing waits for it.
 */
const loadFeatures = () => import('./motion-features').then((r) => r.default);
export function MotionRoot({ children }: { children: ReactNode }) {
  return (
    <LazyMotion features={loadFeatures} strict>
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </LazyMotion>
  );
}

export const useReduced = (): boolean => useReducedMotion() ?? false;

/**
 * Presence boundary. `AnimatePresence initial={false}` reaches every descendant through PresenceContext, so content
 * mounted LATER inside an initially-present step or row (a reveal, the copy bar) would start at its end state. The
 * contents of steps and rows get a fresh context so their own entrances run when they really appear.
 */
function Fresh({ children }: { children: ReactNode }) {
  return <PresenceContext.Provider value={null}>{children}</PresenceContext.Provider>;
}

const finePointer = () => typeof matchMedia === 'function' && matchMedia('(hover: hover) and (pointer: fine)').matches;

/** Every app button: press feedback (scale 0.95) and, on hover-capable fine pointers only, a 1px lift. */
export function Btn(props: HTMLMotionProps<'button'>) {
  const [fine] = useState(finePointer);
  const live = !props.disabled;
  return <m.button {...(live ? { whileTap: TAP } : {})} {...(live && fine ? { whileHover: HOVER } : {})} {...props} />;
}

/** Direction of travel between two renders of `current`, from its position in `order`. */
export function useDirection<T>(order: readonly T[], current: T): 1 | -1 {
  const prev = useRef(current);
  const dir = useRef<1 | -1>(1);
  if (prev.current !== current) {
    dir.current = directionOf(order, prev.current, current);
    prev.current = current;
  }
  return dir.current;
}

/**
 * Steps inside a flow: the old step slides/fades out, then the new one in (mode="wait"); the new step's StepHeading
 * focuses on mount, i.e. after the transition. `id` is a step name (never data). Changing `epoch` drops the old step
 * at once with no exit (used by the idle wipe, so nothing lingers on screen).
 */
export function StepTransition({ id, dir, epoch = 0, children }: { id: string; dir: 1 | -1; epoch?: number; children: ReactNode }) {
  return (
    <AnimatePresence key={epoch} mode="wait" initial={false} custom={dir}>
      <Step key={id} dir={dir}>
        {children}
      </Step>
    </AnimatePresence>
  );
}

/** A leaving step is `inert`: no click or key press can land on it while it animates out. */
function Step({ dir, children }: { dir: 1 | -1; children: ReactNode }) {
  const reduced = useReduced();
  const present = useIsPresent();
  return (
    <m.div className="step-motion" inert={!present} custom={dir} variants={stepVariants(reduced)} initial="enter" animate="center" exit="exit">
      <Fresh>{children}</Fresh>
    </m.div>
  );
}

/**
 * Top-level screens animate IN only: the previous screen unmounts in the same commit, so locking, the idle wipe and
 * the PRF wipe on leaving a flow are never delayed by an exit animation.
 */
export function ScreenTransition({ id, dir, children }: { id: string; dir: 1 | -1; children: ReactNode }) {
  const reduced = useReduced();
  const first = useRef(true);
  const initial = first.current ? false : 'enter';
  first.current = false;
  return (
    <m.div key={id} className="step-motion" custom={dir} variants={stepVariants(reduced)} initial={initial} animate="center">
      {children}
    </m.div>
  );
}

/** One-off shake for an error that just appeared (driven by the error's mount, i.e. the real failure). */
export function Shake({ className, children, ...rest }: { className: string; children: ReactNode; role?: string }) {
  const reduced = useReduced();
  const s = shake(reduced);
  return (
    <m.div className={className} animate={s.animate} transition={s.transition} {...rest}>
      {children}
    </m.div>
  );
}

export function SlideIn({ children }: { children: ReactNode }) {
  const v = slideIn(useReduced());
  return (
    <m.div initial={v.initial} animate={v.animate} transition={v.transition}>
      {children}
    </m.div>
  );
}

/** Decorative "waiting for your key" pulse ring. */
export function Pulse() {
  const p = pulse(useReduced());
  return <m.span className="key-pulse" animate={p.animate} transition={p.transition} />;
}

/** Self-drawing ✓ (decorative; the state is always in the adjacent text). */
export function Check({ className = 'check-mark' }: { className?: string }) {
  const v = keyCheck(useReduced());
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <m.path d="m6 12.5 4 4 8-9" initial={v.initial} animate={v.animate} transition={v.transition} />
    </svg>
  );
}

/** A key slot that fills with a spring when its key is really set up. */
export function KeySlot({ children }: { children: ReactNode }) {
  const v = slotFill(useReduced());
  return (
    <m.li className="key-ready" initial={v.initial} animate={v.animate} transition={v.transition}>
      <span className="key-slot-badge">
        <Check />
      </span>
      {children}
    </m.li>
  );
}

/**
 * List items and disclosures: a top-down clip reveal + fade on enter; removal is immediate. Never a layout tween
 * (fix-floating-bar-focus): a growing row kept pushing content after a field was focused and scrolled clear of the
 * floating action bar, hiding it again (WCAG 2.4.11). Reduced motion: no animation at all.
 */
export function Collapse({ children, as = 'div', ...rest }: { children: ReactNode; as?: 'div' | 'li'; id?: string; className?: string }) {
  const C = as === 'li' ? m.li : m.div;
  // Belt and braces: if a parent presence ever keeps a removed row mounted for a frame, it can't take input.
  const present = useIsPresent();
  const reduced = useReduced();
  return (
    <C
      initial={reduced ? false : collapse.initial}
      animate={collapse.animate}
      transition={reduced ? { duration: 0 } : collapse.transition}
      inert={!present}
      {...rest}
    >
      <Fresh>{children}</Fresh>
    </C>
  );
}

/** Disclosure (replaces <details>): a real button with aria-expanded/aria-controls and an animated height. */
export function Disclosure({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="notice-details">
      <Btn type="button" className="disclosure" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen((o) => !o)}>
        <span className="disclosure-chevron" aria-hidden="true" />
        {label}
      </Btn>
      <AnimatePresence initial={false}>
        {open && (
          <Collapse id={id} className="disclosure-panel">
            {children}
          </Collapse>
        )}
      </AnimatePresence>
    </div>
  );
}

export type ProgressStage = 'encrypted' | 'sponsored' | 'sent' | 'confirmed' | 'arweave';
export const SAVE_STAGES: readonly ProgressStage[] = ['encrypted', 'sponsored', 'sent', 'confirmed', 'arweave'];
const SLOW_MS = 10_000;

/** A small CSS spinner; a static ring under reduced motion (global.css). Decorative. */
export function Spinner() {
  return <span className="spinner" aria-hidden="true" />;
}

/**
 * True once `on` has held for `ms` (no flicker on short waits). Restarts from zero whenever `on` drops or `key`
 * changes (review H1: the cleanup clears the state, so a second use on the same mount waits again).
 */
export function useAfter(on: boolean, ms: number, key: unknown = 0): boolean {
  const [late, setLate] = useState<unknown>(null);
  const token = on ? key : null;
  useEffect(() => {
    if (!on) return;
    const t = setTimeout(() => setLate(() => token), ms);
    return () => {
      clearTimeout(t);
      setLate(null);
    };
  }, [on, ms, token]);
  return on && late === token;
}

/** Lazy-part fallback (progress-feedback D5): nothing for 300 ms, then a spinner and the text. */
export function Loading({ text }: { text: string }) {
  const shown = useAfter(true, 300);
  return (
    <p className="hint loading" role="status">
      {shown && (
        <>
          <Spinner />
          {text}
        </>
      )}
    </p>
  );
}

const MARK = { done: 'done', current: 'current', failed: 'stoppedMark', todo: 'pending' } as const;
type StageState = keyof typeof MARK;
/** A step's icon: check, spinner, error mark or the neutral dot (decorative; the state is also given as text). */
const icon = (state: StageState) => (
  <span className="stage-icon" aria-hidden="true">
    {state === 'done' ? <Check /> : state === 'current' ? <Spinner /> : state === 'failed' ? '!' : <span className="stage-dot" />}
  </span>
);

/**
 * progress-feedback D1: the one progress view for every save and wait. `done` counts finished steps and moves only on
 * real callbacks (never a timer); `failed` stops the bar at the step in progress. `extra` is a line under the steps.
 */
export function Progress({ label, listLabel, steps, done, failed, extra }: { label: string; listLabel: string; steps: readonly string[]; done: number; failed?: boolean | undefined; extra?: ReactNode }) {
  const reduced = useReduced();
  const total = steps.length;
  const at = Math.min(done, total - 1);
  const finished = done >= total && !failed;
  // Review L5: a stopped save is shown where the user is looking.
  const card = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (failed) card.current?.scrollIntoView?.({ block: 'nearest' });
  }, [failed]);
  const slow = useAfter(!finished && !failed, SLOW_MS, done);
  const text = finished ? S.progress.complete : failed ? S.progress.stopped(steps[at]!) : S.progress.step(at + 1, total, steps[at]!);
  return (
    <div className="progress card" ref={card}>
      {/* Visible "Step N of M: …"; the polite announcement changes only with the step, and stays quiet on "Touch your key",
          where the key prompt already speaks (review M2). */}
      <p className="progress-text" aria-hidden="true">
        {text}
      </p>
      <p className="sr-only" aria-live="polite">
        {steps[at] === S.progress.key && !failed ? '' : text}
      </p>
      <div className="progress-track" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={total} aria-valuenow={Math.min(done, total)} aria-valuetext={text}>
        <m.span className="progress-fill" initial={false} animate={{ scaleX: Math.min(done, total) / total }} transition={{ duration: reduced ? 0 : 0.3 }} />
      </div>
      <ol className="progress-list" aria-label={listLabel}>
        {steps.map((s, i) => {
          const state: StageState = i < done ? 'done' : i > done ? 'todo' : failed ? 'failed' : 'current';
          return (
            <li key={s} className={`stage stage-${state}`}>
              {icon(state)}
              <span>{s}</span>
              <span className="sr-only">: {S.progress[MARK[state]]}</span>
            </li>
          );
        })}
      </ol>
      {extra}
      {slow && <p className="hint">{S.progress.slow}</p>}
    </div>
  );
}

/** Unlock phases as step indexes (D4): "Touch your key" is 0 until the first phase arrives. */
export const PHASE_STEP = { finding: 1, opening: 2 } as const;

/** Unlock, Reload and Check another key (D4): the open steps, shown only once the wait passes 300 ms. */
export function OpenProgress({ at }: { at: number | null }) {
  const shown = useAfter(at !== null, 300);
  return shown ? <Progress label={S.progress.openLabel} listLabel={S.progress.openSteps} steps={S.progress.open} done={at!} /> : null;
}

/**
 * A save's progress (D2): "Touch your key" first when the save starts with a tap (`tap`), then the write path's
 * stages. The Arweave copy is a background line outside the bar ('failed': not saved yet; MirrorLine has the retry).
 */
export function SaveProgress({ reached, arweave, tap, failed }: { reached: ReadonlySet<ProgressStage>; arweave?: 'pending' | 'saved' | 'failed' | undefined; tap?: boolean; failed?: boolean }) {
  const stages = SAVE_STAGES.slice(0, 4);
  let n = 0;
  while (n < 4 && reached.has(stages[n]!)) n++;
  const steps = stages.map((s) => S.progress[s]);
  const bg: StageState = arweave === 'saved' ? 'done' : arweave === 'failed' ? 'failed' : 'current';
  return (
    <Progress
      label={S.progress.label}
      listLabel={S.progress.steps}
      steps={tap ? [S.progress.key, ...steps] : steps}
      done={tap && n > 0 ? n + 1 : n}
      failed={failed}
      extra={
        arweave && (
          <p className={`stage stage-background stage-${bg}`}>
            {icon(bg)}
            <span>
              {S.progress.arweave} <span className="hint">· {S.progress.background}</span>
            </span>
            <span className="sr-only">: {bg === 'failed' ? S.progress.failed : S.progress[MARK[bg]]}</span>
          </p>
        )
      }
    />
  );
}

/** Copy confirmation: a pop chip and the 30 s auto-clear shown as a shrinking bar (plus text). Keyed by a counter. */
export function CopyFeedback() {
  const reduced = useReduced();
  const p = pop(reduced);
  const c = countdown(CLIPBOARD_CLEAR_MS);
  return (
    <div className="copy-feedback" aria-hidden="true">
      <m.span className="copy-chip" initial={p.initial} animate={p.animate} transition={p.transition}>
        <Check className="copy-check" />
        {S.vault.copiedChip}
      </m.span>
      <span className="copy-clear">
        <span className="copy-bar-track">
          {/* Reduced motion: the bar is static and the text carries the information. */}
          <m.span className="copy-bar" initial={c.initial} animate={reduced ? c.initial : c.animate} transition={c.transition} />
        </span>
        <span className="copy-clear-text">{S.vault.clearsIn}</span>
      </span>
    </div>
  );
}

export { AnimatePresence, m };

/** The key-ceremony card enters with a soft drop and leaves with a fade/scale (its text and live region are unchanged). */
export function CeremonyPresence({ children }: { children: ReactNode }) {
  const reduced = useReduced();
  return (
    <AnimatePresence initial={false}>
      {children && (
        <m.div
          key="ceremony"
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.96 }}
          transition={{ duration: 0.2 }}
        >
          {children}
        </m.div>
      )}
    </AnimatePresence>
  );
}
