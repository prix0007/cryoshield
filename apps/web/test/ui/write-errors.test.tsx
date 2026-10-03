/** improve-write-failure-feedback 1.1: create-time sponsorship copy and the sanitized error reference. */
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { WriteError } from '../../src/account/writes';
import { Notice } from '../../src/ui/components';
import { errorReference, messageFor } from '../../src/ui/operations';
import { S } from '../../src/ui/strings';

/** Shaped like viem's RpcRequestError nested under a paymaster wrapper. */
function rpcError(code: number, message: string) {
  const inner = Object.assign(new Error(`RPC Request failed.\n\nURL: https://api.pimlico.io/v2/11155420/rpc?apikey=pim_SECRETKEY\nDetails: ${message}`), {
    name: 'RpcRequestError',
    code,
    details: message,
    shortMessage: 'RPC Request failed.',
  });
  return new WriteError('SPONSORSHIP_REFUSED', { cause: Object.assign(new Error('wrapped'), { cause: inner }) });
}

describe('messageFor (create context)', () => {
  it('a refused sponsorship on create says nothing was saved, without "existing vault"', () => {
    const m = messageFor(new WriteError('SPONSORSHIP_REFUSED'), 'create');
    expect(m).toBe('Nothing was saved. Please try again later.');
    expect(m).not.toMatch(/existing vault/);
  });

  it('edits keep the paused copy', () => {
    expect(messageFor(new WriteError('SPONSORSHIP_REFUSED'))).toBe(S.save.paused);
    expect(messageFor(new WriteError('SPONSORSHIP_REFUSED'), 'edit')).toBe(S.save.paused);
  });
});

describe('errorReference', () => {
  it('extracts our code plus the JSON-RPC code and message, with long hex elided', () => {
    const ref = errorReference(rpcError(-32500, 'policy cap reached for 0x1234567890abcdef1234567890abcdef12345678'));
    expect(ref).toBe('SPONSORSHIP_REFUSED · RPC -32500 · policy cap reached for 0x…');
  });

  it('never contains URLs, API keys or long hex, and is capped', () => {
    const ref = errorReference(rpcError(-32603, `boom https://evil.example/x?apikey=pim_SECRETKEY sig 0x${'ab'.repeat(65)} ${'x'.repeat(400)}`))!;
    expect(ref).not.toMatch(/https?:|apikey|pim_|SECRETKEY/);
    expect(ref).not.toMatch(/0x[0-9a-f]{9,}/i);
    expect(ref.length).toBeLessThanOrEqual(200);
  });

  it('is just the code when there is no RPC error, and undefined for non-write errors', () => {
    expect(errorReference(new WriteError('NOT_CONFIRMED'))).toBe('NOT_CONFIRMED');
    expect(errorReference(new Error('x'))).toBeUndefined();
  });
});

describe('Notice with a reference', () => {
  it('shows a collapsed Details disclosure holding the reference', () => {
    render(<Notice kind="error" reference="SPONSORSHIP_REFUSED · RPC -32500 · cap">{'Nothing was saved. Please try again later.'}</Notice>);
    const alert = screen.getByRole('alert');
    const details = alert.querySelector('details')!;
    expect(details.open).toBe(false);
    expect(within(details).getByText('Details')).toBeInTheDocument();
    expect(within(details).getByText(/SPONSORSHIP_REFUSED/)).toBeInTheDocument();
  });
});
