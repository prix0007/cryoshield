// @vitest-environment node
/** add-privacy-and-compliance 2.2 (spec privacy-compliance "Data-flow inventory matches the build"). */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkOrigins } from '../../scripts/origins-check.mjs';

const inventory = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', '..', 'docs', 'compliance', 'origins.json'), 'utf8'));
const csp = (connect: string, script = "'self'") => `default-src 'none'; script-src ${script}; connect-src 'self' ${connect}; base-uri 'none'`;

describe('origins vs data-flow inventory', () => {
  it('passes for the production origins and lists each with its role', () => {
    const r = checkOrigins(csp('https://sepolia.optimism.io https://api.pimlico.io https://upload.ardrive.io https://arweave.net'), inventory);
    expect(r.missing).toEqual([]);
    expect(r.listed.map((l) => l.origin)).toEqual(['https://sepolia.optimism.io', 'https://api.pimlico.io', 'https://upload.ardrive.io', 'https://arweave.net']);
    expect(r.listed[1]!.role).toMatch(/processor/);
  });

  it('names an origin missing from the inventory (connect-src or script-src)', () => {
    expect(checkOrigins(csp('https://api.pimlico.io https://rpc.unlisted.example'), inventory).missing).toEqual(['https://rpc.unlisted.example']);
    expect(checkOrigins(csp('', "'self' https://cdn.unlisted.example/x.js"), inventory).missing).toEqual(['https://cdn.unlisted.example']);
  });

  it('exempts loopback and .invalid fixture origins', () => {
    expect(checkOrigins(csp('http://127.0.0.1:8545 http://localhost:4337 https://rpc.verify.invalid'), inventory).missing).toEqual([]);
  });
});
