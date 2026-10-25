# Performance History and Engineering Decisions

This document preserves performance observations and engineering decisions made before the v2.0.0 release preparation. The latest product commit covered here is `5e086ec`. It is a historical record, not a new benchmark, a claim about the released v2.0.0 build, or a replacement for current verification.

For current verification requirements, see [Test Matrix](test-matrix.md). For data flow and state behavior, see the [frontend README](../frontend/README.md).

## 1. Scope and interpretation

The results below were collected on different commits, inputs, runtime configurations, and automation conditions. **Do not combine them into a single before/after comparison.** Findings from older revisions do not necessarily describe current behavior.

The original local reports, measurement artifacts, temporary profiles, screenshots, and comparison binaries were reviewed before the October 25, 2026 cleanup and then removed. This document preserves selected evidence and decisions; it is **not** a complete reproduction package. Reproducing a measurement requires a fresh setup from the referenced commit and the documented test conditions.

| Period and investigation | Evidence reviewed | Execution context |
| --- | --- | --- |
| Oct 14: file dialogs and process memory | Dialog reports and process observations | Tauri app; sequential runs |
| Oct 14: Refresh lifecycle | Timing, state, lifecycle, and validation summaries | Browser-based App test with a simulated native bridge; not an EXE benchmark |
| Oct 14: offscreen rendering | `content-visibility` comparison and trace summaries | Headless Edge; not a Tauri EXE benchmark |
| Oct 25: 9-A baseline | Code-path analysis, input sizes, process and timing measurements | Actual Tauri EXE; separate Rust/Node supporting tests |
| Oct 25: 9-B-1 | Command-response measurements and output comparisons | Actual Tauri EXE, before/after |
| Oct 25: 9-B-2 | Filter timings, DOM identity, profiles, and output comparisons | Actual Tauri EXE, before/after |
| Oct 25: 9-C | Candidate tests, geometry, text-selection, GUI, and build results | Actual Tauri EXE; auxiliary experiments distinguished |

**Measurement terminology:** MiB means 1,048,576 bytes. Windows *Private Bytes* measures private committed virtual memory, not physical RAM or VRAM. Summed *Working Sets* may double-count shared pages. JavaScript heap usage is not total WebView2 memory. A process-group peak must be measured at one point in time, not constructed by adding unrelated per-process maxima. Temporary growth or delayed release is not sufficient evidence of a memory leak.

CPU seconds are cumulative processor time; they can exceed elapsed time on a multicore system. Script/Layout/Style counters, animation frames, command completion, and Windows message-response probes measure different things. Tooling overhead and accessibility API activity are noted where relevant.

## 2. Earlier investigation: file dialogs and process memory

Commits `e127555` and `955f901` were compared on one Windows desktop with WebView2 155-series. Native file dialogs were opened and cancelled manually before a JSONL session had been selected.

- `e127555`: Rust host Private Bytes rose from 5.48 MiB to 12.95 MiB ten seconds after the first cancellation, and to 13.50 MiB after the second.
- `955f901`: 4.97 MiB before the dialog and 13.17 MiB ten seconds after the first cancellation.
- Shell and file-dialog modules loaded and some remained resident. Module presence alone does not establish how many heap bytes belong to each module.

Both revisions showed similar retained memory after their first dialog use. The small additional increase after a second cancellation did not establish a long-term leak. An unsuccessful development-URL run was excluded from valid comparisons.

A separate process-group comparison used the same selected JSONL, Terminal theme, default YOU/CODEX filters, and a 1220×820 window. Each revision started in a fresh process once; measurements summed the application host and six WebView2 processes identified through parent-process relationships.

| Commit | Private after startup | Private after load | Working Set after startup | Working Set after load |
| --- | ---: | ---: | ---: | ---: |
| `e127555` | 179.8 MiB | 254.1 MiB | 332.3 MiB | 378.3 MiB |
| `955f901` | 200.6 MiB | 266.9 MiB | 350.3 MiB | 423.8 MiB |

The loaded state was confirmed manually before the subsequent observation; the measurements were **not** captured at an exact ten-second offset from the state transition. Single sequential runs do not establish a general memory regression or its cause.

## 3. Earlier investigation: Refresh lifecycle and DOM retention

The App and transcript renderers were compared across `e127555`, `ffc6c67`, `bd74a76`, and `49803c4`. The native bridge was simulated, so these are not complete EXE timings. The reported validation covered 288 diagnostic scenarios, 288 timing samples, and 2,455 passing assertions.

For `49803c4`, a same-content Refresh using newly created DTO objects took the following per-theme medians (six samples each): Terminal **57.5 ms**, Markdown **52.3 ms**, DM **68.2 ms**, and DM Dark **55.6 ms**. The App update replaced message sections and bodies; focus within a message, text selection, and horizontal table scrolling were not retained. Toolbar focus was tested separately from message focus. Retaining an attachment in isolation did not prove retention across the full App lifecycle.

At that revision, the `status === loaded` rendering condition removed message content while loading. The later implementation retains the last successful transcript during loading and failure. In 9-B-2, **20 of 20** sampled message bodies were retained across same-content Refresh. Current behavior is defined by the frontend contract and Refresh regression tests; the older reset behavior should not be treated as a present-day defect.

## 4. Earlier investigation: rejecting `content-visibility`

Commit `49803c4` was tested in headless Edge 155-series on a Windows 10 desktop-class system (six-core/twelve-thread CPU, approximately 16 GiB RAM, discrete GPU). The controlled viewport was 1198×722 CSS pixels at device-pixel ratio 1. The input contained 65 normally visible messages and 13 tables. No private transcript content is reproduced here.

Three variants were compared:

- **A:** conventional, fully rendered DOM;
- **B:** `content-visibility: auto`;
- **C:** `content-visibility: auto` with per-theme median measured heights as intrinsic-size fallbacks.

Each A/B and A/C comparison contained 144 samples across four themes, candidate/order combinations, three anchors, and three repetitions. Trace Paint/Raster CPU from a 1600-pixel wheel pass was measured separately from animation-frame intervals and rapid-scroll stability.

- B reduced median Paint CPU by approximately **28.9%** in Markdown, **21.4%** in DM, and **23.7%** in DM Dark, but increased it for the plain-text anchor in all four themes. Aggregate paint savings did not establish a better scrolling experience.
- Animation-frame p95 was approximately **16.8 ms** for both A and B, with no clear improvement; additional Layout/Style work was observed.
- In a separate rapid-scroll pass, Terminal anchor displacement reached **+1,661 px** for B and **+10,057 px** for C. Initial document height and scrollbar extent also changed.
- Sampled Terminal screenshots showed background-only frames in **0/42** A samples, **6/54** B samples, and **5/54** C samples. These are screenshot observations, not native rendering frequency or a measured frame-drop percentage.
- Reduced DOM size, AST size, or JavaScript heap was not established; initial Working Set changes were not evidence of native application memory savings.

**Decision: reject B and C.** Reading position, document geometry, and re-entry stability outweighed the limited paint improvements. This result does not rule out every possible intrinsic-size strategy, nor does it establish that a native scrollbar artifact was fixed.

## 5. Phase 9-A: architecture and EXE baseline

**Baseline commit:** `254e8f1` (Oct 25, 2026).

**Test-system class:** Windows 10 desktop, six-core/twelve-thread CPU, approximately 16 GiB RAM, discrete GPU, local HDD storage, and WebView2 156-series. A 125% Windows display scale was in use; the default WebView viewport was 1360×760 logical pixels. Power and display settings were not changed for the tests. These measurements **are not** representative benchmarks for low-end notebooks or integrated-GPU systems.

The initial synthetic large case was approximately 4.75 MB: 5,000 total messages, 2,500 visible under default filters, and roughly **160,447 HTML elements**. Initial display took **1,346.7 ms**, reloading the same session **314.4–323.2 ms**, and filter changes approximately **900–1,399 ms**. Later foreground/accessibility-active measurements differed substantially: initial display approximately **3.8–3.9 seconds** and filter additions approximately **4.9 seconds**. These batches must not be pooled into one distribution.

At an intended sampling interval of roughly 250 ms, process-group Private Bytes increased from **244.0 MiB** idle to **718.4 MiB** after displaying the large case. A peak near **2,778 MiB** during repeated filter/theme/session transitions was **not** typical idle consumption. After Reset and natural idle, JavaScript heap fell to approximately **2.62 MiB**, while group Private Bytes remained near **776 MiB**, later approximately **731 MiB** after 30 seconds. Live JavaScript data and memory retained by the native runtime, allocator, or accessibility infrastructure were not separately attributed.

Approximately **13.9 million** Windows accessibility API calls were observed in one later run, and approximately **13.77 million** in a fresh run without additional native automation-tool calls. A clean foreground comparison without this influence was not obtained. No particular client was established as the cause. Disabling accessibility support was **not** proposed as an optimization.

### Data flow and optimization candidates

- Plain and compressed JSONL are read through streams with a reusable line buffer. A single extremely long line can still cause a transient memory peak. The code was not found to fully parse every file twice.
- Rust-owned DTO data uses ownership transfer and `Arc` for source text. JSON IPC transport nevertheless duplicates some strings between `entries` and `transcript_blocks`. One supporting DTO experiment reduced **8,759,068 bytes** to **4,541,861 bytes** when retaining only blocks; **the IPC contract was not changed**, and this does not imply a corresponding 48% improvement in application memory or elapsed time.
- The complete block array and filtered view share object references. Collection snapshots intentionally retain captured text. AST/segment caches use `WeakMap`; these behaviors were not classified as unnecessary duplication.
- Of 20 surviving messages, only **1/20** message-body DOM nodes were reused after a filter change, compared with **20/20** after Refresh. Stable message identity was a justified optimization candidate.
- At the baseline, synchronous parse and top-level Export commands were candidates for native window-responsiveness measurement. Command structure alone did not establish observed blocking duration.
- Reloading a real set of **29** Navigator sessions took about **1.35 seconds**. Activity scanning serves a purpose; caching or parallelization was left unimplemented pending evidence from larger session sets.
- A Node-only Collection inline-code experiment took approximately **5.9 / 60 / 164 ms** for **512 / 2,048 / 4,096** segments respectively. This did not establish a common UI bottleneck and did not justify a change.

## 6. Phase 9-B-1: native command responsiveness

**Adopted in:** `55d433c`.

The parse and Export file operations in `frontend/src-tauri/src/lib.rs` were moved to `spawn_blocking`. An async mutex is acquired before scheduling a worker, serializing file operations. Its owned guard remains held until the worker finishes, including when the awaiting request is cancelled or a worker panics. This does **not** serialize subsequent IPC delivery or rendering.

Synthetic small/medium/large cases contained 100/1,000/5,000 messages, with half normally visible. The **large-noise** input was approximately 55.2 MB, including 48 MiB of non-rendered events; a highly repetitive compressed case was also tested. The actual EXE was measured three times per condition in before/after order and again in reversed order for a supporting comparison.

A native Windows probe measured `WM_NULL` round-trip latency at a target interval of 20 ms. The rightmost column is the **maximum observed probe delay across the three runs**, not an exact duration of command blocking or physical mouse-input latency.

| Operation | Command completion median, before → after | Native probe maximum, before → after |
| --- | ---: | ---: |
| Parse large | 131.9 → 156.1 ms | 31.9 → 31.4 ms |
| Parse large-noise | 185.4 → 226.4 ms | 75.6 → 37.5 ms |
| Parse compressed large-noise | 167.2 → 189.0 ms | 59.9 → 34.9 ms |
| Export large (1,252 files) | 848.8 → 891.0 ms | 326.8 → 3.4 ms |
| Export large-noise | 783.3 → 1,070.7 ms | 348.5 → 2.6 ms |

The reversed-order large-noise comparison also showed native latency improvements: parse **93.3 → 34.3 ms**, Export **396.7 → 2.7 ms**. **This is a responsiveness improvement, not proven throughput, CPU, or memory optimization.** Process-group Private Bytes peaks were **394.9 → 423.5 MiB** in the main comparison and **395.0 → 382.8 MiB** in the reversed one; the memory direction was not consistent.

All **15** successful parse-response hashes matched. Across **11,349** paired Export files, **11,325** body-file raw hashes matched, and index/manifest contents matched after excluding generated timestamps. Error, cancellation, overwrite protection, Collection, and Refresh behaviors were preserved. Native folder-dialog cancellation and success were checked through manual interaction.

Verification at that revision: **63 frontend unit**, **19 browser**, **156 backend**, and **10 Tauri** tests passed; static analysis reported no errors or warnings; EXE compilation succeeded. An initial integrated verification run was interrupted by a browser timeout and execution restrictions; the affected required checks subsequently passed when rerun separately. Windows build invocation used `npm.cmd run tauri:build -- --no-bundle` to avoid PowerShell/npm argument-forwarding issues; no product dependency changes were needed.

## 7. Phase 9-B-2: filter calculation and DOM reuse

**Adopted in:** `8c75df0`.

An existing identity based on source path, role, timestamp, content, and duplicate occurrence is now used as the keyed identity for all three transcript renderers. The identity map is reused only while the source block array reference and source path remain unchanged. A new DTO, a different path, or Reset triggers recalculation. No cache retaining previously loaded sessions was introduced.

The main comparison covered small/medium/large inputs, four themes, five role filters toggled on and off, and three repetitions: **360 filter transitions each before and after**. The large input was approximately **5.04 MB**, with 5,000 messages plus 51 system/introduction blocks, and 2,500 messages initially visible. Twelve reversed-order Terminal observations on a fresh profile provided a secondary comparison. Timing ran from interaction through the Svelte update and two animation frames; it was **not** a presented-frame completion measurement.

| Large input, theme | Add Tool calls, before → after | Add Meta, before → after |
| --- | ---: | ---: |
| Terminal | 3,500 → 1,070 ms | 2,878 → 347 ms |
| Markdown | 3,557 → 1,041 ms | 2,991 → 351 ms |
| DM | 3,631 → 1,060 ms | 2,975 → 353 ms |
| DM Dark | 3,765 → 1,045 ms | 2,977 → 357 ms |

Sampled message-body DOM reuse increased from **1/20 to 20/20** across filtering; Refresh remained at **20/20**. Regression checks covered duplicate messages, handlers for moved messages, collapse reset rules, Collection source order and captured-text snapshots, Capture, and Export. Reintroducing previously hidden large message bodies still took approximately **2,192–2,333 ms** after the change.

In the actual EXE sampling profile, identity generation previously accounted for approximately **19 ms per transition** and Markdown DOM construction for roughly **84–94 ms**; filter projection itself was usually **0–1 ms** and was left unchanged. These sampled costs are not additive components of an exact wall-time breakdown, and Node-only supporting measurements were kept separate.

Across the same 360-transition workload, renderer cumulative CPU time changed from **512.25 to 168.31 seconds**, concurrent process-group Private Bytes peak from **6,826.0 to 3,029.6 MiB**, and observation duration from **1,140.0 to 365.3 seconds**. The test involved tens of millions of Windows accessibility API calls. These peaks **do not represent ordinary user RAM consumption, baseline resource requirements, or proof of a memory leak**; a clean accessibility-free control was unavailable.

Verification: **65 unit**, **20 browser**, **156 backend**, and **10 Tauri** tests passed, along with full static and EXE build checks. Two optional tests requiring private local data were not run.

## 8. Phase 9-C: prioritizing rendering compatibility

**Adopted in:** `5e086ec`. **Comparison baseline:** `8c75df0`.

Synthetic content included Korean and English prose, emphasis, lists, tables, and code. The **large** input was approximately **5.11 MB** (5,000 total messages, 2,500 initially visible). The **long-body** input was approximately **2.41 MB** (100 total messages, 50 initially visible, with long paragraphs, 200-line code blocks, and 40-row tables). The investigation compared **64 operations** before and after across four inputs, four themes, and four operations, then repeated Terminal large/long comparisons three times per version.

| Candidate | Observed result and decision |
| --- | --- |
| Full virtualization or deferred message-body creation | Removing offscreen bodies in an isolated DOM reproduction reduced the text available to Select All. This was **not** a complete virtual-list performance implementation. Not adopted without a design preserving full selection, accessibility, and focus. |
| `contain: layout style` | Large initial display about 2,989 ms; redisplay about 2,226 ms. No substantial improvement; rejected. |
| `content-visibility: auto` on message bodies only | Large initial display 1,172 ms; redisplay 461 ms; rapid-sweep p95 66.8 ms. Not adopted. |
| `content-visibility: auto` on whole messages, with `auto 600px` intrinsic sizing | Large initial display 650 ms; redisplay 202 ms, but violated selection/position requirements; rejected. |
| Remove redundant `span` wrappers for ordinary text tokens | Preserved semantic elements, text, and selection while reducing HTML element count; adopted. |

The `content-visibility` candidate timings above came from **single-run Terminal supporting experiments**, not comprehensive multi-run product benchmarks. The acceptance criterion permitted an estimated scrollbar extent but required keeping the current reading position stable. In an actual EXE build of the `content-visibility` candidate, Select All displaced the same visible message by approximately **216,829 px** in Markdown and **135,954 px** in DM/DM Dark. In a separate CSS-only experiment, the Bottom action stopped approximately **76,815–106,648 px** short on long-body content. Neither the fast candidate nor experimental scroll corrections remained in the product.

The adopted change creates DOM Text nodes directly for ordinary `text` tokens in `message-dom.ts`, without surrounding `span` elements, and applies whitespace preservation to appropriate semantic parents and table cells in `transcript.css`. Paragraphs, emphasis, lists, tables, code, and validated links retain their semantic elements.

| Terminal, median of three runs | Before | After | Reduction |
| --- | ---: | ---: | ---: |
| Large initial display | 3,092.9 ms | 2,831.3 ms | 8.5% |
| Large YOU-message redisplay | 2,305.0 ms | 2,186.1 ms | 5.2% |
| Long-body initial display | 790.8 ms | 770.2 ms | 2.6% |
| Long-body YOU-message redisplay | 322.1 ms | 308.7 ms | 4.2% |

For the large case, HTML elements fell from **107,942 to 77,942** in Terminal, **110,442 to 80,442** in Markdown, and **110,443 to 80,443** in DM/DM Dark: **30,000 fewer elements**, or about **27–28%**. **This is not virtualization; DOM cost still scales with rendered content.** A single-run Markdown comparison was slightly slower after the change (initial **2,983.8 → 3,050.4 ms**, redisplay **2,184.8 → 2,245.6 ms**). A timing improvement is not guaranteed for every input or theme.

Across the same 64-operation workload, renderer cumulative CPU time changed from **49.27 to 47.41 seconds** and concurrent process-group Private Bytes peak from **2,349.6 to 2,342.0 MiB**. The roughly **0.3%** memory difference was not considered material. End-of-run heap values of approximately **15–17 MiB** varied with garbage collection and do not prove the absence of long-term leaks. A 60-frame document sweep remained around **16.8 ms p95** in most cases; smoother sustained scrolling was not established.

Baseline and final EXE comparisons across large/long inputs and four themes matched for complete text, selected-text hashes, all message geometries, `scrollHeight`, and message counts (**8/8** combinations). In the final EXE, reading-position displacement after wheel input and Ctrl+A was **0 px** across all four themes; the final offscreen message remained selectable. Top/Bottom, Ctrl+Home/End, table focus, Collection, and Refresh were checked. Some Capture/Copy checks used a clipboard stub rather than the native clipboard. The 1100×720 check used viewport emulation rather than a native minimum-size window. AX-tree inspection was not a complete screen-reader usability audit.

Final verification: **65 unit**, **21 browser**, **156 backend**, and **10 Tauri** tests passed; two private-local optional checks were not run; static analysis reported no errors or warnings; production frontend and EXE builds succeeded. The first run exposed a test that assumed the old empty-text `span` shape. It was updated to assert empty Text-node preservation, and the full suite then passed.

## 9. Retained decisions and open limitations

- Retain streaming for plain/compressed JSONL, owned DTOs and `Arc`, shared filtered block references, Collection text snapshots, `WeakMap` caches, and attachment cleanup. Memory numbers alone do not justify changing data meaning or reducing accessibility.
- Keep the benefits distinct: **9-B-1** improves native window responsiveness; **9-B-2** reduces identity recomputation and preserves existing message DOM; **9-C** removes unnecessary HTML elements without changing content semantics.
- Redisplaying many previously hidden message bodies still takes about **2.2 seconds** in the measured large case. More ambitious virtualization would need a separate design and validation for full text selection, accessibility, focus, and stable reading anchors. These historical measurements do not authorize that change.
- IPC duplication, unusually long JSONL lines, Refresh AST recomputation, Navigator activity scanning over very large session sets, and extreme Collection inline-code segmentation remain **measurement candidates**, not confirmed defects requiring automatic fixes.
- The product uses independent Text/Code selectors for fonts installed on Windows. No candidate font is bundled; Default preserves existing rules. Collection prose is not indiscriminately classified as code. Previous font-comparison artifacts were removed and their missing measurements are not reconstructed.
- The experimental 8-B usage-visualization feature was not adopted. This document does not propose reintroducing it.
- There are **no direct benchmark results** for low-end Windows laptops, 4/8 GiB RAM configurations, integrated GPUs, or thermal/power-limited systems. Structural risks must not be presented as measured performance or extrapolated with a simple multiplier.

## 10. Rebuilding after local cleanup

Build outputs, project-local dependencies, and measurement artifacts are reproducible from the repository and toolchains. After a fresh checkout or cleanup, run `npm ci` in `frontend/`, then follow the [full verification procedure](test-matrix.md#full-verification). Removing local Rust `target` directories causes a full rebuild on the next run.

Historical passing results do not replace verification of a newly compiled build. The cleanup preserved source, regression tests, configuration, lockfiles, Git history, and personal session data outside version control; it did not require regenerating large build artifacts solely to document or remove them. Globally installed toolchains and shared dependency caches were outside the cleanup scope.
