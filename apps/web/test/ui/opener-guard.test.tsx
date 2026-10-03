/** add-privacy-preserving-analytics 4.6 (spec landing-analytics "App refuses a same-origin opener"). */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { OpenerBlocked, openedByScript } from '../../src/ui/OpenerGuard';

describe('opener guard', () => {
  it('detects a window opened by script (non-null opener)', () => {
    expect(openedByScript({ opener: {} } as unknown as Window)).toBe(true);
    expect(openedByScript({ opener: null } as unknown as Window)).toBe(false);
  });

  it('asks the user to open CryoShield directly, via a fresh no-opener tab, and touches no service', () => {
    const create = vi.fn();
    const get = vi.fn();
    Object.defineProperty(navigator, 'credentials', { value: { create, get }, configurable: true });
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    render(<OpenerBlocked />);
    expect(screen.getByRole('heading', { name: 'Open CryoShield directly' })).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /Open CryoShield in a new tab/ });
    expect(link).toHaveAttribute('href', '/app/');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
    expect(create).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
