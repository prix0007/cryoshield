/**
 * Key-ceremony and error titles (redesign-landing-and-app-ui D7). A pure lookup from an EXISTING user-facing
 * message to a short state title, so flows keep calling setError(messageFor(e)) unchanged.
 */
import { S } from './strings';

const TITLES: [string, readonly (string | undefined)[]][] = [
  ['Wrong key', [S.keyErrors.WRONG_KEY, S.keyErrors.DUPLICATE_KEY, S.edit.notInVault]],
  ['PIN needed', [S.keyErrors.USER_NOT_VERIFIED]],
  ['Key not supported', [S.keyErrors.CRED_PROTECT_UNSUPPORTED, S.enrollCancelled, S.keyErrors.PRF_UNSUPPORTED_KEY, S.keyErrors.WRONG_ALGORITHM, S.keyErrors.PRF_UNSUPPORTED_BROWSER, S.browserUnsupported]],
  ['Request cancelled', [S.keyErrors.CANCELLED]],
  ['Saving is paused', [S.save.paused, S.save.pausedCreate]],
  ['Can’t reach the network', [S.unlock.networkError]],
  ['Wrong network', [S.wrongNetwork]],
  ['Site set up incorrectly', [S.misconfigured, S.keyErrors.MISCONFIGURED]],
  ['Setup needs your keys again', [S.create.idleReset, S.create.freshKeys, S.create.retrying]],
  ['Too much to store', [S.save.tooLarge, S.save.tooMany]],
  ['Nothing was saved', [S.save.nothingSaved, S.save.notConfirmed, S.keyErrors.PRF_UNAVAILABLE]],
];

export const ERROR_FALLBACK_TITLE = 'Something went wrong';

export function noticeTitle(message: string): string {
  for (const [title, messages] of TITLES) if (messages.includes(message)) return title;
  return ERROR_FALLBACK_TITLE;
}

export const CEREMONY_WAITING = 'Touch your key';
