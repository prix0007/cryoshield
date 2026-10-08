# Privacy policy

**Effective date:** 2026-10-09

<!--legal-note-->

> **In short.** CryoShield never sees your secrets, your keys or anything that could open your vault. We set no
> cookies and keep no accounts. When you save a vault, its locked (encrypted) form is published permanently on a
> public blockchain and on Arweave. Nobody, including us, can delete it. The companies that carry your requests
> (hosting, the network-fee sponsor, blockchain and archive services) see your IP address. This page explains who
> sees what.

## Who we are

This website is run by CryoShield, an open-source project maintained by its contributors (github.com/prix0007/cryoshield). There is no company behind it: the source code, its
history and every decision are public in the [repository](https://github.com/prix0007/cryoshield).

The site itself collects and keeps no personal data (no accounts, no cookies, no server logs of our own). For the
little personal data that exists, the messages you send us through GitHub, the project maintainers act as the data
controller under the EU and UK GDPR and as the Data Fiduciary under India's Digital Personal Data Protection Act, 2023
(DPDP), only for the correspondence they receive.

**How to reach us:** open a [privacy request](https://github.com/prix0007/cryoshield/issues/new?template=privacy-request.yml) on GitHub, or, for
anything sensitive, a [private security advisory](https://github.com/prix0007/cryoshield/security/advisories/new), which only the maintainers can see.
There is no email address.

## What we never see

- Your secrets (seed phrases, recovery codes), their labels, or the name you give a vault. They are encrypted in your
  browser before anything is sent.
- Your security keys, the secret each key produces for this site (the WebAuthn PRF output), or the key that locks
  your vault. The key's secret is wiped from memory as soon as it has been used. While a vault is open, its contents
  exist only in your browser's memory, and are cleared when you lock it, after 5 minutes without activity, or when
  you leave the page.
- Any account, name, email address or phone number. CryoShield has no accounts.

This also means we **cannot** recover, read, change or hand over your vault, for you or for anyone else.

## On your device

CryoShield sets no cookies. If you pick **Light** or **Dark** in the Theme menu, your browser remembers that one
choice in its local storage, under the name `cryoshield-theme`, so every page opens in it. It holds only the word
`light` or `dark`: no identifier and nothing about you or your vault, and it is never sent anywhere. Choosing System
deletes it, and clearing this site's data in your browser removes it too. Nothing else is stored on your device; the
[cookie policy](/cookies) lists everything.

## Data held by third parties

Using CryoShield means your browser talks to the services below. Each of them sees your IP address and your browser's
user agent, as any website or server you connect to does.

| Service | Who | What it receives | Why | Where | Policy |
|---|---|---|---|---|---|
| Website hosting | Fly.io, Inc. (US); server in Singapore | IP address, the page requested, user agent, time | Delivering this website | Singapore, US | [Fly.io privacy](https://fly.io/legal/privacy-policy/) |
| Network-fee sponsor and transaction relay | Pimlico (Austerlitz Labs Ltd, UK) | IP address; your vault's account address; the transaction carrying your encrypted vault, its locators and signatures | Paying the network fee and sending your vault to the blockchain | UK | [Pimlico privacy](https://www.pimlico.io/privacy) |
| Public blockchain | <!--net:testnet-->__CS_NET_NAME__ test network (later OP Mainnet)<!--/net--><!--net:mainnet-->__CS_NET_NAME__<!--/net-->, run by independent node operators | Everything listed under "Public and permanent data" | Storing your encrypted vault | Worldwide | Public network |
| Blockchain access (RPC) | __CS_RPC_VENDOR__, `__CS_RPC_HOST__` | IP address; which vault locators you look up | Reading and checking your vault | Unpublished | [Optimism privacy](https://www.optimism.io/data-privacy-policy) |
| Archive upload | ArDrive Turbo (Permanent Data Solutions Inc., US) | IP address; the encrypted vault and its tags | Copying your encrypted vault to Arweave | US | [ArDrive terms and privacy](https://ardrive.io/tos-and-privacy/) |
| Archive reads | arweave.net gateway (ar.io), and Turbo's index `turbo-gateway.com` (ArDrive), which lists the copy before it settles on Arweave | IP address; which vault you look up | Checking and restoring the Arweave copy | Netherlands, US and worldwide | [ar.io privacy](https://ar.io/legal/terms-of-service-and-privacy-policy/), [ArDrive terms and privacy](https://ardrive.io/tos-and-privacy/) |
| Landing-page analytics | Cloudflare, Inc. (US) | See "Analytics" below | Counting visits to the home page | US and EU | [Cloudflare privacy](https://www.cloudflare.com/privacypolicy/) |
| Source code and security reports | GitHub, Inc. (US) | Whatever you post in issues or reports | Running the open-source project | US | [GitHub privacy](https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement) |

Our web server keeps **no request logs** of its own. The hosting provider and the other services keep their own logs
under their own policies; several do not publish how long. Our full inventory is public in the
[data-flow inventory](https://github.com/prix0007/cryoshield/blob/main/docs/compliance/data-inventory.md).

## Public and permanent data

When you save a vault, these items are published on the public blockchain, in CryoShield's public vault registry
contract, **and** on Arweave:

- the encrypted vault (ciphertext). Everything inside it, including your secrets, their labels and the vault's name,
  is unreadable without one of your enrolled keys **and** that key's PIN (or fingerprint);
- every earlier version of the encrypted vault: saving a change adds a new version, and the old ones stay public;
- your vault's account address and vault ID. The account is a CryoShield smart account controlled only by your keys:
  every change it makes needs one of your keys and that key's PIN;
- each enrolled key's public signing key, stored in that account;
- a "locator" for each enrolled key (a value derived from the key, used to find the vault). A key has the same locator
  for every vault it opens, so the locator links those vaults to each other;
- the number of keys, each key's credential ID, and the settings needed to unlock it (site name `cryoshield.app`,
  salts and algorithm identifiers);
- the approximate size of the vault. It is padded, so only a size range shows, but that can be enough to tell, for
  example, a 12-word seed phrase from a 24-word one;
- the times of each save, and, on Arweave, a one-time upload address that your browser creates for that session.

**This data is permanent. It cannot be deleted by us or by anyone else**, because public blockchains and Arweave are
designed so that nobody can remove what has been written. An Arweave gateway may hide an item, but the network keeps it.

European regulators say that encrypted data on a blockchain is still personal data, and that encryption keeps it
unreadable only until the encryption method is broken. We use strong, standard symmetric encryption (AES-256-GCM),
but we cannot promise that no future technique will ever weaken it. That is why the app asks you to confirm that you
understand this before your first save.

**Making your vault permanently unreadable ("crypto-shredding").** If you reset or destroy every security key enrolled
for a vault (for a YubiKey: `ykman fido reset`), no one can derive the key that unlocks it, and the published
ciphertext can no longer be decrypted with any known technique. This is the closest thing to deletion that exists for
public, permanent data. The account address, locators and credential IDs remain public, but they do not contain your
name; stop using that vault and they no longer point to anything you use.

## Purposes and legal bases

- **Delivering the site, keeping it secure and preventing abuse of the fee sponsorship** (IP addresses seen by our
  hosting and the services above): our legitimate interests (GDPR Art. 6(1)(f)); "legitimate uses" and your
  instructions under DPDP.
- **Publishing your encrypted vault:** this is the service you ask for when you press Save (GDPR Art. 6(1)(b)), after
  the permanence notice in the app.
- **Counting landing-page visits:** our legitimate interest in knowing whether the site is useful (see Analytics).

## Analytics

The home page (`/`) uses **Cloudflare Web Analytics** to count visits. Nothing else on this site has analytics: not
the vault app at `/app/`, and not these legal pages.

- **What it reads:** the page path (we remove any query string or fragment from the address before it loads), the
  referring page, your browser's user agent, and page-load performance timings. Your IP address passes through
  Cloudflare in transit; Cloudflare says it does not store IP addresses for analytics and derives only a country.
- **No cookies:** Cloudflare states the beacon sets no cookies and uses no local storage. We set none either. The
  optional theme choice (see "On your device") is not part of the analytics and is never sent.
- **Your choice:** if your browser sends **Global Privacy Control** or **Do Not Track**, the beacon is not loaded at
  all. Blocking `cloudflareinsights.com` has no side effects.
- **Who and where:** Cloudflare, Inc. acts as our processor under its data processing agreement; data is processed in
  the US and the EU.
- **Integrity:** the beacon script is pinned to a version we reviewed; a changed script is refused by your browser.

More detail is in the [cookie policy](/cookies).

**Statistics from public data.** Separately, a scheduled job in our GitHub repository counts vaults, keys and Arweave
copies from the public blockchain and Arweave data. It reads no visitor data and no analytics. It reports weekly
totals only, never shows a group of fewer than 3, and each report is kept for 90 days as a GitHub Actions artifact.

## Donations

We don't track donations. The [/support](/support) page has no analytics and sets no cookies. Like every page, it
stores nothing in your browser except the optional theme choice, and we don't link donations to vaults or to visits.

Ethereum is a public blockchain. If you donate, your sending address, the amount and the time are visible to anyone,
permanently, and can't be deleted by us or by anyone else. Like anyone, we can see incoming transactions to the
donation address on public block explorers. We never ask who you are.

## Retention

We hold no visitor data ourselves. The GitHub issues and advisories you open stay on GitHub: we delete or redact
personal data in them on request, and close private advisories once handled (keeping them at most 3 years after
closure). Each service above keeps its logs under its own policy. Data published on the blockchain and Arweave is
permanent. The full table is in our
[retention statement](https://github.com/prix0007/cryoshield/blob/main/docs/compliance/retention.md).

## Your rights

You can ask us to access, correct or erase personal data we hold, and to explain how we process it. In practice we
hold almost nothing: we can delete correspondence and ask the services above to delete their logs, but **nobody can
delete data published on the blockchain or Arweave** (see crypto-shredding above).

- **India (DPDP Act 2023):** the rights to access information, correction and erasure, grievance redressal, and to
  nominate someone to act for you; and the right to complain to the Data Protection Board of India once you have used
  our grievance process.
- **EU and UK (GDPR):** the rights of access, rectification, erasure, restriction, portability and objection
  (Articles 15–22), and the right to complain to your data protection authority.
- **United States:** CryoShield does not sell or share personal information, and does not meet the thresholds of the
  California Consumer Privacy Act (CCPA/CPRA) or similar state laws. If that changes, we will honour Global Privacy
  Control as an opt-out of sale or sharing, as we already do for analytics.

To make a request, open a [privacy request](https://github.com/prix0007/cryoshield/issues/new?template=privacy-request.yml) on GitHub. Issues
are public: for anything sensitive, use a [private security advisory](https://github.com/prix0007/cryoshield/security/advisories/new) instead. If you
post personal data in a public issue by mistake, tell us and we will delete or redact it. We will never ask for your
secrets, your keys or your PIN, and we cannot act on a vault: anyone who claims otherwise is not us.

## Grievance Officer

The Grievance Officer is **the project maintainer**, reachable through a
[private security advisory](https://github.com/prix0007/cryoshield/security/advisories/new) (mark it as a privacy grievance).

We acknowledge grievances within 24 hours and resolve them within 15 days. If you are not satisfied, you can escalate
to the Data Protection Board of India, or complain to your data protection authority.

## International transfers

Your data is handled by the maintainers (via GitHub), in Singapore and the US (hosting), the UK (fee sponsor), the US (archive
upload, analytics) and the EU (analytics). We rely on the safeguards each provider offers, such as the EU-US Data
Privacy Framework, standard contractual clauses and the UK adequacy decision.

## Children

CryoShield is intended only for people aged **18 or over**. The app asks you to confirm this before your first save.
If you are under 18, please do not use it. Because we hold no account data, the only thing we could delete for a
child is correspondence; we would explain how to make a vault unreadable by resetting its keys.

## Security

Your vault is encrypted on your device with AES-256-GCM, using keys derived from your security keys. If you lose every
security key enrolled for a vault, nobody, including us, can open it. <!--net:testnet-->CryoShield is a **testnet preview** and has **not been independently audited**.<!--/net--><!--net:mainnet-->CryoShield runs on **__CS_NET_NAME__** and has **not been independently audited**.<!--/net-->
Our internal security reviews are public in the
[repository](https://github.com/prix0007/cryoshield/tree/main/docs/reviews). Please report vulnerabilities as described in our
[security policy](https://github.com/prix0007/cryoshield/blob/main/SECURITY.md).

## Changes

We will update the effective date at the top whenever this policy changes, and record each change below. The full
history is public in our [source repository](https://github.com/prix0007/cryoshield/commits/main/apps/web/legal/privacy.md).

- 2026-10-09: the blockchain and blockchain-access rows name the network and the public endpoint this site actually
  uses; "Security" says that nobody can open a vault after all its keys are lost.
- 2026-10-08 (revision 3): new "On your device" section. The site now has a Theme menu (System, Light, Dark); if you
  pick Light or Dark, your browser remembers that one choice (`cryoshield-theme`). It is never sent anywhere.
- 2026-10-08: "Public and permanent data" now lists every public item (earlier versions, each key's public signing
  key, the size range, the Arweave upload address) and says that unlocking needs a key **and** its PIN; vault names
  are listed as encrypted; how long an open vault stays in memory; the statistics job that reads only public data;
  a link to our security reviews.
- 2026-10-05: new "Donations" section (the /support page).
- 2026-10-04: the vault app also checks the Arweave copy on Turbo's index (`turbo-gateway.com`), which lists it
  before it settles.
- 2026-10-03 (revision 2): CryoShield is an open-source project: operator, contact (GitHub only, no email) and
  Grievance Officer (the project maintainer) filled in.
- 2026-10-03: first draft.
