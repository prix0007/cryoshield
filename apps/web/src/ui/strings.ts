/**
 * Every user-facing string of the default flow. Plain language: no "gas", "wallet", "transaction",
 * "smart account", "bundler", "paymaster" or "ETH" (checked by test/ui/jargon.test.ts).
 */
export const S = {
  appName: 'CryoShield',
  tagline: 'Keep your most important secrets safe, unlocked only by your security keys.',

  home: {
    unlock: 'Unlock my vault',
    create: 'Create a new vault',
    explain:
      'Your secrets are locked with your security keys before they leave this page. Nobody else, including CryoShield, can read them.',
  },

  wrongNetwork:
    'This site is connected to the wrong network, so your vault can’t be read or saved safely. Nothing was changed. Please use the official CryoShield address, or tell the site operator.',
  misconfigured: 'This site is set up incorrectly, so security keys can’t be used here. Please use the official CryoShield address.',
  browserUnsupported:
    'This browser can’t use security keys for encryption. Please use a recent version of Chrome, Edge, or Firefox on a computer, or Safari 26.4 or newer.',
  supportedBrowsers: ['Chrome 118 or newer', 'Edge 118 or newer', 'Firefox 148 or newer', 'Safari 26.4 or newer'],

  keyErrors: {
    CANCELLED: 'The key request was cancelled or timed out. Try again when you’re ready.',
    DUPLICATE_KEY: 'That key is already set up for this vault. Please use a different key.',
    PRF_UNSUPPORTED_KEY:
      'This key is too old or doesn’t support the feature CryoShield needs (YubiKey 5 with firmware 5.2 or newer works). Please try a different key.',
    PRF_UNSUPPORTED_BROWSER: 'This browser can’t use security keys for encryption.',
    PRF_UNAVAILABLE: 'Your key didn’t return what we need. Please try again, or try a different browser.',
    USER_NOT_VERIFIED: 'Your key’s PIN wasn’t checked. Please try again and enter your key’s PIN when asked.',
    WRONG_ALGORITHM: 'This key type isn’t supported. Please use a FIDO2 security key such as a YubiKey 5.',
    WRONG_KEY: 'That’s a different key from the one we asked for. Please touch the key named on screen.',
    MISCONFIGURED: 'This site is set up incorrectly, so security keys can’t be used here.',
    CRED_PROTECT_UNSUPPORTED:
      'This key can’t be set to always ask for its PIN, so anyone who found it could use it without the PIN. CryoShield won’t use it. Please use a newer key (for example a YubiKey 5 with firmware 5.2 or newer) in a recent Chrome or Edge.',
  } as Record<string, string>,
  /** Enrollment only: an enforcing browser reports "key can’t always require its PIN" the same way as a cancel. */
  enrollCancelled:
    'The key request was cancelled or timed out, or this key can’t be set to always ask for its PIN (CryoShield needs that). Try again, or use a newer key such as a YubiKey 5 with firmware 5.2 or newer.',

  create: {
    title: 'Create your vault',
    introTitle: 'How it works',
    intro: [
      'You’ll set up at least two security keys. Either one can open your vault.',
      'Your secrets are locked on this device, then stored permanently in a public place where only your keys can open them.',
      'Keep your keys in different places. If you lose one, the other still works.',
      'Each key needs a PIN. If yours doesn’t have one yet, your browser will help you set it.',
    ],
    start: 'Get started',
    keysTitle: 'Set up your keys',
    keyN: (n: number) => `Key ${n}`,
    addKey: (n: number) => `Set up key ${n}`,
    addAnother: 'Set up another key (optional)',
    insertKey: (n: number) => `Insert key ${n} and touch it when it blinks.`,
    touchAgain: (n: number) => `Touch key ${n} once more to finish setting it up.`,
    keyReady: (n: number) => `Key ${n} is ready.`,
    needSecond: 'Add a second key so you’re never locked out',
    continue: 'Continue',
    secretsTitle: 'Add your secrets',
    savingTitle: 'Saving your vault',
    touchToSave: 'Touch key 1 to save your vault.',
    doneTitle: 'Your vault is saved',
    done: [
      'Your secrets are now stored permanently, and only your keys can open them.',
      'Keep your keys in separate places, for example one at home and one somewhere else safe.',
    ],
    idleReset: 'Setup was cancelled because nothing happened for 5 minutes. For your safety, please set up your keys again.',
  },

  ack: {
    title: 'Before you save',
    permanent:
      'I understand that my encrypted vault, its account address, a locator for each key, the number of keys and their credential IDs are published permanently on a public blockchain and on Arweave, and that nobody, including CryoShield, can delete them.',
    adult: 'I am 18 or over.',
    adultRequired: 'CryoShield is only for people aged 18 or over. You can’t save a vault unless you confirm this.',
    needBoth: 'Tick both boxes to save. Only the locked (encrypted) vault is published; your secrets never leave this device unencrypted.',
  },

  testnet: (network: string) =>
    `Testnet preview: CryoShield runs on ${network}, a test network, and has not been independently audited. Please don’t rely on it as your only backup yet.`,

  editor: {
    label: 'Name',
    labelHint: 'For example “Bitcoin seed” or “GitHub recovery codes”',
    secret: 'Secret',
    addItem: 'Add another secret',
    removeItem: (label: string) => `Remove ${label || 'this secret'}`,
    space: (remaining: number, max: number) => `${Math.max(remaining, 0)} of ${max} characters of space left`,
    tooBig: (over: number) => `Too much text: remove about ${over} characters to save.`,
    save: 'Save',
    cancel: 'Cancel',
    needOne: 'Add at least one secret.',
  },

  unlock: {
    title: 'Unlock your vault',
    touch: 'Insert one of your keys and touch it when it blinks.',
    button: 'Unlock with my key',
    working: 'Opening your vault…',
    notFound: 'We couldn’t find a vault for this key.',
    createInstead: 'Create a vault',
    tryAgain: 'Try again',
    newerVersion: 'This vault was made by a newer version of CryoShield. Please update and try again.',
    several: 'This key opens more than one vault. Choose which one to open:',
    severalWarning:
      'This is unusual. Each of these vaults was created with this key. If you don’t recognise one, open the other, and keep using that one.',
    vaultChoice: (i: number, version: number) => `Vault ${i + 1} (saved ${version} time${version === 1 ? '' : 's'})`,
    networkError: 'We couldn’t reach the network. Check your connection and try again.',
  },

  vault: {
    title: 'Your vault',
    show: 'Show',
    hide: 'Hide',
    copy: 'Copy',
    copied: 'Copied. It will be cleared from your clipboard in 30 seconds.',
    copiedChip: 'Copied',
    clearSkipped: 'This page wasn’t in focus after 30 seconds, so your clipboard was not cleared. Clear it yourself.',
    clearsIn: 'Clipboard clears in 30 s',
    lock: 'Lock',
    edit: 'Edit secrets',
    addKey: 'Add a key',
    details: 'Vault details',
    hidden: '••••••••',
    idleWarning: 'For your safety, your vault will lock in 30 seconds.',
    stillHere: 'I’m still here',
    locked: 'Your vault is locked.',
    empty: 'Your vault has no secrets yet. Use “Edit secrets” to add one.',
    surface: 'Your vault',
    legacyReadOnly:
      'This vault was made with an earlier test version. You can open it and copy your secrets, but not change it. To keep editing, create a new vault and copy your secrets into it.',
  },

  edit: {
    touchAny: 'Touch one of your keys to unlock editing.',
    touchSame: 'Touch the same key again to save your changes.',
    notInVault: 'That key isn’t part of this vault. Please use one of this vault’s keys.',
  },

  addKey: {
    title: 'Add a key',
    explain: [
      'You’ll need one key you already use for this vault, and the new key.',
      'Your current key unlocks the vault so the new key can be added. Nothing else changes.',
    ],
    max: 'This vault already has the maximum of 8 keys.',
    start: 'Add a key',
    touchCurrent: 'Touch one of your current keys.',
    insertNew: 'Now insert your new key. Press Continue, then touch the new key when it blinks.',
    touchNewAgain: 'Touch the new key once more to finish setting it up.',
    touchCurrentAgain: 'Put your current key back. Press Continue, then touch it to save.',
    done: 'Your new key is ready. It can open this vault on its own.',
  },

  progress: {
    label: 'Save progress',
    encrypted: 'Encrypted on this device',
    sponsored: 'Network fee sponsored',
    sent: 'Signed and sent',
    confirmed: 'Confirmed on-chain',
    arweave: 'Backup copy saved to Arweave',
    done: 'done',
    pending: 'not yet',
    failed: 'not saved yet',
  },
  save: {
    waitingForKey: 'Waiting for your key…',
    saving: 'Saving… this can take up to a minute.',
    saved: 'Saved.',
    nothingSaved: 'Nothing was saved. Your changes are still here, so you can try again.',
    paused: 'Saving is paused right now. Your existing vault is safe; please try again later.',
    pausedCreate: 'Nothing was saved. Please try again later.',
    details: 'Details',
    tooMany: 'This vault can’t hold more keys.',
    tooLarge: 'This is too much to store. Please shorten your secrets.',
    notConfirmed: 'We couldn’t confirm the save yet. Please unlock again in a minute to check.',
    retry: 'Try again',
  },

  mirror: {
    saved: 'Backup copy saved.',
    item: 'Arweave item',
    settleNote: 'Its permanent arweave.net link works once it settles, usually within a few hours.',
    pending: 'Saving an extra backup copy…',
    failed: 'Extra backup copy not saved yet.',
    retry: 'Retry',
  },

  details: {
    title: 'Vault details',
    vaultId: 'Vault ID',
    download: 'Download encrypted backup file',
    downloadHint:
      'This file is your vault exactly as stored, still locked. It is useless without one of your keys, and lets the CryoShield recovery tool open your vault even if this website is gone.',
    close: 'Close',
  },

  continue: 'Continue',
  back: 'Back',
  busy: 'Working…',
} as const;
