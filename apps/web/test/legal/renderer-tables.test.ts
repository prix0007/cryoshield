// @vitest-environment node
/**
 * add-mobile-e2e D5.3 (spec vault-web-app "Phone viewport support"): on a phone the legal and /devices tables scroll
 * inside their .table-wrap. A scroll container with no focusable content cannot be scrolled from the keyboard (axe
 * scrollable-region-focusable, WCAG 2.1.1), so every wrapper is a focusable, named region, like /architecture's figures.
 */
import { describe, expect, it } from 'vitest';
import { inventoryTable, preferencesTable, renderMarkdown, type StorageInventory } from '../../vite-plugins/legal';

const TABLE = '| A | B |\n| --- | --- |\n| 1 | 2 |';

describe('legal renderer: table wrappers are focusable, named regions', () => {
  it('a Markdown table is labelled by the heading of its section', () => {
    const html = renderMarkdown(`## First part\n\ntext\n\n### Who we share with\n\n${TABLE}`);
    expect(html).toContain('<h3 id="who-we-share-with">Who we share with</h3>');
    expect(html).toContain('<div class="table-wrap" tabindex="0" role="region" aria-labelledby="who-we-share-with"><table>');
  });

  it('a table before any heading still gets a name', () => {
    expect(renderMarkdown(TABLE)).toContain('<div class="table-wrap" tabindex="0" role="region" aria-label="Table"><table>');
  });

  it('the generated /cookies tables are named regions', () => {
    const inv: StorageInventory = {
      routes: { '/': { cookies: [], localStorage: [], sessionStorage: [], indexedDB: [], cacheStorage: [], serviceWorkers: [] } },
      preferences: [{ key: 'k', storage: 'localStorage', values: ['dark'], where: 'Every page', purpose: 'Theme', saved: 'When chosen', lifetime: 'Until cleared' }],
      thirdParty: [],
    };
    expect(inventoryTable(inv)).toMatch(/^<div class="table-wrap" tabindex="0" role="region" aria-label="What each page stores on your device"><table/);
    expect(preferencesTable(inv)).toMatch(/^<div class="table-wrap" tabindex="0" role="region" aria-label="What is saved only if you choose it"><table/);
  });
});
