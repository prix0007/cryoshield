#!/usr/bin/env node
// PR title gate: Conventional Commits (OpenSpec change adopt-pr-workflow, decision 6).
// The title becomes the squash commit on main. CLI reads PR_TITLE from the environment (never from argv,
// so the workflow passes it via env: and no expression is interpolated into the shell).
import { pathToFileURL } from 'node:url';

export const TYPES = ['feat', 'fix', 'docs', 'chore', 'ci', 'build', 'refactor', 'perf', 'test', 'style', 'revert'];
const MAX = 100;
const PATTERN = new RegExp(`^(${TYPES.join('|')})(\\([a-z0-9._/-]+\\))?!?: \\S.*$`);

export function checkTitle(title) {
  if (typeof title !== 'string' || title.trim() === '') return { ok: false, message: 'PR title is empty' };
  if (/[\r\n]/.test(title)) return { ok: false, message: 'PR title must be a single line' };
  if (title.length > MAX) return { ok: false, message: `PR title is ${title.length} characters; keep it to ${MAX} characters` };
  if (!PATTERN.test(title)) {
    return {
      ok: false,
      message:
        `PR title does not follow Conventional Commits: "type(scope)!: subject", lower-case type and scope.\n` +
        `  types: ${TYPES.join(', ')}\n  example: fix(recover): handle empty log page`,
    };
  }
  return { ok: true };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const title = process.env.PR_TITLE ?? '';
  const r = checkTitle(title);
  if (!r.ok) {
    console.error(`::error title=PR title::${r.message.split('\n')[0]}`);
    console.error(r.message);
    process.exit(1);
  }
  console.log(`PR title OK: ${title}`);
}
