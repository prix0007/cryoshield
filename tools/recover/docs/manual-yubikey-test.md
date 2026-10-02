# Manual test with a real YubiKey

Automated tests replace the hardware with a software CTAP2 authenticator. This procedure checks that a **real key** produces the same PRF output as the browser and opens a web-created vault with the website offline. Record every run in the results table at the bottom (tasks 8.3 and 11.1).

## What you need

- 2 YubiKeys from the 5 series (firmware 5.2 or newer), each with a PIN set. Check with `ykman fido info`.
- Foundry (`anvil`, `forge`, `cast`) for the local chain, or OP Sepolia (chain 11155420) access for the testnet run.
- The CryoShield web app running locally, or a vault created by the web app on OP Sepolia.
- This tool: `cd tools/recover && uv sync`.

## A. PRF equivalence: browser vs CTAP2 (task 8.3)

1. In Chrome, open the web app's create flow (or any page on the same RP ID) and register a discoverable credential on key #1. The request must include:
   - `userVerification: "required"`;
   - the PRF extension with the vault-crypto `locatorSalt`.

   Note the locator the app derives. It shows it in the developer console as `locator=0x…`.
2. Close the browser. Run:
   ```sh
   uv run cryoshield-recover --rp-id <the RP ID> --verbose --no-arweave --rpc http://127.0.0.1:8545 \
       --registry <address> --chain-id 31337
   ```
   With `--verbose`, the tool logs how many locators it derived. To see the value, run the hardware test instead:
   ```sh
   CRYOSHIELD_EXPECTED_LOCATOR=0x… CRYOSHIELD_RP_ID=<rp id> uv run pytest -m hardware -k locator
   ```
   It must print `PASS` with the same locator as step 1.
3. **Pass:** identical locators. **Fail:** different locators. The usual causes are a UV mismatch, a different RP ID, or a different salt. Stop and report to the crypto engineer.

## B. Web-created vault, website offline, local chain

1. `cd contracts && script/anvil-e2e.sh` (or `script/deploy.sh anvil`) to deploy the registry. Note the address and `deployBlock` from `deployments/31337.json`.
2. Point the web app at the local chain. Create a vault with keys #1 and #2, using a recognisable test secret.
3. Block every CryoShield domain: stop the dev server, and add `127.0.0.1 cryoshield.app` (or your RP ID) to `/etc/hosts`.
4. With key #1 inserted:
   ```sh
   uv run cryoshield-recover --rpc http://127.0.0.1:8545 --registry <address> --chain-id 31337 \
       --deploy-block <block> --no-arweave
   ```
   Touch the key, enter the PIN, and type `show`. **Pass:** the test secret is displayed, and the output shows `Unlocked a vault found on the blockchain` with the vault ID.
5. Repeat with key #2 only.
6. Repeat with `--vault-id <the ID printed in step 4>`.
7. Negative checks:
   - a third, unenrolled key gives exit code 7;
   - a wrong PIN shows the remaining attempts;
   - unplugging all keys gives exit code 3.

## C. OP Sepolia testnet (task 11.1)

Same as B, but:
- create the vault on OP Sepolia;
- run with `--testnet` (OP Sepolia, chain 11155420). Until the release embeds `contracts/deployments/11155420.json`, add `--registry <address> --deploy-block <block>` from that file;
- block CryoShield domains in `/etc/hosts`.

## D. Arweave-only (task 11.2)

Once the durability layer mirrors vaults with the D5 tags (`App-Name: CryoShield`, `CryoShield-Locator`, `CryoShield-Vault-Id`, `CryoShield-Version`):
1. Run with `--rpc http://127.0.0.1:9` (unreachable) to force the Arweave path.
2. **Pass:** the tool recovers the vault, says it came from Arweave, and warns that freshness could not be verified.

## Results

| Date | Key model / firmware | OS | Test | Result | Notes |
|---|---|---|---|---|---|
| | | | | | |
