/** app-motion-ux 1.1: pure, state-driven variant factories. */
import { describe, expect, it } from 'vitest';
import { CLIPBOARD_CLEAR_MS } from '../../src/ui/clipboard';
import { collapse, countdown, directionOf, keyCheck, pop, pulse, reveal, shake, slotFill, stepVariants, STEP_SECONDS, TAP } from '../../src/ui/motion';

const TRANSFORM_KEYS = ['x', 'y', 'scale', 'scaleX', 'scaleY', 'rotate', 'filter'];
const keysOf = (v: unknown) => Object.keys((typeof v === 'function' ? (v as (d: number) => object)(1) : v) as object);

describe('step variants', () => {
  it('slide in the direction of travel and fade', () => {
    const v = stepVariants(false);
    const enter = (d: number) => (v.enter as (d: number) => { x: number; opacity: number })(d);
    expect(enter(1).x).toBeGreaterThan(0);
    expect(enter(-1).x).toBeLessThan(0);
    expect(enter(1).opacity).toBe(0);
    expect((v.exit as (d: number) => { x: number })(1).x).toBeLessThan(0);
    expect(v.center).toMatchObject({ x: 0, opacity: 1 });
  });
  it('reduced motion: opacity only, no transforms', () => {
    const v = stepVariants(true);
    for (const k of ['enter', 'center', 'exit'] as const) expect(keysOf(v[k]).filter((x) => TRANSFORM_KEYS.includes(x))).toEqual([]);
  });
  it('direction follows step order', () => {
    const order = ['intro', 'keys', 'secrets'] as const;
    expect(directionOf(order, 'intro', 'keys')).toBe(1);
    expect(directionOf(order, 'secrets', 'keys')).toBe(-1);
    expect(directionOf(order, 'keys', 'keys')).toBe(1);
  });
  it('is short (decoration only)', () => expect(STEP_SECONDS).toBeLessThanOrEqual(0.3));
});

describe('feedback variants', () => {
  it('error shake moves horizontally and settles at 0; reduced does not move', () => {
    const s = shake(false).animate as { x: number[] };
    expect(s.x.at(-1)).toBe(0);
    expect(Math.max(...s.x.map(Math.abs))).toBeGreaterThan(0);
    expect(keysOf(shake(true).animate)).not.toContain('x');
  });
  it('slot fill and copy pop are springs; reduced are opacity only', () => {
    expect(slotFill(false).transition).toMatchObject({ type: 'spring' });
    expect(pop(false).transition).toMatchObject({ type: 'spring' });
    for (const f of [slotFill, pop, reveal, keyCheck]) expect(keysOf(f(true).initial).filter((x) => TRANSFORM_KEYS.includes(x) || x === 'pathLength')).toEqual([]);
  });
  it('reveal un-blurs presentation only (no content in the variant)', () => {
    const r = reveal(false);
    expect(r.initial).toEqual({ opacity: 0, filter: 'blur(8px)' });
    expect(r.animate).toEqual({ opacity: 1, filter: 'blur(0px)' });
  });
  it('the ✓ draws itself', () => expect(keyCheck(false).animate).toMatchObject({ pathLength: 1 }));
  it('countdown bar spans exactly the clipboard auto-clear time, linearly', () => {
    const c = countdown(CLIPBOARD_CLEAR_MS);
    expect(c.initial).toEqual({ scaleX: 1 });
    expect(c.animate).toEqual({ scaleX: 0 });
    expect(c.transition).toMatchObject({ duration: CLIPBOARD_CLEAR_MS / 1000, ease: 'linear' });
  });
  it('collapse reveals without ever changing layout (fix-floating-bar-focus): clip + opacity in, instant out', () => {
    // A layout-changing tween (height) keeps moving content AFTER a field gets focus, which can push a correctly
    // scrolled field under the floating action bar (WCAG 2.4.11). Only paint properties may animate.
    const LAYOUT = ['height', 'width', 'margin', 'padding', 'top', 'bottom', 'maxHeight', 'minHeight'];
    for (const v of [collapse.initial, collapse.animate]) expect(Object.keys(v).filter((k) => LAYOUT.includes(k))).toEqual([]);
    expect(collapse.initial).toMatchObject({ opacity: 0, clipPath: 'inset(0 0 100% 0)' });
    expect(collapse.animate).toMatchObject({ opacity: 1, clipPath: 'inset(0 0 0% 0)' });
    expect(collapse).not.toHaveProperty('exit'); // removal is immediate: nothing below shifts later
  });
  it('waiting pulse is bounded (under 5 s, WCAG 2.2.2); reduced is a static ring', () => {
    const t = pulse(false).transition as { duration: number; repeat: number };
    expect(Number.isFinite(t.repeat)).toBe(true);
    expect(t.duration * (t.repeat + 1)).toBeLessThanOrEqual(5);
    expect(pulse(true).transition).not.toHaveProperty('repeat');
    expect(keysOf(pulse(true).animate)).toEqual(['opacity']);
  });
  it('press feedback is scale 0.95', () => expect(TAP).toEqual({ scale: 0.95 }));
});
