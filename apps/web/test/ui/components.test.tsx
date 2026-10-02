/** redesign-landing-and-app-ui 4.1 (spec app-visual-design): presentational components of the restyled app. */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ActionBar, EmptyState, GlobalNav, SubNav } from '../../src/ui/chrome';
import { KeyPrompt, Notice } from '../../src/ui/components';
import { noticeTitle } from '../../src/ui/ceremony';
import { S } from '../../src/ui/strings';

describe('GlobalNav', () => {
  it('is a labelled navigation landmark with the wordmark linking to the explainer, and a native menu', () => {
    const { container } = render(<GlobalNav />);
    const nav = screen.getByRole('navigation', { name: 'Site' });
    expect(within(nav).getByRole('link', { name: 'CryoShield home' })).toHaveAttribute('href', '/');
    expect(within(nav).getAllByRole('link', { name: 'How it works' })[0]).toHaveAttribute('href', '/#how');
    expect(container.querySelector('details.nav-menu > summary[aria-label="Menu"]')).not.toBeNull();
    expect(within(nav).queryAllByRole('button')).toEqual([]); // never duplicates a vault action name
  });
});

describe('SubNav', () => {
  it('names the surface and shows the Testnet chip', () => {
    render(<SubNav name="Your vault" />);
    expect(screen.getByText('Your vault')).toHaveClass('sub-nav-name');
    expect(screen.getByText('Testnet')).toHaveClass('chip');
  });
});

describe('ActionBar', () => {
  it('keeps its children in document order inside the floating bar', () => {
    render(
      <ActionBar>
        <button>First</button>
        <button>Second</button>
      </ActionBar>,
    );
    const bar = screen.getByRole('button', { name: 'First' }).parentElement!;
    expect(bar).toHaveClass('action-bar');
    expect([...bar.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['First', 'Second']);
  });
});

describe('Notice', () => {
  it('error: an alert with an icon, a title derived from the message, and the unchanged message', () => {
    render(<Notice kind="error">{S.keyErrors.WRONG_KEY}</Notice>);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveClass('notice-error');
    expect(alert.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    expect(within(alert).getByText('Wrong key')).toHaveClass('notice-title');
    expect(within(alert).getByText(S.keyErrors.WRONG_KEY!)).toBeInTheDocument();
  });

  it('info and success are status regions; an explicit title wins', () => {
    render(
      <>
        <Notice kind="success">{S.save.saved}</Notice>
        <Notice kind="info" title="Heads up">x</Notice>
      </>,
    );
    expect(screen.getAllByRole('status')).toHaveLength(2);
    expect(screen.getByText('Heads up')).toHaveClass('notice-title');
  });
});

describe('noticeTitle (key-ceremony states)', () => {
  it.each([
    [S.keyErrors.WRONG_KEY, 'Wrong key'],
    [S.keyErrors.DUPLICATE_KEY, 'Wrong key'],
    [S.edit.notInVault, 'Wrong key'],
    [S.keyErrors.USER_NOT_VERIFIED, 'PIN needed'],
    [S.keyErrors.PRF_UNSUPPORTED_KEY, 'Key not supported'],
    [S.keyErrors.WRONG_ALGORITHM, 'Key not supported'],
    [S.keyErrors.PRF_UNSUPPORTED_BROWSER, 'Key not supported'],
    [S.keyErrors.CANCELLED, 'Request cancelled'],
    [S.save.paused, 'Saving is paused'],
    [S.unlock.networkError, 'Can’t reach the network'],
    ['anything else', 'Something went wrong'],
  ])('%s -> %s', (msg, title) => {
    expect(noticeTitle(msg!)).toBe(title);
  });
});

describe('KeyPrompt (ceremony panel)', () => {
  it('shows the "Touch your key" state, the existing text in a live region, and an optional Continue', async () => {
    const onContinue = vi.fn();
    render(<KeyPrompt text={S.create.insertKey(1)} onContinue={onContinue} />);
    const panel = screen.getByRole('status');
    expect(panel).toHaveClass('key-prompt');
    expect(panel).toHaveAttribute('aria-live');
    expect(within(panel).getByText('Touch your key')).toBeInTheDocument();
    expect(within(panel).getByText(S.create.insertKey(1))).toBeInTheDocument();
    expect(panel.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    await userEvent.click(screen.getByRole('button', { name: S.continue }));
    expect(onContinue).toHaveBeenCalled();
  });
});

describe('EmptyState', () => {
  it('renders a plain empty-state card', () => {
    render(<EmptyState>{S.vault.empty}</EmptyState>);
    expect(screen.getByText(S.vault.empty)).toBeInTheDocument();
    expect(screen.getByText(S.vault.empty).closest('.empty-state')).toHaveClass('card');
  });
});
