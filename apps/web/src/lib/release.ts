/**
 * footer-release-version D4: which release this site serves, read from /release.json at runtime. The build never knows
 * its tag: the deployed tree must be a pure function of the commit (web-build-integrity), and a tag is not part of the
 * commit. So the footer asks the site, strictly: only the documented shape is accepted, and anything else is "unknown"
 * (null), in which case the footer shows no Version line at all.
 *
 * D5: the landing page carries its own copy of this parsing and labelling in src/landing/release.ts. A module imported
 * by both pages would become a chunk both load, which verify-build forbids. test/landing/release.test.ts holds the two
 * to the same answers.
 */
export interface ReleaseInfo {
  /** The deployed commit (40 lower-case hex). */
  commit: string;
  /** The release tag on production (vX.Y.Z, optional -prerelease); null on the development site. */
  release: string | null;
}
export interface ReleaseLabel {
  text: string;
  href: string;
}
export interface ReleaseEnv {
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
  timeoutMs?: number;
}

const REPO = 'https://github.com/prix0007/cryoshield';
// The pipeline's tag grammar (.github/scripts/deploy/release-ref.sh): letters, digits, '.', '-' only.
const TAG_RE = /^v\d+\.\d+\.\d+(-[0-9A-Za-z][0-9A-Za-z.-]*)?$/;
const COMMIT_RE = /^[0-9a-f]{40}$/;
const TIMEOUT_MS = 4000;

/** The identity, or null unless the body has a 40-hex commit and a release that is null or a well-formed tag. */
export function parseRelease(body: unknown): ReleaseInfo | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
  const { commit, release } = body as Record<string, unknown>;
  if (typeof commit !== 'string' || !COMMIT_RE.test(commit)) return null;
  if (release === null) return { commit, release: null };
  if (typeof release !== 'string' || !TAG_RE.test(release)) return null;
  return { commit, release };
}

/** "v1.0.3" linking to the GitHub release, or "dev <7 hex>" linking to the commit. Values are validated already. */
export function releaseLink({ commit, release }: ReleaseInfo): ReleaseLabel {
  return release ? { text: release, href: `${REPO}/releases/tag/${release}` } : { text: `dev ${commit.slice(0, 7)}`, href: `${REPO}/commit/${commit}` };
}

/** Same-origin, uncached, bounded; null (unknown) on any failure, never a throw. */
export async function fetchRelease(env: ReleaseEnv = { fetch: (u, i) => fetch(u, i) }): Promise<ReleaseInfo | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), env.timeoutMs ?? TIMEOUT_MS);
  try {
    const res = await env.fetch('/release.json', { method: 'GET', cache: 'no-store', credentials: 'same-origin', signal: ctrl.signal });
    if (!res.ok) return null;
    return parseRelease(await res.json());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
