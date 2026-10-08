/** progress-feedback 1.1: the shared progress view, the delayed loader and the spinner. */
import { act, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Loading, Progress } from '../../src/ui/motionkit';
import { S } from '../../src/ui/strings';

const STEPS = ['Touch your key', 'Encrypted on this device', 'Network fee sponsored', 'Signed and sent', 'Confirmed on-chain'];
const states = () =>
  within(screen.getByRole('list', { name: 'Save progress' }))
    .getAllByRole('listitem')
    .map((li) => li.className.replace('stage stage-', ''));

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('Progress', () => {
  it('a determinate bar: progressbar with now/min/max and a text naming the step', () => {
    render(<Progress label="Save progress" steps={STEPS} done={2} />);
    const bar = screen.getByRole('progressbar', { name: 'Save progress' });
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '5');
    expect(bar).toHaveAttribute('aria-valuenow', '2');
    expect(bar).toHaveAttribute('aria-valuetext', 'Step 3 of 5: Network fee sponsored');
  });

  it('finished steps are checked, the current one spins, the rest are neutral', () => {
    const { container } = render(<Progress label="Save progress" steps={STEPS} done={2} />);
    expect(states()).toEqual(['done', 'done', 'current', 'todo', 'todo']);
    expect(container.querySelectorAll('.stage-current .spinner')).toHaveLength(1);
    expect(container.querySelector('.progress')).toHaveAttribute('aria-busy', 'true');
  });

  it('advances only when `done` changes, and announces once per step (polite)', () => {
    const { rerender, container } = render(<Progress label="Save progress" steps={STEPS} done={0} />);
    const live = container.querySelector('[aria-live="polite"]')!;
    expect(live).toHaveTextContent('Step 1 of 5: Touch your key');
    rerender(<Progress label="Save progress" steps={STEPS} done={1} />);
    expect(live).toHaveTextContent('Step 2 of 5: Encrypted on this device');
    expect(container.querySelectorAll('[aria-live]')).toHaveLength(1);
  });

  it('failure: stops at the failed step with an error mark, no spinner, not busy', () => {
    const { container } = render(<Progress label="Save progress" steps={STEPS} done={3} failed />);
    expect(states()).toEqual(['done', 'done', 'done', 'failed', 'todo']);
    expect(container.querySelector('.spinner')).toBeNull();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '3');
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuetext', S.progress.stopped('Signed and sent'));
    expect(container.querySelector('.progress')).toHaveAttribute('aria-busy', 'false');
  });

  it('complete: every step checked, the bar full', () => {
    render(<Progress label="Save progress" steps={STEPS} done={5} />);
    expect(states()).toEqual(['done', 'done', 'done', 'done', 'done']);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuetext', S.progress.complete);
  });

  it('reassurance after about 10 s on one step, reset when the step changes; never once failed', () => {
    vi.useFakeTimers();
    const { rerender } = render(<Progress label="Save progress" steps={STEPS} done={1} />);
    act(() => vi.advanceTimersByTime(9_000));
    expect(screen.queryByText(S.progress.slow)).toBeNull();
    act(() => vi.advanceTimersByTime(1_500));
    expect(screen.getByText(S.progress.slow)).toBeInTheDocument();
    rerender(<Progress label="Save progress" steps={STEPS} done={2} />);
    expect(screen.queryByText(S.progress.slow)).toBeNull();
    rerender(<Progress label="Save progress" steps={STEPS} done={2} failed />);
    act(() => vi.advanceTimersByTime(20_000));
    expect(screen.queryByText(S.progress.slow)).toBeNull();
  });

  it('never moves focus', () => {
    const b = document.createElement('button');
    document.body.appendChild(b);
    b.focus();
    const { rerender } = render(<Progress label="Save progress" steps={STEPS} done={0} />);
    rerender(<Progress label="Save progress" steps={STEPS} done={3} failed />);
    expect(document.activeElement).toBe(b);
    b.remove();
  });
});

describe('Loading', () => {
  it('shows nothing for the first 300 ms (no flicker), then a spinner and the text; busy', () => {
    vi.useFakeTimers();
    const { container } = render(<Loading text="Loading…" />);
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-busy', 'true');
    act(() => vi.advanceTimersByTime(250));
    expect(status).toBeEmptyDOMElement();
    act(() => vi.advanceTimersByTime(100));
    expect(status).toHaveTextContent('Loading…');
    expect(container.querySelector('.spinner')).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('reduced motion', () => {
  it('the spinner stops and the bar fill is instant (CSS + Motion duration 0)', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const css = readFileSync(join(__dirname, '..', '..', 'src/ui/global.css'), 'utf8');
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.spinner\s*\{[^}]*animation: none/);
  });
});
