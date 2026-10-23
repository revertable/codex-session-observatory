# Test Matrix

## Purpose

This document defines the current verification contract for Codex Session
Observatory. Use it to select checks that match the files and behavior changed.

The repository provides one local command that runs the complete automated
suite. For pull requests and pushes to `main`, CI invokes the same entry point
when at least one changed file is not Markdown or when it cannot safely classify
the change set. Run each applicable command explicitly when full verification
is not required, and report checks that were passed, failed, or not run.

## Command Locations

Run the full local automated verification from the repository root:

```text
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\verify.ps1
```

Frontend commands run from `frontend/`:

```text
npm test
npm run test:browser
npm run check
npm run build
npm run tauri:dev
npm run tauri:build -- --no-bundle
```

Rust checks may be run from the repository root so their package boundary is
explicit:

```text
cargo test --manifest-path backend/Cargo.toml
cargo test --manifest-path frontend/src-tauri/Cargo.toml
```

Install frontend dependencies with `npm ci` from `frontend/` before running npm
commands in a fresh checkout.

## Browser Integration Environment

`npm test` retains its Node-only environment contract. Browser integration is a
separate script and is also required by `verify.ps1`, including CI. The harness
uses an installed Chrome, Edge, or Chromium executable; it does not download a
browser or add an npm dependency. Set `OBSERVATORY_TEST_BROWSER` to an explicit
executable when the standard installation paths are unavailable. A missing
browser fails integration verification rather than silently skipping tests.

SSR HTML assertions have been moved to real client DOM tests. Production uses
Svelte `mount`; no server renderer or hydration contract is required. Pure
semantic/Capture assertions remain in unit tests. DOM tests check the actual
constructor and Theme components rather than an alternate test renderer.

## Continuous Integration

`.github/workflows/ci.yml` first classifies the complete change set for a pull
request or push to `main`. When every changed path ends in `.md`
(case-insensitive), it skips the full Windows verification. If any changed path
is not Markdown, it runs the full automated verification on `windows-latest`
with Node.js 24 and Rust stable. The workflow installs locked frontend
dependencies with `npm ci`, then invokes `verify.ps1` from the repository root.

Change classification is fail-safe. If checkout or changed-file comparison
fails, or the required comparison commits are unavailable, CI runs the full
Windows verification. The workflow remains triggered for Markdown-only changes
so its jobs report a completed result rather than leaving a path-filtered check
pending.

Before full verification, CI uses a commit-pinned Rust-specific cache action to
restore dependency build artifacts for the `backend` and
`frontend/src-tauri` Cargo workspaces. The cache excludes workspace crates,
Cargo binaries, and incremental artifacts; the action therefore disables Cargo
incremental compilation for the CI job. Its key accounts for the exact Rust
toolchain, Cargo manifests and lockfiles, Cargo configuration, and relevant
compiler environment variables.

Pull requests may restore an available base-branch cache but do not save cache
entries. Only successful pushes to `main` save the cleaned cache. Cache restore
or save failures do not replace or fail the full verification path; Cargo must
remain able to rebuild every artifact from the locked dependency graph.

The CI workflow has read-only repository contents permission. It does not use
secrets, upload artifacts, create a portable ZIP, launch the application, sign
code, create tags, or publish a release. Those packaging, manual, and release
boundaries remain separate from automated verification.

## What Each Check Covers

| Check | Coverage | Notes |
| --- | --- | --- |
| `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\verify.ps1` | Complete frontend, backend, and desktop automated verification | Runs the full sequence below and stops at the first failing step. It does not install dependencies, package a portable ZIP, or launch the application. |
| `npm test` | Frontend workflow, Collection identity/order/lifecycle/serialization, semantic AST, safe DOM construction, transcript capture, and update-check unit behavior | Node-only; no installed browser is required. |
| `npm run test:browser` | Real client DOM, attachment lifecycle, Refresh retention, links, four themes, collapse/expand, Collection headers/copy/clear, notice layout, and Top/Bottom scrolling | Requires installed Chrome/Edge/Chromium. Uses an isolated headless profile and localhost test server. Clipboard behavior is stubbed; Windows clipboard checks remain manual. |
| `npm run check` | Svelte and TypeScript static validation | Does not run frontend or Rust tests. |
| `npm run build` | Production frontend bundle | Also runs automatically before a Tauri build. |
| `cargo test --manifest-path backend/Cargo.toml` | Parser, inspection, session routing, domain, API, and Worklog behavior | This is the primary Observatory Core test suite. |
| `cargo test --manifest-path frontend/src-tauri/Cargo.toml` | Tauri command adaptation and desktop bridge behavior | Compiling the backend as a dependency does not replace the backend test command. |
| `npm run tauri:dev` | Interactive desktop development run | This is a manual runtime check, not an automated test. |
| `npm run tauri:build -- --no-bundle` | Release-mode desktop compilation without installer generation | Use when the desktop integration or production build boundary is affected. |
| `build-and-run.bat` from the repository root | Release build, portable ZIP creation, and application launch | This is a Windows packaging and smoke path; it does not run tests or static checks. |

## Change Matrix

Run all checks marked **Required** for the affected row. Add the conditional
checks when the stated boundary is involved. When a change spans multiple rows,
combine their requirements.

| Change area | Required verification | Conditional or manual verification |
| --- | --- | --- |
| Documentation only | Inspect the rendered Markdown, links, paths, and commands; confirm `git diff --check` | Run referenced commands when the documentation changes their contract or expected output. |
| Frontend state, load workflow, filters, or update check | `npm test`; `npm run check`; `npm run build` | `npm run tauri:dev` for interaction or platform behavior. |
| Transcript rendering, themes, collapse, or capture | `npm test`; `npm run test:browser`; `npm run check`; `npm run build` | Manually inspect each affected presentation and relevant filtered/collapsed states in `npm run tauri:dev`. |
| Collection state, panel, or toolbar navigation | `npm test`; `npm run test:browser`; `npm run check`; `npm run build` | Inspect all four themes, narrow/maximized windows, native clipboard contents, source order, Refresh preservation, and file-change reset in Tauri. |
| Backend parser, transport decoding, inspection, domain, or session routing | `cargo test --manifest-path backend/Cargo.toml` | Add `npm test` and a desktop smoke check when transported data or visible behavior changes. |
| Backend API or Worklog export | `cargo test --manifest-path backend/Cargo.toml` | Run the applicable frontend checks when DTOs or UI-visible behavior change; manually inspect generated Worklog output when export structure changes. |
| Tauri commands or desktop bridge | `cargo test --manifest-path frontend/src-tauri/Cargo.toml`; `npm run check`; `npm run build` | Run backend tests when backend contracts change; use `npm run tauri:dev` for command integration. |
| Tauri capabilities, configuration, icons, or desktop integration | `npm run check`; `npm run tauri:build -- --no-bundle` | Exercise the affected permission or platform behavior in the built application. |
| Dependency or lockfile changes | Tests and builds for every affected package | Use `npm ci` in a clean dependency state when npm resolution changes. Review both direct and transitive dependency changes. |
| Application version metadata | Full `verify.ps1`; compare npm/Cargo manifest and local-package lockfile versions with Tauri config | Inspect Windows executable FileVersion/ProductVersion. Portable archive naming reads Tauri config; package only in an explicitly approved packaging task. |
| Portable packaging or release behavior | `npm run tauri:build -- --no-bundle`; `build-and-run.bat` | Inspect the ZIP contents, versioned archive name, bundled README and license, and application startup. Release publication remains a separate approved Git/release action. |

## Full Verification

Use the following sequence when a change crosses the frontend, backend, and
desktop boundaries, or when release confidence requires the complete automated
suite:

```text
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\verify.ps1
```

The integrated entry point runs the following commands in order and stops at
the first failure:

```text
cd frontend
npm test
npm run test:browser
npm run check
npm run build
cd ..
cargo test --manifest-path backend/Cargo.toml
cargo test --manifest-path frontend/src-tauri/Cargo.toml
cd frontend
npm run tauri:build -- --no-bundle
```

`npm run build` is repeated by the Tauri build through `beforeBuildCommand`.
Keeping the standalone step makes frontend build failures easier to identify;
it may be omitted only when the Tauri build is run and its frontend build result
is reported explicitly.

## Manual Verification Boundaries

Automated checks do not replace targeted observation of user-visible or
platform behavior. Manual verification is expected when a change affects:

- native file or folder dialogs;
- clipboard operations or transcript capture presentation;
- opening folders, releases, or other external links;
- role filters, themes, collapse state, refresh, or parent-session navigation;
- Tauri permissions and platform-specific integration;
- portable archive contents or launch behavior.

Use only sanitized sample data for repository fixtures. Real Codex logs remain
outside version control and must not be exposed in verification reports.

For Collection, select C, A, B and verify A, B, C in the panel and actual Windows
clipboard, using source order rather than timestamps. Remove and re-add B;
check uniqueness, local header times, raw fences, line breaks, and indentation.
Copy All retains selection; Clear removes all selection indicators. Filters,
themes, and Refresh preserve the collection and panel state; another JSONL
clears it and closes the panel. Confirm Capture and Worklog remain independent.

For toolbar scrolling, assert the actual page destination rather than elapsed
animation time. The browser test observes the destination on consecutive
frames with a bounded timeout, covers a late rendering frame, and checks both
animated and reduced-motion Top/Bottom actions. Also inspect the icon alignment
and Resume Command notice space as status text appears and clears.

## Verification Reporting

Every implementation report must state the verification status. Record each
applicable check as one of:

- **Passed**: the command or manual scenario completed successfully.
- **Failed**: include the failing command or scenario and a concise cause.
- **Not run**: include the reason and the remaining risk.
- **Not applicable**: use only when the change does not reach that verification
  boundary.

A successful build is not evidence that tests passed. A successful test run is
not approval to commit, push, tag, publish, or change release state.
