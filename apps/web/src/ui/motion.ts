/**
 * Motion vocabulary for /app (app-motion-ux D3). Pure factories of decoration-only targets: offsets, opacity, blur,
 * scale. Nothing here ever receives or produces secret material, and nothing here is awaited by a flow.
 * `reduced` variants are opacity-only (MotionConfig reducedMotion="user" also drops transforms).
 */
import type { Transition, Variants } from 'motion/react';

export const STEP_SECONDS = 0.22;
const EASE = [0.22, 1, 0.36, 1] as const;
const SLIDE_PX = 24;

/** +1 forward, -1 back, from the position of two steps in a flow's order. */
export function directionOf<T>(order: readonly T[], from: T, to: T): 1 | -1 {
  return order.indexOf(to) < order.indexOf(from) ? -1 : 1;
}

/** Direction-aware slide + fade for AnimatePresence mode="wait" (pass the direction as `custom`). */
export function stepVariants(reduced: boolean): Variants {
  const t: Transition = { duration: STEP_SECONDS, ease: EASE };
  if (reduced) return { enter: { opacity: 0 }, center: { opacity: 1, transition: t }, exit: { opacity: 0, transition: t } };
  return {
    enter: (d: number) => ({ x: SLIDE_PX * d, opacity: 0 }),
    center: { x: 0, opacity: 1, transition: t },
    exit: (d: number) => ({ x: -SLIDE_PX * d, opacity: 0, transition: t }),
  };
}

interface OneShot {
  initial: Record<string, number | string>;
  animate: Record<string, number | string | number[]>;
  transition: Transition;
}

/** One-off horizontal shake for an error that just appeared. */
export function shake(reduced: boolean): { animate: Record<string, number[]>; transition: Transition } {
  if (reduced) return { animate: { opacity: [0, 1] }, transition: { duration: 0.15 } };
  return { animate: { x: [0, -8, 8, -6, 6, -3, 0] }, transition: { duration: 0.4, ease: 'easeOut' } };
}

/** The message sliding in under a ceremony/error title. */
export function slideIn(reduced: boolean): OneShot {
  return reduced
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { duration: 0.15 } }
    : { initial: { opacity: 0, y: 6 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.25, ease: EASE, delay: 0.08 } };
}

/** A key slot filling once its key is really set up. */
export function slotFill(reduced: boolean): OneShot {
  return reduced
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { duration: 0.15 } }
    : { initial: { opacity: 0, scale: 0.6 }, animate: { opacity: 1, scale: 1 }, transition: { type: 'spring', stiffness: 420, damping: 22 } };
}

/** The ✓ path drawing itself inside a filled slot. */
export function keyCheck(reduced: boolean): OneShot {
  return reduced
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { duration: 0.15 } }
    : { initial: { pathLength: 0 }, animate: { pathLength: 1 }, transition: { duration: 0.35, ease: 'easeOut', delay: 0.1 } };
}

/** Copy confirmation chip. */
export function pop(reduced: boolean): OneShot {
  return reduced
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { duration: 0.15 } }
    : { initial: { opacity: 0, scale: 0.7 }, animate: { opacity: 1, scale: 1 }, transition: { type: 'spring', stiffness: 520, damping: 18 } };
}

/** De-blur of text the user explicitly asked to show (the text itself is children, never a value here). */
export function reveal(reduced: boolean): OneShot {
  return reduced
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { duration: 0.15 } }
    : { initial: { opacity: 0, filter: 'blur(8px)' }, animate: { opacity: 1, filter: 'blur(0px)' }, transition: { duration: 0.35, ease: EASE } };
}

/** Clipboard auto-clear countdown bar (spans exactly the real clear timer; the timer itself lives in clipboard.ts). */
export function countdown(ms: number): OneShot {
  return { initial: { scaleX: 1 }, animate: { scaleX: 0 }, transition: { duration: ms / 1000, ease: 'linear' } };
}

/** Height + opacity for disclosures and list items (enter/exit; `layout` needs domMax, see design D2). */
export const collapse = {
  initial: { height: 0, opacity: 0 },
  animate: { height: 'auto', opacity: 1 },
  exit: { height: 0, opacity: 0 },
  transition: { duration: 0.22, ease: EASE },
} as const;

/** Looping "waiting for your key" pulse on a decorative element. */
export function pulse(reduced: boolean): { animate: Record<string, number[]>; transition: Transition } {
  return reduced
    ? { animate: { opacity: [0.5, 0.9, 0.5] }, transition: { duration: 1.6, repeat: Infinity } }
    : { animate: { scale: [0.85, 1.15, 0.85], opacity: [0.5, 0, 0.5] }, transition: { duration: 1.6, repeat: Infinity, ease: 'easeInOut' } };
}

export const TAP = { scale: 0.95 } as const;
export const HOVER = { y: -1 } as const;
