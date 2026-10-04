# Agent account: agents work without admin rights

OpenSpec change `gate-production-deploys` (audit CI-H1). The owner's account `prix0007` is a repository admin. An agent using the owner's `gh` login could change the `main` ruleset, the `production` environment or the repository settings. Agents therefore push and open PRs as a separate **machine user** with the **Write** role. Write cannot change rulesets, environments, secrets or settings, and cannot approve a production release. Only the owner is a required reviewer, and admins cannot bypass that.

Everything below is done by the founder. Agents never create credentials.

## 1. Create the machine user and invite it

1. Create a GitHub account for the agents, for example `cryoshield-agent`. GitHub's terms allow one machine account per person. Use its own email address, and turn on 2FA.
2. Invite it with **Write** (not Maintain, not Admin):

   ```sh
   gh api -X PUT repos/prix0007/cryoshield/collaborators/cryoshield-agent -f permission=push
   ```

3. Accept the invitation while logged in as the machine user (`https://github.com/prix0007/cryoshield/invitations`).

## 2. Give it a token

**The limitation.** A fine-grained PAT can only reach repositories owned by the token's resource owner: the user itself, or an organization it belongs to. It cannot reach a repository where the user is only a collaborator on *another personal account* ([GitHub docs](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)). `prix0007/cryoshield` is owned by a personal account, so pick one of these options.

**Option A (recommended): fine-grained PAT through an organization.**
1. Transfer the repository to a free organization that you own.
2. Add the machine user to the organization with base permission *No permission*, and give it **Write** on this repository only.
3. Create the token as the machine user (Settings → Developer settings → Fine-grained tokens) with:
   - Resource owner: the organization. Repository access: **only this repository**.
   - Expiry: 90 days at most.
   - Permissions:

     | Permission | Access |
     |---|---|
     | Contents | Read and write (push branches) |
     | Pull requests | Read and write (open PRs, reply to reviews) |
     | Issues | Read and write (triage replies) |
     | Metadata | Read (mandatory) |
     | Administration, Environments, Secrets, Variables, Actions | **No access** |
     | Workflows | **No access** (see the trade-off below) |

4. In the organization, require approval for fine-grained tokens (Settings → Personal access tokens), then approve this one.

After the transfer, the default `--repo` in `.github/rulesets/apply.sh` and the `prix0007/cryoshield` paths in the docs need a follow-up change. `--environments` refuses an organization owner as reviewer, so name the reviewer by hand in that change.

**Option B: classic PAT on the machine user.**
- Scope: `repo` only. Do not grant `workflow`, `admin:*`, `delete_repo` or `write:packages`.
- Expiry: 90 days.

A classic token reaches every repository the machine user can access. That is only this one, so keep the account a collaborator nowhere else. The real boundary in both options is the account's **Write role**: rulesets, environments, secrets and settings need Admin whatever scopes the token has.

**Trade-off: no Workflows permission.** Without Workflows (`workflow` scope for a classic token), the token cannot push a commit that changes `.github/workflows/`. CI changes made by agents are then pushed by the owner after reading them, for example by checking out the agent's branch locally and pushing it with the owner's own credentials. This is deliberate: workflow edits can reach secrets, so they are the highest-risk change. If CI changes from agents become routine, you can grant Workflows (read and write). The ruleset, ECC review and the production approval still apply.

## 3. Configure gh and git on the agent machine

Use a separate SSH key and identity for the agent checkouts, so the owner's credentials are never used there.

```sh
# SSH key used only for the machine user (add the .pub on github.com as the machine user)
ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519_cryoshield_agent -C cryoshield-agent
```

`~/.ssh/config`:

```
Host github-agent
  HostName github.com
  User git
  IdentityFile ~/.ssh/id_ed25519_cryoshield_agent
  IdentitiesOnly yes
```

`~/.gitconfig` (applies only to checkouts under the agent directory):

```
[includeIf "gitdir:~/agents/cryoshield/"]
  path = ~/.gitconfig-cryoshield-agent
```

`~/.gitconfig-cryoshield-agent`:

```
[user]
  name = cryoshield-agent
  email = <machine user's noreply address>
[url "git@github-agent:"]
  insteadOf = git@github.com:
  insteadOf = https://github.com/
```

`gh` in the agent environment: export the token only into the agent's shell, for example from the OS keychain. Never put it in a file inside the repository.

```sh
export GH_TOKEN="$(security find-generic-password -s cryoshield-agent-pat -w)"   # macOS keychain
gh auth status    # must show the machine user, not prix0007
```

`GH_TOKEN` takes precedence over the `gh auth login` session, so `gh pr create` and `gh api` run as the machine user.

## 4. Verify it cannot change protection

Run these as the machine user (`GH_TOKEN` set). Every **write** must fail with HTTP 403 or 404, and nothing may change.

```sh
gh api user --jq .login                                                   # cryoshield-agent
gh api repos/prix0007/cryoshield --jq .permissions                        # admin: false, maintain: false, push: true
gh api -X PUT repos/prix0007/cryoshield/environments/production -F can_admins_bypass=true          # must fail
gh api -X POST repos/prix0007/cryoshield/rulesets -f name=probe -f target=branch -f enforcement=disabled   # must fail
gh api -X PATCH repos/prix0007/cryoshield -F allow_merge_commit=true      # must fail
gh secret list --repo prix0007/cryoshield                                 # must fail
git push origin HEAD:main                                                 # must be rejected by the ruleset
```

Then, as the owner, confirm that nothing changed: `.github/rulesets/apply.sh --with-ecc-review --environments` must report "in sync".

To see that a release waits for the owner, open the newest Deploy run: its `release` job shows *Waiting for review*, and the machine user has no *Review deployments* button.

## Rotation and revocation

- Rotate the token before it expires. Create the new one, update the keychain entry, then delete the old one.
- If the token may have leaked, delete it at once (machine user → Settings → Developer settings), then check the machine user's security log (Settings → Security log), the organization audit log under option A, and the repository's recent branches, PRs and Deploy runs.
- To remove all agent access: `gh api -X DELETE repos/prix0007/cryoshield/collaborators/cryoshield-agent`.
