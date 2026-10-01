import axe from 'axe-core';
import { describe, expect, it } from 'vitest';
import { renderApp } from './helpers';

describe('home screen accessibility (unit-level; full audit in e2e/specs/30-a11y.spec.ts)', () => {
  it('has no axe violations', async () => {
    const { container } = renderApp();
    const r = await axe.run(container, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'], rules: { 'color-contrast': { enabled: false } } });
    expect(r.violations.map((v) => v.id)).toEqual([]);
  });
});
