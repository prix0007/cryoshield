# If a key is lost or compromised

**Last reviewed:** 2026-10-12

This guide is for when one of your security keys is lost or stolen, or when someone else may be able to use it. It
explains what that key can still do, and how to move your secrets somewhere safe again.

CryoShield has no server and no account, and never sees your secrets or your keys. So nobody at CryoShield can do these
steps for you, and nobody at CryoShield will ever ask for them. **Never give anyone your seed phrases, recovery codes,
PINs or keys, even someone who says they are from CryoShield.**

## What one key can do

- **It always needs its PIN.** CryoShield sets up every key so that it asks for its PIN every time. A key without its
  PIN opens nothing. Security keys also allow only a few wrong PIN guesses before they lock themselves.
- **With its PIN, any one key opens your vault.** That is how a vault works: any one of its keys is enough.
- **With its PIN, any one key can also change your vault.** It can save new contents, rename, archive or clear it, and
  add more keys.
- **Every version you ever saved stays readable.** Each save adds a new version; the old ones are not erased.

The app shows these warnings when you clear a vault:

- Earlier versions of this vault stay in public chain history and on Arweave, forever. Nobody, including CryoShield, can delete them.
- Anyone who holds any of this vault’s keys and its PIN can still read those earlier versions.

So a key cannot be locked out of a vault, and old versions cannot be erased. If someone may have one of your keys
**and** its PIN, treat everything you ever stored in that vault as seen by them. Editing the vault, clearing it or
adding keys does not change that. What protects you is changing the secrets themselves.

## Which situation are you in?

### The key is lost or stolen, and nobody else knows its PIN

This is less urgent. The key alone can’t open your vault.

- Open your vault with another of its keys and use **Add a key** to set up a replacement, so you always have at least
  two keys you hold.
- The lost key stays part of the vault: there is no way to remove it. If it turns up in someone else’s hands later,
  and they learn its PIN, they could read the vault.
- If you can’t be sure the PIN is secret (it was written down near the key, someone may have seen you type it), follow
  the steps below as if the key were compromised.

### Someone may have the key and its PIN, or a device you used may be compromised

Act now, and follow every step below in order. Someone with a key and its PIN can read your vault, every version of
it, and can change what is stored in it. Don’t rely on the vault staying as you left it.

A compromised computer or phone is just as serious. If malware was on a device where you opened your vault, it may
have seen your secrets on screen, whatever happened to your keys. Change those secrets too.

**When in doubt, follow the steps below.**

## Steps when a key is compromised

### Step 1. Use a device and a key you trust

Open your vault on a computer or phone you trust, with a key that has never left your hands. If you think your usual
device has malware, use a different one. Have the secrets in front of you only as long as you need them.

### Step 2. Change the secrets at their source

This is the step that actually protects you. CryoShield can’t do it for you, because the secrets live elsewhere.

- **Seed phrase:** in your wallet app, create a brand-new wallet with a new seed phrase, and move all your funds to it.
  Stop using the old seed phrase.
- **2FA backup or recovery codes:** sign in to each account and create new recovery codes; the old ones stop working.
  If you stored a 2FA setup key, set up 2FA again on that account.
- **Passwords and other secrets:** change them.

Start with what matters most, such as the funds.

### Step 3. Create a new vault for the new secrets

On the CryoShield home screen, choose **Create a new vault**. Set it up with at least two keys you trust, and never with
the compromised key. Store only the new secrets from step 2.

Then lock it and open it once with each of its keys, to check that every key works.

### Step 4. Archive and clear the old vault

Open the old vault with a trusted key. Under **Manage vault**, choose **Rename or archive**, then **Archive and
clear…**. This saves the vault with no secrets in it and moves it to “Archived”.

It does not erase earlier versions: they stay public forever, and anyone with one of the old vault’s keys and its PIN
can still read them. That is why step 2 matters. If the old vault can’t be changed (an older, read-only format), skip
this step; step 2 has already made its contents useless.

### Step 5. Update your backups and notes

- In the new vault, open **Details & backup file** and choose **Download encrypted backup file**. Replace the old
  vault’s file wherever you kept it.
- If you keep a printed copy of your secrets, replace it with the new secrets, and destroy the old copy.
- Update any notes you keep about which keys open which vault.

### Step 6. Reset or retire the compromised key, last

Do this only after the steps above. If you get the key back, you can reset its security-key (FIDO2) function with your
key maker’s app, for example Yubico Authenticator for a YubiKey. A reset erases every credential on the key, for every
website and app, not only CryoShield. We suggest you don’t use a key that left your hands with CryoShield again.

## If no key you trust can open the vault

Then nobody can open it: not you, not CryoShield, not the recovery tool. Change the secrets at their source (step 2)
and create a new vault (step 3).

## What CryoShield can and can’t do

- CryoShield can’t remove a key from a vault, lock a key out, delete old versions, or recover a vault for you.
- The open-source [recovery tool](https://github.com/prix0007/cryoshield/tree/main/tools/recover#readme) opens a vault
  with one of its keys, without this website. It does not change anything stored.
- If you find a security problem in CryoShield itself, report it privately as our
  [security policy](https://github.com/prix0007/cryoshield/blob/main/SECURITY.md) describes. Never include seed phrases,
  recovery codes, PINs or keys.
