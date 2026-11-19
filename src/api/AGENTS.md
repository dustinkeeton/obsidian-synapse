# api module

Versioned public API for external agents (#623, epic #629). `main.ts:265-273` builds it after every module has loaded and assigns it to `SynapsePlugin.api`, so it is reachable as `app.plugins.plugins.synapse.api` (e.g. from the Obsidian CLI `eval`). `null` before `onload` finishes and after `onunload`.

**Unstable until epic #629 ships.** No release carries this API before then, so its shape can still change without a version bump (#628 adds result descriptions to `capabilities()`). `API_VERSION` starts counting breaking changes from the first release that ships it.

## Public API (`index.ts`)

```ts
function createSynapseApi(deps: SynapseApiDeps): SynapseApi   // index.ts:107
const API_VERSION = 1                                          // types.ts:12; bump on a breaking shape change once released
const VERB_DEFINITIONS: readonly VerbDefinition[]              // capabilities.ts:55; the source #628 generates MCP tools from

interface SynapseApiDeps {
  app: App
  pluginVersion: string
  getSettings: () => SynapseSettings
  modules: FeatureModules            // the registry record; video null on mobile
  scanFns: PipelineModuleMap         // main.ts moduleMap, called with skipConfirmation = true
  notifications: NotificationManager // .inProgress (status), .jobOps + .cancelJob (jobs)
  checkpointManager: CheckpointManager
}

interface SynapseApi {
  readonly version: number
  capabilities(): ApiCapabilities
  status(): Promise<ApiStatus>
  elaborate(notePath: string, options?: ApiGenerationOptions): Promise<ApiJobStart>   // #626; job result: ApiResult
  scanFolder(feature: PipelineModuleKey, folder: string, options?: { recursive?: boolean }): Promise<ApiJobStart>   // job result: ScanFolderResult
  deepDive: {
    run(notePath: string, options?: { depth?; maxNotes?; autoAccept?; billing?; maxCalls? }): Promise<ApiJobStart>   // job result: DeepDiveRunResult
    continue(runId: string, options?: { maxNotes?; autoAccept?; billing?; maxCalls? }): Promise<ApiJobStart>   // #625; capped run's remaining topics under a fresh cap; job result: DeepDiveRunResult
    regenerate(target: string | { proposalId } | { notePath }, options?: ApiGenerationOptions): Promise<ApiJobStart>   // string ending ".md" = note path, else proposal id; job result: DeepDiveRunResult (#626)
  }
  jobs: {
    get(id: string): { ok: boolean; job: ApiJob | null; error? }   // ApiJobLookup; ok: false for a bad, unknown or expired id
    wait(id: string, timeoutMs?: number): Promise<{ ok: boolean; timedOut: boolean; job: ApiJob | null; error? }>   // default 30 s, max 10 min
    cancel(id: string): { ok: boolean; stoppedOperations: number; error? }   // ApiJobCancel; also fails the requests an external job waits on
    commit(id: string, outputs: ApiGenerationOutput[], timeoutMs?: number): Promise<ApiJobWait>   // #626; answer an awaiting-output job's requests, then wait as `wait` does
    list(): ApiJob[]   // without operations
  }
  proposals: {
    list(kind?: ProposalKind): Promise<{ ok: boolean; error?: string; items: ApiProposal[] }>   // ApiProposalList; never rejects
    accept(kind: ProposalKind, id: string, options?: { force?; items?; resolution?; content? }): Promise<ApiResult>
    reject(kind: ProposalKind, id: string): Promise<ApiResult>
  }
}

interface ApiResult {
  ok: boolean
  message?: string               // success finish line
  error?: string                 // set exactly when ok is false; redactSecrets applied
  written: string[] | null       // notes this call wrote; null = not itemized (scanFolder)
  proposals: string[]            // ids created / rewritten / accepted / rejected
  cacheUse: CacheUse | null      // null = not tracked (scanFolder, proposals.*)
}
DeepDiveRunResult = ApiResult & { runId?; endReason?: 'cap' | 'exhausted' | 'cancelled' | 'error'; remainingTopics? }   // endReason / remainingTopics from run and continue (#625)
ScanFolderResult = ApiResult & { count: number | null }   // the scan's own return; null when it returns void (summarize)

interface ApiJobStart { ok: boolean; jobId?: string; error? }   // jobId exactly when ok
interface ApiGenerationOptions { billing?: 'plugin-key' | 'external'; maxCalls?: number }   // #626; billing default = the feature's agentBilling setting
interface ApiJob {
  id: string; verb: string                                   // 'scanFolder' | 'elaborate' | 'deepDive.run' | 'deepDive.continue' | 'deepDive.regenerate'
  status: 'running' | 'awaiting-output' | 'completed' | 'failed' | 'cancelled'   // awaiting-output: running with external requests pending (#626)
  startedAt: string; finishedAt?: string
  progress: { message: string; current?: number; total?: number } | null
  result?: ApiResult                                         // once finished
  error?: string
  requests?: ApiGenerationRequest[]                          // while awaiting-output (#626)
  usage?: { billing; calls; maxCalls: number | null; inputTokens; outputTokens }   // ApiJobUsage; generating verbs only (#626)
  operations?: { id; message; state: 'running' | 'done' | 'error' | 'cancelled'; current?; total? }[]
}
interface ApiGenerationRequest { id; feature: AIFeatureId | null; messages: ChatMessage[]; createdAt; expiresAt }   // #626; messages are final (fenced, policy in the first system message)
interface ApiGenerationOutput { requestId; text; model?; stopReason?; truncated?; usage?: AIUsage }                 // #626
```

## Jobs (`jobs.ts`, #624)

- `scanFolder`, `elaborate` and the three `deepDive` verbs check arguments, the feature gate, and the note or folder first; any refusal returns `{ ok: false, error }` and starts no job. Otherwise they return `{ ok: true, jobId }` at once and the work runs as a job.
- Tagging: the job id reaches the module (`ScanScope.jobId` for scans, `DeepDiveRunOptions.jobId` for deep dive, `ElaborationJobOptions.jobId` for `scanNote`, never persisted). The module names the operations it starts with `jobOpId(base, scope)` -> `<base>@job:<jobId>`. `NotificationManager` records tagged operations in `jobOps` (`shared/job-operations.ts`): label, message, progress, end state. Op ids are unique per job.
- Tagged sites: elaboration `scanNote` (`scan-<path>`); deep-dive topic scan, generation and regenerate (`deep-dive-scan-<path>`, `deep-dive-generate-<runId>`, `deep-dive-regenerate-<proposalId>`); the folder-scan and generate ops of elaboration (`vault-scan`, `vault-generate`), summarize, enrichment, REM (`rem-directory-scan`), illustrate, tidy (`tidy-vault`), organize (`organize-scan`, `organize-generate`). Per-note ops a scan starts are not tagged.
- Status (`JobRegistry.finish`): `cancelled` when a tagged op actually ended cancelled (`jobs.cancel`, or a toast or sidebar Cancel); a cancel that stopped nothing (e.g. during deep dive's auto-accept, which runs after its last op) leaves the job to finish normally. Else `failed` when the verb's result is `ok: false` or a tagged op ended in an error (its message becomes `error`); else `completed`.
- `progress` is the newest running tagged op's line, else the last one's.
- Cancel: `jobs.cancel(id)` -> `NotificationManager.cancelJob(id)`, which runs `cancelOperation` on each running tagged op (the toast's Cancel path), returns how many it stopped (`stoppedOperations`), and cancels any tagged op the job starts afterwards. Deep dive checks its topic-scan op after extraction, so a cancel there ends the run before any run record or checkpoint exists.
- Refusals before a job starts also include an illustrate scan with nothing enabled (`IllustrateModule.scanBlocker()`, which its scan would otherwise exit on silently).
- Retention: finished jobs are kept up to `MAX_FINISHED_JOBS` (50) and `FINISHED_JOB_TTL_MS` (1 h); pruning on `start` / `get` / `wait` / `list` also forgets their op log. Jobs live in memory only and end with the plugin.
- Not backed by `InProgressRegistry` alone: that registry holds only proposal-producing ops with `meta`, which summarize and tidy scans don't pass. `jobOps` covers every tagged op.

## Verb contract

- Never throws: every verb body runs in `settle` (index.ts:83), including a job's body; a throw becomes `{ ok: false, error }`. `proposals.list` catches its own failure into `{ ok: false, items: [] }`; `status()` reports `checkpoints: null` when the checkpoint folder can't be read, and `continuableDeepDives: null` when deep dive is off or its runs can't be read; `capabilities()` is pure.
- Arguments are checked first against the verb's `VERB_DEFINITIONS` schemas (`validateArgs`, validate.ts:57; the subset used: type, enum, minimum, maximum, properties, required, additionalProperties: false, items, oneOf). A bad argument (e.g. `maxNotes: NaN`, `depth: 7`, an unknown option, an unknown kind or feature) returns `ok: false` and calls nothing.
- Feature gate: a verb whose feature has `settings.<key>.enabled === false` returns `ok: false` and calls nothing (mirrors the palette command not registering).
- No modal: verbs take every answer a modal asks for. `deepDive.run` skips `selectDepth` and the confirm (`DeepDiveModule.run`); `scanFolder` passes `skipConfirmation = true`; elaboration accept passes `onStale: 'skip'`, or `'replace'` with `force: true`; title accept without `resolution` returns the conflict instead of renaming.
- Queueing: verbs call the modules' PUBLIC entry points, which take the note's `NoteOperationQueue` slot once (#483). The api layer never acquires a slot itself.
- Toasts and in-progress rows behave as for the palette command; the result mirrors the finish line.

| Verb | Module call | Reported |
|------|-------------|----------|
| `elaborate` (job, #626) | `elaboration.scanNote(file, true, { jobId, ai })` (bypasses the stub gate) | job result: proposal id; the note in `written` when auto-accept rewrote it |
| `scanFolder` (job) | `scanFns[feature]({ folder, recursive, jobId }, true)`; `""` / `/` = vault root; missing folder refused | job result: new pending ids of the feature's proposal kind for notes inside the scanned folder (diff of `list()` before/after, filtered by scope so jobs on other folders don't claim each other's; two overlapping jobs on the same folder can still share ids; none for summarize, tidy); `count` |
| `deepDive.run` (job) | `deepDive.run(notePath, { ...options, jobId, ai })` (billing and maxCalls stay in the api); missing note refused | job result: `runId`, generated ids, created paths under auto-accept |
| `deepDive.continue` (job, #625) | `deepDive.continueRun(runId, { ...options, jobId, ai })`; a run not in `listContinuableRuns()` refused | job result: `runId`, this pass's generated ids, `endReason`, `remainingTopics` |
| `deepDive.regenerate` (job, #626) | `deepDive.regenerate(target, { jobId, ai })` | job result: the proposal id; the note path when it was accepted |
| `proposals.accept` | per-kind adapter (`proposals.ts`) | refuses an id not in the kind's pending list |
| `proposals.reject` | per-kind adapter | same refusal |

## Proposal adapters (`proposals.ts`)

`buildProposalAdapters(app, modules)` (proposals.ts:50) returns `Record<ProposalKind, ProposalAdapter>`, so a new proposal kind fails to compile until it has one.

| Kind | accept call | `applied` from | `written` | `items` |
|------|-------------|----------------|-----------|---------|
| elaboration | `acceptProposal(id, content, { onStale })`; refused first when the source note is gone | its boolean (false = note changed since generation) | source note | — |
| enrichment | `acceptSelectedFromView(id)` (every item) | stored status `accepted` / `partially-accepted` (`getProposal`) | source note | — |
| organize | `acceptProposal(id)` | stored status | `<proposedDirectory>/<basename>` when that file exists | — |
| deep-dive | `acceptProposal(id)` | its boolean | `proposedPath` | — |
| title | `acceptProposal(id, { resolution })` | `TitleAcceptOutcome` (`conflict` -> error naming the target) | renamed path or merge target | — |
| rem | `acceptProposal(id, items ?? every matchedText)` | stored status | source note | candidate `matchedText`s |
| illustrate | `acceptProposal(id, items ?? every item id)` | stored status | source note | item ids |

A module may reject a proposal inside its accept (REM / illustrate with nothing applicable, organize with the note gone, enrichment with nothing to add); the stored-status check reports that as `ok: false`, `Proposal was not applied (status: rejected)`. `items` must be a non-empty subset of the proposal's items, checked before the module is called. Enrichment, organize, REM and illustrate expose `getProposal(id)` for this check.

`ApiProposal.notePath` is the note the proposal changes; for deep dive it is the note it would create, with `sourceNotePath` the topic's source. Elaboration and deep-dive items carry `generation` (`AIResponseInfo`: provider, wire model, `stopReason`, `usage`, `cached`) when the proposal recorded it (#625).

`ApiStatus.continuableDeepDives` (#625): `ApiContinuableDeepDive[]` = `{ runId, rootNotePath, remainingTopics, totalProposals, createdAt }` from `DeepDiveModule.listContinuableRuns()`; the API declares its own `ApiDeepDiveEndReason` / `ApiContinuableDeepDive` so it imports no feature barrel, and `fromRunOutcome` (index.ts) maps a run outcome structurally.

## External generation and billing (`external.ts`, #626)

- Generating verbs (`elaborate`, `deepDive.run` / `continue` / `regenerate`) build a `JobGeneration` (external.ts): billing = `options.billing` ?? `defaultBilling(settings, feature)` (status.ts; `elaboration.agentBilling` / `deepDive.agentBilling`, default `plugin-key`), `maxCalls` ?? none. Its `aiOptions()` reach the module as `{ jobId, ai }` and every model call of the job joins them through `combineAIOptions` (`shared/ai-options.ts`): `beforeCall` counts the call and throws past `maxCalls` (`This job reached its limit of N model calls`, failing the job); `onResponse` totals tokens, skipping `cached` / `joined` replies; with external billing, `external` = `ExternalRequests.generate`.
- `AIClient.chat` with `opts.external` (`shared/ai-client.ts`): applies `withUntrustedPolicy`, hands `{ feature, messages }` to the generator, skips the response cache and coalescing (no read, no write), throws on `truncated: true` or a non-string `text`, and reports `AIResponseInfo { provider: 'external', model: output.model ?? 'external', stopReason?, usage? }`. The text then goes through the feature's normal post-processing and queue-held write, so external and plugin-key runs share one code path.
- `ExternalRequests` (external.ts): each request waits, listed on the job (`status: 'awaiting-output'`, `requests`), until `commit` answers it; `EXTERNAL_REPLY_TIMEOUT_MS` (30 min) fails an unanswered request, so a stalled caller never keeps a note's queue slot (elaboration holds it while generating). `commit` checks every output first (pending id, not answered twice, at least one) and applies none on an error. `close(reason)` fails pending and later requests: on `jobs.cancel`, on a tagged op ending cancelled (toast / sidebar Cancel, via `JobOperationLog.onCancelled`), and when the job finishes.
- `jobs.wait` (and `commit`, which waits after answering) also returns when the job is `awaiting-output`.
- A cancel that fails a request ends the module run as cancelled: deep dive checks `genOp.cancelled` / `scanOp.cancelled` in its catch (run `endReason: 'cancelled'`, checkpoint discarded).
- Not covered: the System 1 decision lane (`ai.systemOne`, when on) keeps using its own key; folder scans and the other features always bill the plugin key. Commands run in Obsidian never bill externally.

## Status and capabilities (`status.ts`, `capabilities.ts`)

- Key source (`keySourceFor`, status.ts:9): `default-key` (the provider is `ai.provider` and `ai.apiKey` is set), `provider-key` (`ai.providerKeys[provider]` set), `local` (Ollama, local Whisper), `missing`. No key value is ever read into a result.
- `status().ai`: one entry per `AI_FEATURE_IDS` via `resolveAIConfig` (provider, model, effort or null for Default, key source, default `billing`, #626). `transcription` uses `transcriptionKeyProvider`. `systemOne` reports `provider-key` / `missing`.
- `status().features` / `capabilities().features`: keyed by every `FeatureModules` key. `available: false` = module not built (video on mobile). `keyReady`: audio and video read the transcription key; a key with an AI feature id reads that id; intake is `null`.
- `capabilities().verbs`: `VERB_DEFINITIONS` with `available` = its feature (when it names one) enabled and built. Each param carries a JSON Schema.

## Dependencies

In: `./validate.ts` (schema checks over `VERB_DEFINITIONS`), `./jobs.ts` (`JobRegistry`), `./external.ts` (`JobGeneration`, `ExternalRequests`); `shared/` (`redactSecrets`, `generateId`, `JobOperation` / `OperationOutcome` / `AIRequestOptions` / `ExternalGenerator` / `ChatMessage` / `AIUsage` types, `resolveAIConfig`, `AI_FEATURE_IDS`, `transcriptionKeyProvider`; types), `pipeline/` (`SYNAPSE_PIPELINE` runtime, `PipelineModuleMap` / `PipelineModuleKey` types), `views/` (`PROPOSAL_KINDS` runtime, `ProposalKind` type), `settings.ts` and `modules/` (types only), `obsidian` (`TFile`, `TFolder`, `normalizePath`). No feature barrel import: modules arrive through `deps.modules`.

Out: `main.ts` only.

## Tests

| File | Covers |
|------|--------|
| `external.test.ts` | `ExternalRequests` expiry, close, `whenAwaiting`; `JobGeneration` call and token totals (cached / joined skipped), `maxCalls` refusal (#626) |
| `jobs.test.ts` | `JobRegistry`: id at once + progress, failed via result / op error / throw, cancel via `jobs.cancel` and via the toast, wait timeout, unknown ids, list without operations, TTL + cap pruning |
| `api.test.ts` | version; capabilities (verb list + schemas, every verb name resolves to a function, disabled feature, missing key, unbuilt module); status (resolved config, no key in output, unreadable checkpoints); argument validation (deepDive.run options, regenerate target forms, required path); elaborate as a job (result mapping, refusals, redacted throw); external generation (#626: exact request with the policy, commit applies output + usage, multi-request commit loop, setting default vs per-call billing, invalid outputs apply none, commit on a plugin-key job, truncated output, cancel via `jobs.cancel` and via the toast, `maxCalls`, billing kept out of module options, `status().ai[*].billing`); scanFolder as a job (no-confirm call with jobId, new ids, root, failed via op error, cancel, refusals start no job, availability across scan features); deepDive.run as a job (options + jobId, missing note, failed outcome, endReason + remainingTopics); deepDive.continue (job, refusals); status continuableDeepDives; proposal `generation`; jobs verb argument checks; regenerate mapping; proposals list (all kinds, store failure) / accept (elaboration onStale + missing note, REM default and invalid items, illustrate subset, module-side rejection, enrichment, organize moved path, deep-dive boolean, title conflict) / refusals |
