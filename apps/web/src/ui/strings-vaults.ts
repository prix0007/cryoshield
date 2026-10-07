/**
 * Strings of the lazily loaded vault list and Edit vault sheet (vault-list-labels-archive D4, D5, D13). Kept out of
 * strings.ts so they ship in the VaultsMenu chunk; the same plain-language rules apply (guards.test.tsx).
 * Never interpolates a vault name or a label: those are rendered as separate, isolated (<bdi>) text.
 */
import { S } from './strings';

export const VAULTS = {
  title: 'Your vaults',
  pickerIntro: 'This key opens more than one vault. Choose one to open.',
  archivedOnly: 'This key’s vault is archived.',
  unnamed: 'Unnamed vault',
  active: 'Active',
  archived: 'Archived',
  older: 'Older test vault',
  newer: 'Made by a newer version of CryoShield',
  groupActive: 'Active vaults',
  groupArchived: 'Archived vaults',
  groupOlder: 'Older test vaults',
  groupNewer: 'Vaults this version can’t open',
  showArchived: (n: number) => `Show archived (${n})`,
  showOlder: 'Open an older test vault',
  items: (n: number) => `${n} secret${n === 1 ? '' : 's'}`,
  keys: (n: number) => (n === 1 ? '1 key' : `any 1 of ${n} keys`),
  more: (n: number) => `+${n} more`,
  labels: 'Secrets:',
  created: 'Created',
  saved: 'Last saved',
  unavailable: 'Date unavailable',
  loadingDates: 'Loading dates…',
  open: 'Open',
  edit: 'Edit vault',
  checkAnother: 'Check another key',
  checking: 'Touch another key. Its vaults are added to this list.',
  nothingNew: 'That key didn’t open any other vault.',
  back: 'Back to the vault',
  lock: 'Lock',

  sheet: {
    title: 'Edit vault',
    name: 'Vault name (optional)',
    nameHint: S.create.nameHint,
    nameInvalid: S.create.nameInvalid,
    archive: 'Archive this vault',
    archiveHint: 'An archived vault is still listed and still opens. It just moves to “Archived”.',
    anyKey: 'Any one of this vault’s keys can rename, archive or clear it.',
    save: 'Save',
    cancel: 'Cancel',
  },

  clear: {
    open: 'Archive and clear…',
    title: 'Archive and clear',
    intro: 'This archives the vault and saves it with no secrets in it. It keeps its name and its size.',
    points: [
      'Earlier versions of this vault stay in public chain history and on Arweave, forever. Nobody, including CryoShield, can delete them.',
      'Anyone who holds any of this vault’s keys and its PIN can still read those earlier versions.',
      'To really retire a secret, change it at its source: for example, move the funds or create new recovery codes.',
    ],
    confirm: 'I understand old versions stay readable',
    button: 'Archive and clear',
    cancel: 'Keep my secrets',
  },
} as const;
