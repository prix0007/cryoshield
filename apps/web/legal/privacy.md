# Privacy policy

**Effective date:** 2026-10-03

> **In short.** CryoShield never sees your secrets, your keys or anything that could open your vault. We set no
> cookies and keep no accounts. When you save a vault, its locked (encrypted) form is published permanently on a
> public blockchain and on Arweave. Nobody, including us, can delete it. The companies that carry your requests
> (hosting, the network-fee sponsor, blockchain and archive services) see your IP address. This page explains who
> sees what.

## Who we are

CryoShield is operated by [ENTITY], [REGISTERED ADDRESS]. For the data described here we are the "data controller"
under the EU and UK GDPR and the "Data Fiduciary" under India's Digital Personal Data Protection Act, 2023 (DPDP).

Contact: [CONTACT EMAIL]. We have not appointed an EU or UK representative yet; this page will name them if we do.

## What we never see

- Your secrets (seed phrases, recovery codes) or their labels. They are encrypted in your browser before anything is
  sent.
- Your security keys, the secret each key produces for this site (the WebAuthn PRF output), or the key that locks
  your vault. These exist only in your browser's memory for a moment and are then wiped.
- Any account, name, email address or phone number. CryoShield has no accounts.

This also means we **cannot** recover, read, change or hand over your vault, for you or for anyone else.

## Data held by third parties

Using CryoShield means your browser talks to the services below. Each of them sees your IP address and your browser's
user agent, as any website or server you connect to does.

| Service | Who | What it receives | Why | Where | Policy |
|---|---|---|---|---|---|
| Website hosting | Fly.io, Inc. (US); server in Singapore | IP address, the page requested, user agent, time | Delivering this website | Singapore, US | [Fly.io privacy](https://fly.io/legal/privacy-policy/) |
| Network-fee sponsor and transaction relay | Pimlico (Austerlitz Labs Ltd, UK) | IP address; your vault's account address; the transaction carrying your encrypted vault, its locators and signatures | Paying the network fee and sending your vault to the blockchain | UK | [Pimlico privacy](https://www.pimlico.io/privacy) |
| Public blockchain | OP Sepolia test network (later OP Mainnet), run by independent node operators | Everything listed under "Public and permanent data" | Storing your encrypted vault | Worldwide | Public network |
| Blockchain access (RPC) | OP Labs public endpoint (`sepolia.optimism.io`) | IP address; which vault locators you look up | Reading and checking your vault | Unpublished | [Optimism privacy](https://www.optimism.io/data-privacy-policy) |
| Archive upload | ArDrive Turbo (Permanent Data Solutions Inc., US) | IP address; the encrypted vault and its tags | Copying your encrypted vault to Arweave | US | [ArDrive terms and privacy](https://ardrive.io/tos-and-privacy/) |
| Archive reads | arweave.net gateway (ar.io) | IP address; which vault you look up | Checking and restoring the Arweave copy | Netherlands and worldwide | [ar.io privacy](https://ar.io/legal/terms-of-service-and-privacy-policy/) |
| Landing-page analytics | Cloudflare, Inc. (US) | See "Analytics" below | Counting visits to the home page | US and EU | [Cloudflare privacy](https://www.cloudflare.com/privacypolicy/) |
| Source code and security reports | GitHub, Inc. (US) | Whatever you post in issues or reports | Running the open-source project | US | [GitHub privacy](https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement) |

Our web server keeps **no request logs** of its own. The hosting provider and the other services keep their own logs
under their own policies; several do not publish how long. Our full inventory is public in the
[data-flow inventory](https://github.com/prix0007/cryoshield/blob/main/docs/compliance/data-inventory.md).

## Public and permanent data

When you save a vault, these items are published on the public blockchain **and** on Arweave:

- the encrypted vault (ciphertext), which is unreadable without one of your keys;
- your vault's account address and vault ID;
- a "locator" for each enrolled key (a value derived from the key, used to find the vault);
- the number of keys, each key's credential ID, and the settings needed to unlock it (site name `cryoshield.app`,
  salts and algorithm identifiers);
- the times of each save.

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
- **No cookies:** Cloudflare states the beacon sets no cookies and uses no local storage. We set none either.
- **Your choice:** if your browser sends **Global Privacy Control** or **Do Not Track**, the beacon is not loaded at
  all. Blocking `cloudflareinsights.com` has no side effects.
- **Who and where:** Cloudflare, Inc. acts as our processor under its data processing agreement; data is processed in
  the US and the EU.
- **Integrity:** the beacon script is pinned to a version we reviewed; a changed script is refused by your browser.

More detail is in the [cookie policy](/cookies).

## Retention

We hold no visitor data ourselves, except correspondence you send us, which we keep for 3 years after the matter is
closed. Each service above keeps its logs under its own policy. Data published on the blockchain and Arweave is
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

To make a request, write to [CONTACT EMAIL]. We will never ask for your secrets, your keys or your PIN, and we cannot
act on a vault: anyone who claims otherwise is not us.

## Grievance Officer

[GRIEVANCE OFFICER], [ENTITY], [REGISTERED ADDRESS], [CONTACT EMAIL].

We acknowledge grievances within 24 hours and resolve them within 15 days. If you are not satisfied, you can escalate
to the Data Protection Board of India.

## International transfers

Your data is handled in India (our company), Singapore and the US (hosting), the UK (fee sponsor), the US (archive
upload, analytics) and the EU (analytics). We rely on the safeguards each provider offers, such as the EU-US Data
Privacy Framework, standard contractual clauses and the UK adequacy decision.

## Children

CryoShield is intended only for people aged **18 or over**. The app asks you to confirm this before your first save.
If you are under 18, please do not use it. Because we hold no account data, the only thing we could delete for a
child is correspondence; we would explain how to make a vault unreadable by resetting its keys.

## Security

Your vault is encrypted on your device with AES-256-GCM, using keys derived from your security keys. CryoShield is a
**testnet preview** and has **not been independently audited**. Please report vulnerabilities as described in our
[security policy](https://github.com/prix0007/cryoshield/blob/main/SECURITY.md).

## Changes

We will update the effective date at the top whenever this policy changes, and record each change below. The full
history is public in our [source repository](https://github.com/prix0007/cryoshield/commits/main/apps/web/legal/privacy.md).

- 2026-10-03: first draft, pending legal review.
