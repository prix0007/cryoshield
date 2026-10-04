# Supported devices

**Last reviewed:** 2026-10-05

CryoShield works only with **hardware security keys**: small USB or NFC devices that you physically hold. This page lists what a key and a browser must support, what we have actually tested, and what we expect to work but have not tested. It is published at [cryoshield.app/devices](https://cryoshield.app/devices) and kept in the open-source repository as [docs/supported-devices.md](https://github.com/prix0007/cryoshield/blob/main/docs/supported-devices.md).

Each device has one of three statuses:

- **Tested**: we used it with CryoShield ourselves. The table gives the date, the firmware and exactly which steps were tested.
- **Expected to work**: it meets every requirement below on paper, but we have not tested it.
- **Not supported**: it is missing at least one requirement, and CryoShield will refuse it.

If you use a device that isn't listed, or you test one marked "Expected to work", please [report it](#report-your-device).

## Requirements a key must meet

| Requirement | Why CryoShield needs it |
| --- | --- |
| **FIDO2 (CTAP 2.1) with the hmac-secret extension** (called PRF in browsers) | Your vault is encrypted with a secret that only the key can produce. Without `hmac-secret` there is nothing to encrypt with. |
| **User verification** (a PIN or a fingerprint on the key) | The key must check that it's really you. It also has to produce the same secret in the browser and in the recovery tool, and that only happens when verification is used every time. |
| **credProtect level 3** ("user verification required") | The key must refuse to do anything for CryoShield until its PIN is entered. Otherwise someone who found or stole it could use it without the PIN. CryoShield has required this since the `enforce-credprotect-uv` change, and refuses keys that can't confirm it. |
| **Discoverable credentials** (also called resident keys or passkeys on the key) | You unlock with one tap, without typing a username. This uses one storage slot on the key per vault, so the key needs a free slot (a YubiKey 5 has 25 slots before firmware 5.7, and 100 from 5.7). |
| **ES256 signatures** (P-256) | The key also signs your vault updates. The smart account that owns your vault verifies P-256 signatures. |
| **A roaming authenticator** (USB, NFC or Bluetooth) | Your vault is tied to hardware you hold and can move between computers. See the next section. |

## Why phone and laptop passkeys are refused

Passkeys built into a phone, a laptop or a password manager (for example iCloud Keychain, Google Password Manager, Windows Hello or 1Password) are not supported:

- **The recovery tool needs a key it can talk to over USB.** It works without our website, using the CTAP protocol over USB (or NFC). A passkey that lives inside a phone or an operating system can't be reached that way, so it could never open your vault without our website.
- **Synced passkeys break "only the hardware you hold".** Synced passkeys are copied to the cloud and to your other devices. Your vault would then depend on that account and every device it syncs to, not only on the keys in your hand.

The app asks the browser for a cross-platform (roaming) key only.

## Keys

| Key | Firmware | Status | Notes |
| --- | --- | --- | --- |
| YubiKey 5 series (5 NFC, 5C, 5C NFC, 5Ci, 5 Nano, 5C Nano) | 5.2 or newer required; 5.8 or newer recommended | **Tested (create flow)**, 2026-10-03, the founder's keys (firmware not recorded) | Creating a vault succeeded. That test ran **before** credProtect level 3 was required, so it must be repeated. Unlocking and the recovery tool are **not yet confirmed**; we're waiting for the founder's report. Firmware 5.8 or newer returns the secret during setup, which saves one touch per key. |
| YubiKey Security Key series (Security Key NFC, Security Key C NFC) | 5.2 or newer | **Expected to work** (untested) | Still to verify: `hmac-secret`, and that the key confirms credProtect level 3. |
| Nitrokey 3 (3A, 3C, 3A Mini) | Recent firmware | **Expected to work** (untested) | Still to verify: `hmac-secret`, and that the key confirms credProtect level 3. |
| SoloKeys Solo 2 | Recent firmware | **Expected to work** (untested) | Still to verify: `hmac-secret`, and that the key confirms credProtect level 3. |
| Feitian (recent FIDO2 models, such as the ePass FIDO2 and BioPass series) | Recent firmware | **Expected to work** (untested) | Still to verify: `hmac-secret`, and that the key confirms credProtect level 3. Older models may be FIDO2 without CTAP 2.1. |
| Google Titan Security Key (current FIDO2 models) | Recent firmware | **Expected to work** (untested) | Still to verify: `hmac-secret`, and that the key confirms credProtect level 3. |
| U2F-only keys (FIDO U2F, no FIDO2) | Any | **Not supported** | No `hmac-secret`, no PIN and no discoverable credentials. |
| YubiKey firmware older than 5.2 (including YubiKey 4 and NEO) | Below 5.2 | **Not supported** | No credProtect support, and no `hmac-secret` before FIDO2. |
| Any key without `hmac-secret` or without credProtect level 3 | Any | **Not supported** | The app refuses it during setup, with the messages shown [below](#how-to-check-your-key). |
| Platform or synced passkeys (phone, laptop, password manager) | Any | **Not supported** | See [Why phone and laptop passkeys are refused](#why-phone-and-laptop-passkeys-are-refused). |

## Browsers

The browser must support security keys with the PRF extension, and it must pass CryoShield's credProtect request through to the key. We have **not yet tested** whether every browser below does that. If a browser doesn't, the app refuses to set up the key (it never saves a vault on a key it can't confirm), and you can set the key up in Chrome or Edge instead.

| Browser | Platforms | Status | Notes |
| --- | --- | --- | --- |
| Chrome 118 or newer | Windows, macOS, Linux, Android | **Expected to work** | Our automated tests run in Chromium with virtual security keys, not with real hardware. |
| Edge 118 or newer | Windows, macOS, Linux | **Expected to work** | Chromium-based, like Chrome. |
| Firefox | 139 or newer on macOS and Linux; 148 or newer on Windows | **Expected to work** | Firefox on Android: unconfirmed for security keys with PRF. |
| Safari 26.4 or newer | macOS, iOS, iPadOS | **Expected to work**, with known issues | Known WebKit bugs [311099](https://bugs.webkit.org/show_bug.cgi?id=311099) and [314934](https://bugs.webkit.org/show_bug.cgi?id=314934) affect some security keys, including the YubiKey Bio. |

The app checks your browser before you start, and tells you if it can't use security keys this way.

## Recovery tool requirements

The [recovery tool](https://github.com/prix0007/cryoshield/tree/main/tools/recover#readme) opens your vault straight from public blockchain and Arweave data, without our website. It needs:

- **A key over USB.** The single-file binaries support USB keys only. For an NFC reader (PC/SC), install the tool with pipx and the `[nfc]` extra, which adds `pyscard`.
- **Linux, macOS or Windows.** On Linux, your user needs access to `/dev/hidraw*` (udev rules). On Windows, a normal (non-administrator) user goes through the Windows security-key dialog, which asks for the PIN itself.
- **Python 3.10 or newer** if you install with pipx instead of using a single-file binary.
- **Your key's PIN.** The tool always uses user verification. Keys set up with credProtect level 3 work with it unchanged.

## How to check your key

- **YubiKey firmware:** open [Yubico Authenticator](https://www.yubico.com/products/yubico-authenticator/) and look at the key's details, or run `ykman info` (from [YubiKey Manager](https://developers.yubico.com/yubikey-manager/)) and read the "Firmware version" line.
- **Try it in the app.** During setup, CryoShield checks every key and stops with a "Key not supported" message if one is missing a requirement. It never saves a vault on such a key.

For a key without `hmac-secret` (PRF), the app says:

> This key is too old or doesn’t support the feature CryoShield needs (YubiKey 5 with firmware 5.2 or newer works). Please try a different key.

For a key without credProtect level 3, the app says:

> This key can’t be set to always ask for its PIN, so anyone who found it could use it without the PIN. CryoShield won’t use it. Please use a newer key (for example a YubiKey 5 with firmware 5.2 or newer) in a recent Chrome or Edge.

## Report your device

Tried a key or a browser? [Open a device report](https://github.com/prix0007/cryoshield/issues/new?template=device-report.yml) with:

- the model and firmware;
- your operating system and browser;
- which steps worked (set up a key, create a vault, unlock, recovery tool).

Reports are public. **Never post seed phrases, recovery codes, PINs or keys**, not even partially and not in screenshots.
