# Runbook: grant the `workflows` permission so the agent workflows can be committed

**Symptom.** `git push` of anything under `.github/workflows/` is refused:

```
! [remote rejected] ... (refusing to allow a GitHub App to create or update
  workflow `.github/workflows/onboard.yml` without `workflows` permission)
```

and the API answers `Resource not accessible by integration` (HTTP 403) for
`PUT /repos/{owner}/{repo}/contents/.github/workflows/...` and for
`POST /repos/{owner}/{repo}/git/trees` when the tree contains that path. This
is why the three files live in `neon_agents/workflows/` and need
`install-workflows.sh` to be copied into place.

**Why.** The automation account is the GitHub App **`cline-cloud`**
(<https://github.com/apps/cline-cloud>), owned by the **`cline`** organisation.
GitHub only lets an App write workflow files if the App *requests*
`Workflows: Read and write` **and** the installation owner approves it. Today
`cline-cloud` requests only `contents`, `emails`, `issues`, `metadata` and
`pull_requests` — so there is nothing for the repository owner to approve yet.
Two people act, in this order.

Confirm the current state at any time:

```bash
gh api /apps/cline-cloud --jq '.permissions.workflows'   # -> null (not requested)
```

## Step 1 — App owner adds the permission (org `cline`)

1. Open **<https://github.com/organizations/cline/settings/apps/cline-cloud/permissions>**
   (Org `cline` → **Settings** → **Developer settings** → **GitHub Apps** →
   **Cline Cloud** → **Permissions & events**).
2. Under **Repository permissions**, find **Workflows**.
3. Set it to **Read and write**.
4. Click **Save changes**.

Equivalent API call, for the app owner only (a JWT signed with the app's
private key): `PATCH /app` with `{"permissions":{"workflows":"write"}}`.

## Step 2 — Installation owner approves (repo owner `mvmalusii-hub`)

1. Open **<https://github.com/settings/installations>**.
2. Find **Cline Cloud** — it now shows a **Review request** banner.
3. Click **Review request**, accept the new **Workflows** permission, then
   **Save**.

## Step 3 — Verify

```bash
gh api /apps/cline-cloud --jq '.permissions.workflows'   # -> "write"
./neon_agents/install-workflows.sh                        # copies the three files
git add .github/workflows && git commit -m 'Activate agent workflows' && git push
gh workflow list                                          # -> onboard, legis, agent-tests
```

A new installation token is minted once the request is approved. If `git push`
still returns 403, re-run the command so the proxy hands out the refreshed
token.

## Fastest alternative — no permission change

A human can add the three files through the web UI; GitHub does not require the
App to hold `workflows` when a person commits them:

1. Open **<https://github.com/mvmalusii-hub/neon-legacies-enterprise-builder-website-/new/main/.github/workflows>**
2. File name `onboard.yml`, paste the contents of `neon_agents/workflows/onboard.yml`,
   **Commit changes**.
3. Repeat for `legis.yml` and `agent-tests.yml`.
