# Cookie policy

**Effective date:** 2026-10-03 (revision 2)

<!--legal-note-->

> **In short.** CryoShield sets no cookies. No page stores anything on your device. The only analytics is a
> cookieless Cloudflare beacon on the home page, which is off if your browser sends Global Privacy Control or Do Not
> Track.

## What we store on your device

Nothing. The table below lists every cookie and every kind of browser storage that any CryoShield page, or any third
party embedded in one, creates on your device. Today every cell is "None". An automated test loads each page, runs the
vault app's create and unlock steps, and fails if anything appears that is not listed here.

<!--storage-inventory-->

Your security key's credential lives on the key itself, not in your browser. The secret it produces for this site is
held in memory only for a moment and then wiped.

## Analytics on the landing page

The home page (`/`) loads the **Cloudflare Web Analytics** beacon from `static.cloudflareinsights.com`, which reports
to `cloudflareinsights.com`. It runs **only on the home page**: never in the vault app at `/app/`, and never on these
legal pages.

- It reads the page path (we strip any query string or fragment first), the referring page, your browser's user agent
  and page-load performance timings. Your IP address passes through Cloudflare in transit.
- Cloudflare states that the beacon sets **no cookies** and uses no local storage.
- The script is pinned: your browser only runs it if it matches the exact version we reviewed (its integrity hash).
- Cloudflare, Inc. processes this data for us in the US and the EU under its data processing agreement.

## Your choices

- If your browser sends **Global Privacy Control** or **Do Not Track**, the beacon is not loaded at all.
- You can block `cloudflareinsights.com` with any content blocker; the site keeps working normally.
- There is nothing else to opt out of, because nothing else is stored or measured.

## When this would change

We would add a consent choice before using any of the following: a cookie or browser storage that is not strictly
necessary, a cross-site or persistent identifier, a second analytics or marketing service, advertising or tracking
pixels, or any analytics in the vault app. Any change will update the effective date and the list below.

## Contact

Questions about this policy: open an issue in the [repository](https://github.com/prix0007/cryoshield) (there is no email address). See also our
[privacy policy](/privacy) and [terms of service](/terms).

## Changes

The full history is public in our
[source repository](https://github.com/prix0007/cryoshield/commits/main/apps/web/legal/cookies.md).

- 2026-10-03 (revision 2): contact via GitHub (open-source project; no email address).
- 2026-10-03: first draft.
