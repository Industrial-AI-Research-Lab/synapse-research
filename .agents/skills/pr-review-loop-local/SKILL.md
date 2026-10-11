---
name: pr-review-loop-local
description: >-
  Use to automate the full GitHub PR review cycle until the reviewer returns no actionable findings — but the reviewer is a FRESH LOCAL subagent you spawn (running the bundled review_prompt.md — the same prompt the hosted bot runs, comment-hygiene pass included: added/changed comments that reference tickets, PR reviews, memory files or uncommitted docs, or merely narrate the code, come back as Medium findings), NOT the hosted assignment-triggered bot. It ensures a PR exists first, then each round spawns a tabula-rasa reviewer agent that reviews the current head and POSTS its findings to the PR as inline review comments plus a sentinel summary comment; the orchestrator polls the PR for that verdict, spawns a separate fresh fixer that fixes on code evidence (TDD) and rebuts false findings with file:line, verifies the suite green ITSELF, commits, pushes to the PR branch (NEVER main), replies to and resolves each thread, then re-spawns a fresh reviewer — repeating until the reviewer's newest pass has no unresolved Critical/High/Medium. Works on ANY repo; reviewer login and verify commands are auto-detected, never hardcoded. Because the reviewer runs under YOUR OWN gh login (not a separate bot login), new-review detection is timestamp+sentinel-based, not author-based. Handles multi-repo tasks (one PR per repo), never disturbs the user's working tree (isolates via throwaway git worktree per repo), and given a tracker ticket resolves the org's PRs and bootstraps a branch+commit+PR from changes that ALREADY exist locally. Converges on a reviewer-blessed PR with a per-round report. Never auto-merges.
user-invocable: true
argument-hint: "<pr-number-or-url | ticket-id | branch> [--max-rounds N] [--reviewer-model opus|sonnet] [--poll-interval 2m] [--timeout 60m] [--dry-run]"
---

# PR Review Loop (Local Reviewer) — Automated review ↔ fix until clean

Automates the manual cycle: *ensure a PR exists → spawn a reviewer that posts findings to the PR → read comments → fix on code evidence → push → resolve threads → re-spawn the reviewer → repeat until no issues.* You are the orchestrator. The **reviewer is a FRESH subagent you spawn each round** that runs the bundled `review_prompt.md` (the same prompt the hosted bot runs, comment-hygiene pass included) and posts its findings to the PR as inline comments. Each round's **fixer is a separate fresh subagent** with no memory of prior rounds.

This is the sibling of `pr-review-loop`. The **only** difference: that skill triggers the *hosted* review bot by assignment and waits ~50 min for it; this skill **spawns the reviewer locally** and drives it itself. Everything downstream (classify → fix → verify → push → resolve → re-trigger) is identical, because `review_prompt.md` maps onto the same two channels the original watches: inline comments = review threads, the "reviewed, no issues" summary = the clean/convergence verdict.

## When to use
- The hosted review routine is unavailable, not configured for the repo, too slow, or you want the review to run under your own control/model.
- The user asks to "run the local review loop", "review this with a spawned agent and fix until clean", or points at a PR/ticket/branch and says drive it to clean using a local reviewer.

Do NOT use for: the first authoring of a change, or a one-shot review (use `review` / `review-advanced`). If you specifically want the *hosted* assignment-triggered bot as the reviewer, use `pr-review-loop` instead.

---

## Hard safety rails (non-negotiable)
1. **NEVER push to `main`/`master`.** Before EVERY push assert `git rev-parse --abbrev-ref HEAD` is the PR's head branch and is not `main`/`master`. Abort the whole loop if HEAD is main. (On any repo whose CI deploys from `main`, pushing tracked `main` is an instant prod deploy.)
2. **Verify green yourself before every push.** Never trust the fixer's word that tests pass. Run the repo's real verify commands (detected below) yourself.
3. **No auto-merge.** Converging the loop makes the PR mergeable; the human merges. Merging to main = deploy.
4. **Keep the reviewer as the final gate.** Convergence means the *reviewer agent's own last pass* found nothing actionable — not your opinion that it's clean. The reviewer is a fresh tabula-rasa agent each round precisely so its verdict is independent of your fixes.
5. **Code evidence only, both directions.** The fixer fixes what the code proves is real and rebuts what the code proves is false. A confident-sounding finding is not evidence; neither is your prior fix. Verify each against the file at the cited line, the DB, or the backend source.
6. **The reviewer never touches code or git.** The spawned reviewer only reads and posts PR comments. It must never edit, commit, push, resolve threads, assign, or merge. The bundled `review_prompt.md` already forbids push/commit; the spawn prompt reinforces the rest.
7. **Memory is not evidence.** Saved memory (auto-memory `project_pr*_review.md`, `MEMORY.md`, prior-round notes) is a navigation aid only — thread IDs, paths, where a prior round left off. Never source, restate, or paraphrase a finding from it. Every finding, and every classify/dedup decision, keys off the live threads fetched in Step 0 and the code at the current head read this session — never a remembered conclusion.

---

## Inputs / knobs
- `<target>` — **a PR** (number/URL), **a tracker ticket** (e.g. `ABC-123`), or **a branch name**. Whatever it is, **Step P guarantees a PR exists before the loop.** A PR runs the loop on that one PR. A ticket resolves the full multi-repo scope (Phase A). A branch resolves-or-creates its PR. From a PR URL, parse `owner/repo` and use the matching local checkout (cwd if it matches, else a checkout named `<repo>` under the cwd or the cwd's parent dir); if not found, ask.
- `--max-rounds N` — default **6**. Caps the loop even if not converged.
- `--reviewer-model opus|sonnet` — model for the spawned reviewer subagent. **Default: `opus`** (it is the authoritative reviewer doing deep investigation; match the hosted bot's strength). The fixer stays a fresh general-purpose agent.
- `--poll-interval` — default **2m**. `--timeout` — default **60m**. A local reviewer subagent usually finishes in minutes and its completion re-invokes you early; the poll is the detection-of-record + timeout guard.
- `--dry-run` — **read-only.** Run Step 0's assessment and print the full plan (Step P's resolve-or-bootstrap-PR decision, current open threads with severity, each finding's would-fix-vs-would-rebut intent, the per-repo isolation decision, and every mutation it would make live), then STOP. Spawns no reviewer, creates no PR/branch/worktree, makes no edits, pushes nothing, resolves nothing.

---

## Bundled resource
`review_prompt.md` sits next to this file (`<skill-dir>/review_prompt.md`). It is the same reviewer prompt the hosted bot runs — 20+ years reviewer persona, code-evidence-only, the embedded deep-investigation methodology, the finding format (Context / WHAT / Examples / where / why / expected / what-if-not-fixed), the "In plain terms" requirement, "leave inline comments; if nothing found, leave a small comment confirming you reviewed", and the **comment-hygiene pass** (one Medium finding per added/changed comment that references a ticket / PR review / memory file / uncommitted doc, narrates the code, or duplicates another comment). The hosted routine's prompt is kept as a committed file of its own; when either copy changes, mirror it into the other, or the two reviewers drift. The spawned reviewer READS and FOLLOWS this file. Resolve its absolute path once: `SKILL_DIR` = the base directory the runtime reports when this skill loads (the directory holding this SKILL.md).

---

## Preconditions (run once, before the loop)

**`gh` must be repo-explicit — never rely on the shell cwd.** The primary cwd is often a **non-git parent dir** holding several checkouts side by side; every Bash call resets cwd and every **background job detaches from it**. A bare `gh pr view <pr>` then dies with `fatal: not a git repository` and, piped through `-q`, returns an **empty string a poll misreads as "no new review"** — polling blind for the full timeout. So resolve the slug ONCE and pass `--repo "$OWNER_REPO"` on EVERY `gh pr` / `gh pr checks` / `gh pr edit` / `gh pr list` call. (`gh api graphql` with `-F owner -F repo`, and `gh api repos/{o}/{r}/…`, already carry owner+repo — leave those.)
```bash
# from a PR URL: parse owner/repo. From a local checkout $REPO: derive from origin (the sed strips any embedded token + host):
OWNER_REPO=$(git -C "$REPO" remote get-url origin | sed -E 's#(git@[^:]*:|https://[^/]*/)##; s#\.git$##')  # -> owner/repo
ORG=${OWNER_REPO%%/*}   # the org, for Phase A's cross-repo lookups
gh pr view <pr> --repo "$OWNER_REPO" --json number,headRefName,baseRefName,headRefOid,url,state,isDraft
```
1. **Capture your gh identity once.** `SELF=$(gh api user -q .login)`. The reviewer subagent posts under THIS SAME login (it shares your `gh` auth), so `SELF` is NOT a discriminator between reviewer and orchestrator here — detection is timestamp+sentinel-based (Steps 1/3). This is the one place this skill diverges from `pr-review-loop`, which relies on a distinct bot login.
2. **Choose the working tree per repo (never disturb the user's).** For EACH repo in scope, resolve `$WORKDIR` via *Working-tree isolation* below: the main checkout when it is already on the PR's head branch, otherwise a throwaway `git worktree`. Every git op, verify run, and fixer file-edit for that repo happens in its `$WORKDIR`. Never operate on `main`/`master`.
3. **Land pending work:** commit + push any of this PR's pending commits/changes to the PR branch first (respect rails #1/#2) so the reviewer reviews the real head.
4. **Establish verify commands by what the PR TOUCHES** — the root manifest lies (e.g. a root `package.json` with no scripts while the code under review is a Go module in a subdirectory). Detect per changed subtree, prefer the repo's own CI job when one exists, and do NOT invent a command that isn't defined:
   - Changed `*.dart` under a Flutter package (nearest `pubspec.yaml`) → `flutter test` for that package + `dart analyze` (both via `fvm` when the repo pins Flutter in `.fvmrc`); also run the repo's diff-scoped CI lints if present (read the PR workflow under `.github/workflows`).
   - Changed `*.go` → `cd` to the nearest `go.mod` up-tree, then `go test ./... && go vet ./...` (+ `golangci-lint run` if a `.golangci.*` exists).
   - Changed `*.ts`/`*.js` (nearest `package.json`) → run only the scripts that EXIST: prefer `test`, else `typecheck` + `build`. (with no `test` script, verify is `npm run typecheck && npm run build`.)
   - If verify is ambiguous or absent, confirm the commands with the user on first run in that repo rather than guessing; record them for the session.
5. **Comment-hygiene sweep before the first reviewer spawn.** Run the sweep from loop step 7 over the whole PR diff (base...head). Every confirmed violation — a comment referencing a ticket / PR / review / memory file / uncommitted doc, narrating the code, or duplicating another comment — is deleted or rewritten, verified, and pushed BEFORE the reviewer runs, so it reviews a clean head and never spends a round on it.

---

## Step P — Ensure a PR exists (MANDATORY, before the loop, every target type)

A PR is the reviewer's target and the thread substrate. Guarantee one before spawning any reviewer.

- **Target is a PR (#/URL):** verify it's open and not a draft the reviewer can't comment on (`gh pr view <pr> --repo "$OWNER_REPO" --json state,isDraft`). If draft, mark ready or ask. Done — `$PR`, `$OWNER_REPO` set.
- **Target is a tracker ticket:** run **Phase A** (below) — resolve every repo the ticket touches and ensure each has a PR (bootstrap from existing local changes only). Each resolved PR then enters the loop.
- **Target is a branch name (or "current changes"/a repo path):**
  - If an open PR already exists for that branch → use it: `gh pr list --repo "$OWNER_REPO" --head "$BR" --state open --json number -q '.[0].number'`.
  - Else **bootstrap one** (same rails as Phase A step 3): if the changes sit uncommitted on `main`, `git -C "$REPO" checkout -b "$BR"` to carry them off main (NEVER commit to main); scoped commit (`git add <paths>`, never `-A`); `git push -u origin "$BR"`; `gh pr create --repo "$OWNER_REPO" --base <default-branch> --head "$BR" --title … --body …`. **Confirm branch/base/title/files with the user before `gh pr create`** — a PR is outward-facing. (`--dry-run` prints the plan, creates nothing.)

Never author a change that isn't already in the working tree; never fabricate a diff to "have something to review."

## Phase A — Resolve scope & ensure a PR per repo (ONLY when the target is a tracker ticket)

A PR/branch target skips this. A **ticket** target resolves the full multi-repo scope first, then runs the loop per in-scope repo.

1. **Find the ticket's PRs + touched repos.** Prefer the issue tracker's MCP when one is connected (e.g. Linear's `get_issue` — attachments/links carry the GitHub PR URLs and branch name). Cross-check GitHub per candidate repo — the repos the ticket links plus the sibling checkouts on disk, with `ORG` from the Preconditions block or a linked PR URL: `gh pr list --repo "$ORG/<r>" --state open --search "<TICKET>"`.
2. **Classify each repo the ticket plausibly touches:**
   - **Relevant open PR exists** → use it; the repo enters the loop on that PR.
   - **No PR, but authored changes exist locally** (dirty tree, or an unpushed local branch named for the ticket) → needs a PR → **bootstrap (step 3).**
   - **No PR and no local changes** → **out of scope / needs authoring first.** Report it; NEVER fabricate a change.
3. **Bootstrap a PR — from EXISTING changes only, never author:**
   - `BASE` = repo default branch (`gh repo view "$ORG/<r>" --json defaultBranchRef -q .defaultBranchRef.name`, usually `main`).
   - `BR` = the existing local ticket branch if one exists and isn't `main`/`master`, else `feature/<ticket-lower>-<slug>`.
   - If the changes sit **uncommitted on `main`**: `git -C "$REPO" checkout -b "$BR"` — carries the working-tree changes ONTO the new branch; **nothing is committed to `main`.**
   - **Scoped commit** only the ticket's files (`git add <paths>`, never `-A`). Action/Reason body referencing the ticket.
   - `git push -u origin "$BR"` (upstream = origin/BR, never main).
   - `gh pr create --repo "$ORG/<r>" --base "$BASE" --head "$BR" --title "<ticket>: …" --body "…"`. **Confirm branch/base/title/files with the user before creating.**
4. **Report the resolved scope** before looping — a table: repo → {existing PR #, would-bootstrap `<branch>`, or skip (needs authoring)}.

**Phase A rails:** never commit to or push `main`/`master`; never author a change that isn't already in the working tree; confirm before `gh pr create`. Where CI deploys from `main`, a main push = prod deploy.

---

## Working-tree isolation (per repo — decide BEFORE the loop)

One task can span several repos. Resolve `$WORKDIR` **independently for each repo/PR**. `$SCRATCH` = the session scratchpad dir. For a repo checkout `$REPO` whose PR (`$PR`) head branch is `$BR`:

```bash
CUR=$(git -C "$REPO" rev-parse --abbrev-ref HEAD)
if [ "$CUR" = "$BR" ]; then
  WORKDIR="$REPO"                         # already on the PR branch -> work in place
else                                       # different branch (dirty OR clean) -> isolate; never switch their branch
  WT="$SCRATCH/wt/$(basename "$REPO")-pr$PR"
  git -C "$REPO" fetch origin "$BR" --quiet
  git -C "$REPO" worktree add "$WT" "$BR" # DWIM-creates a local tracking branch from origin/$BR if absent
  WORKDIR="$WT"
fi
```

- **In place** (`CUR == BR`): the dirty files ARE the PR's own pending work, and deps/codegen/pods are already present. Commit **scoped** (never `git add -A`).
- **Worktree** (`CUR != BR`): shares the repo's `.git` -> same remote + credentials -> `git push origin HEAD` from `$WORKDIR` lands on the PR branch, and the user's other-branch work is never touched.
- **Fresh-worktree dep setup** (the main checkout already has this; a bare worktree does not):
  - **Flutter**: committed `*.g.dart`/`*.freezed.dart`/`pubspec.lock` ARE in the worktree -> no codegen. If the repo pins Flutter in an untracked `.fvmrc`, `cp "$REPO/.fvmrc" "$WT/" 2>/dev/null`. Then ONE `flutter pub get` (via `fvm` when pinned) at the workspace root — parallel per-package runs race on the shared iOS SwiftPM dir. Any iOS/pod work from the app package, so its per-project settings apply.
  - **Go**: global module cache — usually nothing; `go mod download` only if a test complains.
  - **Node / TS**: `npm ci` — `node_modules` isn't in the worktree.
- **Cleanup** (after convergence or abort): `git -C "$REPO" worktree remove "$WT"` (`--force` if artifacts remain). Keep it while mid-loop or when handing a failure back — and say so.
- **No local checkout?** Make the worktree from a fresh `git clone` into `$SCRATCH`, or ask — don't guess.

The spawned **reviewer** reads the code at head via `$WORKDIR` (read-only for it) and cross-references sibling repos under the parent dir as `review_prompt.md` allows.

---

## The loop (round r = 1 … max-rounds)

Run once per in-scope repo/PR. Repos are independent — sequential or parallel — each with its own `$WORKDIR`, rounds, and rebuttal ledger.

### 0. Assess current state (read-only — runs FIRST, in EVERY mode incl. dry-run)
- `gh pr view <pr> --repo "$OWNER_REPO" --json headRefOid,state,mergeStateStatus` + `gh pr checks <pr> --repo "$OWNER_REPO"` — head SHA, mergeability, CI status.
- **Fetch the currently-OPEN unresolved review threads** (GraphQL `reviewThreads` filtered `isResolved:false`) — findings that already exist and were never addressed. Do NOT skip these by only looking at activity newer than now.
- **Also read every existing review's summary body**, not just its inline threads (`gh pr view <pr> --repo "$OWNER_REPO" --json reviews -q '.reviews[]|select(.body!="")|"\(.author.login): \(.body)"'`). A prior finding — especially from a human co-reviewer — often sits in a review **body** with no inline thread; a threads-only assessment drops it and the loop can converge "clean" while it sits unaddressed.
- Resolve the per-repo `$WORKDIR` isolation decision and report it — but create NO worktree yet in dry-run.

**Loop entry:** if Step 0 found open unresolved threads, round 1 enters at **step 5 (classify)** using THOSE threads — skip spawning a reviewer, you already have findings. Only when the current threads are all resolved do you go to step 1→2 to request a fresh review.

**`--dry-run` STOPS HERE** and prints: (a) Step P's resolve-or-bootstrap-PR decision, (b) each open thread with severity + author, (c) the fixer's *plan* per thread (would-fix vs would-rebut, reasoned from code, no edits), (d) the `$WORKDIR` decision, (e) the exact live mutations it would perform (spawn reviewer, commit+push, reply+resolve, re-spawn). It spawns nothing, edits nothing, pushes nothing, resolves nothing.

### 1. Baseline the newest PR activity (to detect the reviewer's NEW response)
The reviewer subagent posts under **your own gh login** (shared auth), so you CANNOT filter by author — your own thread-replies from the previous round's step 9 are the same login. Instead, **baseline the newest activity of ANY author right now, immediately before spawning**, and treat anything newer as the reviewer's. Between this instant and reading its verdict, the reviewer is the only writer (the orchestrator only polls, read-only, until step 9).
```bash
BR_=$(gh pr view <pr> --repo "$OWNER_REPO" --json reviews \
  -q '[.reviews[]]|last|.submittedAt // "1970-01-01T00:00:00Z"')
BC_=$(gh api "repos/$OWNER_REPO/issues/<pr>/comments" \
  -q '[.[]]|last|.created_at // "1970-01-01T00:00:00Z"')
BASELINE=$(printf '%s\n%s\n' "$BR_" "$BC_" | sort | tail -1)   # newest review OR issue comment, any author
```

### 2. Spawn a FRESH reviewer subagent (one per round) that posts to the PR
Spawn via the Agent tool (`subagent_type: general-purpose`, fresh — NOT a fork; tabula rasa is the point so its verdict is independent). Use `--reviewer-model` (default `opus`). Its prompt MUST say:

> You are the reviewer for one round of an automated PR review loop, standing in for the hosted review bot. **Read `<SKILL_DIR>/review_prompt.md` in full and follow it exactly** — that is your complete instruction set (persona, code-evidence-only rule, the embedded deep-investigation methodology, the finding format, the "In plain terms" requirement, and the mandatory comment-hygiene pass — one Medium inline finding per added/changed comment that fails it).
> Review **PR #<pr> in `<OWNER_REPO>` at its CURRENT head** (`<headRefOid>`). Get the diff with `gh pr diff <pr> --repo "<OWNER_REPO>"`; read the changed files at head in `<WORKDIR>` and cross-reference sibling repos under `<parent-dir>` when a finding needs the other side (e.g. FE↔BE), as `review_prompt.md` permits.
> **POST your review to the PR, do not return findings to me:** create ONE pull-request review of event type **COMMENT** (never APPROVE/REQUEST_CHANGES — you may be the PR author and GitHub forbids self-approval) with one **inline comment per finding**, each using `review_prompt.md`'s finding format anchored at the real `path`+`line`. Use `gh api repos/<OWNER_REPO>/pulls/<pr>/reviews` (or the github MCP review tools).
> **Then post ONE final issue comment as a completion sentinel:** its body MUST begin with the exact marker `<!-- prl-local:complete -->` on its own line, followed by a plain-English summary and the finding counts `C=… H=… M=… L=…`. **If you found NO issues, post ONLY this sentinel comment** ("reviewed, no critical or high severity issues") and create no review/threads — this is the clean verdict.
> **FORBIDDEN:** editing, committing, or pushing any code; resolving or replying to existing threads; assigning; merging; changing labels. You review and post NEW comments only. (Amending the PR description per `review_prompt.md` when it is empty is allowed.)
> Return a short report of what you posted: findings by severity, the review URL, and the sentinel comment URL — but the PR is the source of truth, not your return value.

Record the spawned reviewer's agent id so a stall can be inspected.

### 3. Poll for the reviewer's verdict — BACKGROUND job, ~2 min × up to ~60 min
Run the poll as a **background job** (`run_in_background: true`) that fires when the **sentinel comment** appears (`created_at > BASELINE` AND body contains `<!-- prl-local:complete -->`). Keying on the sentinel means (a) it fires only when the reviewer is fully done posting, not mid-stream; (b) it fires on the clean case too (clean = only the sentinel); (c) an unrelated human/CI comment during the run won't false-fire it.

**The reviewer completing ALSO re-invokes you** (you spawned it) — that is an *early wake*. On any wake (poll exit OR reviewer-agent completion), determine truth from the PR:
- **Sentinel present** (`> BASELINE`) → review done → stop the poll, go to step 4.
- **Reviewer agent completed but NO sentinel** → it errored or refused to post → read its returned report, surface/retry (see Failure handling). Do NOT treat as "no findings."
- **Neither yet** (spurious wake) → let the poll keep running.

The poll itself (same failure-hardening as the original — wrong-cwd blindness, transient-gh tolerance):
```bash
errs=0; MAX_ERRS=3
for i in $(seq 1 30); do                # 30 × 2 min ≈ 60 min (honor --poll-interval/--timeout)
  sleep 120
  if S=$(gh api "repos/$OWNER_REPO/issues/<pr>/comments" \
          -q '[.[]|select(.created_at>"'"$BASELINE"'" and (.body|contains("<!-- prl-local:complete -->")))]|last|.created_at // ""' 2>/dev/null); then
    errs=0                              # gh call succeeded — empty genuinely means "reviewer not done yet"
    [ -n "$S" ] && { echo "REVIEW_COMPLETE $S"; exit 0; }
    echo "tick $i: reviewer still working; CI=$(gh pr checks <pr> --repo "$OWNER_REPO" --json bucket -q '[.[].bucket]|join(",")' 2>/dev/null)"
  else                                  # gh errored — NOT "not done"; tolerate a blip, fail loud if persistent
    errs=$((errs+1))
    echo "TRANSIENT gh error tick $i; consecutive=$errs/$MAX_ERRS"
    [ $errs -ge $MAX_ERRS ] && { echo "GH_ERROR — gh failed $MAX_ERRS ticks in a row (missing --repo / non-git cwd / outage)"; exit 3; }
  fi
done
echo "TIMEOUT_NO_REVIEW"; exit 1
```
- **First-tick sanity-check:** before backgrounding, run ONE `gh pr view <pr> --repo "$OWNER_REPO" --json reviews -q '.reviews|length'` in the foreground; if it errors, the poll would run blind — fix the invocation before launching. A populated `CI=` in the tick lines proves it can see the PR.
- On `GH_ERROR` → gh is persistently unreachable or the invocation is wrong (bare `gh` in a non-git cwd). Verify gh works now, fix the invocation, and **relaunch the poll** — the verdict may already be posted. A single `TRANSIENT gh error` line followed by more ticks is a normal blip; no action.
- On `TIMEOUT_NO_REVIEW` → the reviewer subagent hasn't posted its sentinel in ~60 min. First check whether the **reviewer agent is still running or already returned** (a long deep-investigation can exceed the poll window). If it's still running, extend the poll. If it returned without a sentinel, treat as "reviewer didn't post" (Failure handling). Never spin forever.

### 4. Fetch the verdict + its threads
Read both: GraphQL (`reviewThreads` → `isResolved,isOutdated,path,line,comments{author,body}`) for the inline findings' thread IDs + bodies, AND the sentinel issue comment's body (the plain-English summary + counts). A clean verdict arrives as ONLY the sentinel comment with NO new threads — that is convergence, not a spurious fire. Write the GraphQL query to a scratchpad file and `gh api graphql -F query=@file` to avoid shell-escaping breakage.

### 5. Classify + gate
- Parse each finding's severity (Critical/High/Medium/Low) and whether the thread is already resolved/outdated.
- **Converged** when the reviewer's **newest pass** has **no unresolved Critical/High/Medium**: a clean sentinel ("no new critical or high…"), praise, nits, or only Lows you elect to dismiss-with-rationale, AND zero open unresolved threads → **break the loop**.
- **Dedup against the rebuttal ledger:** drop any finding whose claim matches one a prior round already rebutted with evidence; carry that prior rebuttal forward as the reply instead of re-invoking the fixer. A tabula-rasa reviewer has zero memory and WILL re-raise settled-false points — the ledger is what guarantees termination here.

### 6. Spawn a FRESH fixer subagent (one per round)
Spawn via the Agent tool (`subagent_type: general-purpose`, fresh — NOT a fork). Pass it: the findings (with thread IDs), the PR diff, the repo's verify commands, and the current rebuttal ledger. Its prompt MUST say:

> You are the fixer for one round of an automated PR review loop. Follow the `deep-investigation` skill methodology and the `simplest-fix-first` gate. **Check the PR review findings and comments and based on code evidence only fix the issues if needed.**
> For EACH finding: (a) verify the claim against primary evidence — open the cited file at the cited line, read the called library/backend source, run a DB/count query if it's a data claim; (b) if the code PROVES it real → fix it with the smallest change that closes it, TDD (write the failing test first: reproduce the exact error, then make it green), and add a regression test covering the enumerated edge inputs (nil/empty, exact boundary, the currently-broken case); (c) if the code PROVES it false or the fix would be over-engineering → do NOT change code; write a rebuttal citing `file:line` / query result that refutes it. (d) A **Comment hygiene** finding (a quoted comment that references a ticket / PR / review / memory file / uncommitted doc, narrates the code, duplicates another comment, or pads) is real by inspection — delete or rewrite it as the finding says; never rebut it as "only a comment" or "the reference adds context". Every comment you add or touch obeys the same rule: nothing outside the repo, no narration, at most ~3 lines, only what the code cannot say.
> **Work only inside the directory I give you** (`$WORKDIR`) — it may be an isolated `git worktree`. cd there and make every edit and test run there.
> **Do NOT run any git command** (no add/commit/checkout/switch/push) — edit files and run tests only; the orchestrator handles git. Do not touch files outside the change's scope. Do not weaken or delete existing tests.
> Return a structured report: per finding → `{threadId, verdict: real|false, evidence: file:line/query, action: fixed|rebutted, files_changed, test_added, one-line rationale}`.

### 7. Verify green YOURSELF
In `$WORKDIR`, run the repo's full verify commands for every touched package/module + the diff-scoped lints CI runs. If anything is red, do NOT push — feed the failure back to a follow-up fixer invocation (or fix the trivial case yourself) until green. Passing tests prove only the cases written; sanity-check the fixer covered the edge inputs.

**Comment-hygiene sweep (every round, before the push).** A comment the PR adds or changes may state only what the code cannot — an exception, a trap, a magic number's derivation, an ordering constraint, why two similar things both exist. It may not reference anything outside the repo (ticket ids like `ABC-123`, `PR #42`, review threads, memory-file slugs like `reference_*` / `feedback_*`, uncommitted plans or docs — a committed `docs/adr/…` file is fine), narrate the line below it, duplicate a contract stated elsewhere, paraphrase a test's own assertion, or run past ~3 lines on restatement. Mechanical first pass over the PR's added comment lines (then read the hits):
```bash
BASE=$(gh pr view <pr> --repo "$OWNER_REPO" --json baseRefName -q .baseRefName)
git -C "$WORKDIR" fetch origin "$BASE" --quiet
git -C "$WORKDIR" diff -U0 "origin/$BASE...HEAD" | grep -E '^\+[^+]' \
  | grep -E '^\+[[:space:]]*(//|#|/\*|\*|--|<!--|""")' \
  | grep -nE '\b[A-Z][A-Z0-9]{1,9}-[0-9]+\b|\bPR #?[0-9]+|\b(reference|feedback|project)_[a-z]|memory/|as requested|\(see (plan|doc|spec)|review \[(Low|Medium|High|Critical)\]'
```
Every hit is judged, never auto-failed (`ISO-8601`, `SHA-256`, `UTF-8` are standards, not tickets), and the grep only finds references — narration, duplication, and padding are found by reading every added comment line (the same pipeline without the last filter). Every confirmed violation is deleted or rewritten, verify is re-run, then push. Diff-scoped: comments the PR did not add or change are left alone.

### 8. Commit + push (rails #1, #2)
```bash
cd "$WORKDIR"                      # the main checkout OR the isolated worktree
git add <changed source paths>    # SCOPED — never `git add -A`; leave unrelated leftovers (.fvmrc, AGENTS.md) unstaged
git commit -m "fix: address review round r findings (<TICKET>)"   # Action/Reason body per convention
BR=$(git rev-parse --abbrev-ref HEAD)
test "$BR" != main && test "$BR" != master && git push origin HEAD || { echo "REFUSING: on $BR"; exit 1; }
```

### 9. Reply + resolve every thread
For each thread: post a reply citing the fixing commit SHA (real) or the rebuttal evidence (false), then resolve it. Use per-thread explicit GraphQL calls — do NOT index into a shell array (a 1-indexed shell off-by-one has misassigned replies before; verify each reply landed on the right thread with `gh api repos/{o}/{r}/pulls/comments/{id} -q .body`).

### 10. Record + re-trigger
Append this round to the rebuttal ledger + the round report, then loop to **step 1** (re-baseline the newest activity AFTER your own replies/resolves, then step 2 re-spawns a fresh reviewer against the new head). Re-baselining after your own posts is what keeps the timestamp discriminator honest — the next reviewer's posts are the only activity newer than the new baseline.

---

## Termination
Stop and report when ANY of:
- **Converged** — the reviewer's latest pass has no unresolved Critical/High/Medium (the success case).
- **Round cap** reached (`--max-rounds`).
- **All-rebutted round** — every finding this round was refuted on code evidence (you and the reviewer genuinely disagree). Do not keep looping; surface the disagreement for a human. This is a signal, not a failure.
- **Reviewer didn't post** within the poll/timeout, and the reviewer agent has returned or died without a sentinel.
- **Verify stays red** after a reasonable fix attempt — stop, report the failing output.

Never auto-merge on convergence.

---

## Report (end of run)
Plain-English summary first, then a per-round table:

| Round | Findings (C/H/M/L) | Fixed | Rebutted (evidence) | Commit | Threads resolved |

Then: final CI status (the repo's PR checks), "all N threads resolved / M open", the head SHA, and the explicit next step ("reviewer-blessed and green — merge when ready; I do not auto-merge").

---

## Failure handling
- **Reviewer agent didn't post (no sentinel):** it may have errored, refused, hit an auth/permission problem posting to the PR, or run past the poll window. Read its returned report. If it's a transient post failure, re-spawn it once. If it genuinely found nothing but forgot the sentinel, post the clean sentinel yourself from its report and treat as converged only if it explicitly reported zero C/H/M. Never invent findings, and never treat a silent reviewer as "clean" without its explicit verdict.
- **Poll ran blind / `GH_ERROR` / a false `TIMEOUT_NO_REVIEW`:** the `gh` calls couldn't resolve the PR (bare `gh` from a non-git/background cwd), so every result read empty. Symptom: tick lines with an empty `CI=`, or `gh` printing `fatal: not a git repository`. Fix: add `--repo "$OWNER_REPO"` to every `gh pr*` call and relaunch. A lone `TRANSIENT gh error` line is a network blip and needs no action.
- **Reviewer posts a plausible-but-wrong finding:** the fixer rebuts with evidence; you reply with that evidence and resolve. Expected and common with a tabula-rasa reviewer — do not "fix" phantom findings.
- **Reviewer re-raises a settled-false finding next round:** the rebuttal ledger (step 5 dedup) drops it and re-posts the prior rebuttal. This WILL happen (the reviewer has no memory) — the ledger is mandatory, not optional.
- **CI red after push (a diff-scoped check the local suite didn't run):** treat as a new finding — read the failing job log, root-cause, fix, re-verify, push.
- **Merge conflict / base moved:** rebase the PR branch on its base (never main-push), re-verify, continue.
- **Oscillation** (round N+1 critiques exactly what round N changed): the ledger + "smallest fix" gate should damp it; if it persists two rounds, stop and surface to the human.

## Notes
- The reviewer is a fresh subagent each round running the bundled `review_prompt.md`; it posts under your own gh login, which is why detection is timestamp+sentinel-based, not author-based (the single divergence from `pr-review-loop`).
- Your own thread-replies (step 9) register as `COMMENTED` reviews under your login — that is exactly why step 1 re-baselines the newest activity AFTER those replies before the next reviewer spawns.
- If you want the *hosted* assignment-triggered bot as the reviewer instead of a local agent, use `pr-review-loop`.
