/**
 * Motion components for /app (app-motion-ux). Decoration only: nothing here is awaited by a flow, and no secret,
 * PRF output, key or address is ever passed in as an animated value or used as an animation key.
 */
import { useId, useRef, useState, type ReactNode } from 'react';
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

/** Height + opacity enter/exit for list items and disclosures (`layout` needs domMax: design D2). */
export function Collapse({ children, as = 'div', ...rest }: { children: ReactNode; as?: 'div' | 'li'; id?: string; className?: string }) {
  const C = as === 'li' ? m.li : m.div;
  // A leaving row is inert, so nothing typed during its exit can land on it (or on the row that took its place).
  const present = useIsPresent();
  // Height is not a transform, so MotionConfig would still animate it: reduced motion opens and closes instantly.
  const transition = useReduced() ? { duration: 0 } : collapse.transition;
  return (
    <C initial={{ ...collapse.initial, overflow: 'hidden' }} animate={{ ...collapse.animate, transitionEnd: { overflow: 'visible' } }} exit={{ ...collapse.exit, overflow: 'hidden' }} transition={transition} inert={!present} {...rest}>
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

/**
 * The save checklist. A stage is checked ONLY when the write path reported it (`reached`); nothing advances on a
 * timer. `arweave` reflects the mirror result ('failed' shows as not saved yet; MirrorLine has the retry).
 */
export function SaveProgress({ reached, arweave }: { reached: ReadonlySet<ProgressStage>; arweave?: 'pending' | 'saved' | 'failed' }) {
  const stages = arweave ? SAVE_STAGES : SAVE_STAGES.filter((s) => s !== 'arweave');
  const isDone = (s: ProgressStage) => (s === 'arweave' ? arweave === 'saved' : reached.has(s));
  const latest = [...stages].reverse().find(isDone);
  return (
    <div className="save-progress card">
      <ol className="progress-list" aria-label={S.progress.label}>
        {stages.map((s) => {
          const done = isDone(s);
          const failed = s === 'arweave' && arweave === 'failed';
          return (
            <li key={s} className={done ? 'stage stage-done' : failed ? 'stage stage-failed' : 'stage'}>
              <span className="stage-icon" aria-hidden="true">
                {done ? <Check /> : <span className="stage-dot" />}
              </span>
              <span>{S.progress[s]}</span>
              <span className="sr-only">: {done ? S.progress.done : failed ? S.progress.failed : S.progress.pending}</span>
            </li>
          );
        })}
      </ol>
      <p className="sr-only" aria-live="polite">
        {latest ? `${S.progress[latest]}: ${S.progress.done}` : ''}
      </p>
    </div>
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
