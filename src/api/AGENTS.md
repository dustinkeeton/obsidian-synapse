# api module

Versioned public API for external agents (#623, epic #629). `main.ts:265-273` builds it after every module has loaded and assigns it to `SynapsePlugin.api`, so it is reachable as `app.plugins.plugins.synapse.api` (e.g. from the Obsidian CLI `eval`). `null` before `onload` finishes and after `onunload`.

## Public API (`index.ts`)

```ts
function createSynapseApi(deps: SynapseApiDeps): SynapseApi   // index.ts:71
const API_VERSION = 1                                          // types.ts:9; bump on a breaking shape change only
const VERB_DEFINITIONS: readonly VerbDefinition[]              // capabilities.ts:34; the source #628 generates MCP tools from

interface SynapseApiDeps {
  app: App
  pluginVersion: string
  getSettings: () => SynapseSettings
  modules: FeatureModules            // the registry record; video null on mobile
  scanFns: PipelineModuleMap         // main.ts moduleMap, called with skipConfirmation = true
  notifications: NotificationManager // only .inProgress is read
  checkpointManager: CheckpointManager
}

interface SynapseApi {
  readonly version: number
  capabilities(): ApiCapabilities
  status(): Promise<ApiStatus>
  elaborate(notePath: string): Promise<ApiResult>
  scanFolder(feature: PipelineModuleKey, folder: string, options?: { recursive?: boolean }): Promise<ScanFolderResult>
  deepDive: {
    run(notePath: string, options?: { depth?; maxNotes?; autoAccept? }): Promise<DeepDiveRunResult>
    regenerate(target: string | { proposalId } | { notePath }): Promise<DeepDiveRunResult>   // string ending ".md" = note path, else proposal id
  }
  proposals: {
    list(kind?: ProposalKind): Promise<ApiProposal[]>
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
DeepDiveRunResult = ApiResult & { runId? }
ScanFolderResult = ApiResult & { count: number | null }   // the scan's own return; null when it returns void (summarize)
```

## Verb contract

- Never throws: every verb body runs in `settle` (index.ts:53); a throw becomes `{ ok: false, error }`.
- Feature gate: a verb whose feature has `settings.<key>.enabled === false` returns `ok: false` and calls nothing (mirrors the palette command not registering).
- No modal: verbs take every answer a modal asks for. `deepDive.run` skips `selectDepth` and the confirm (`DeepDiveModule.run`); `scanFolder` passes `skipConfirmation = true`; elaboration accept passes `onStale: 'skip'`, or `'replace'` with `force: true`; title accept without `resolution` returns the conflict instead of renaming.
- Queueing: verbs call the modules' PUBLIC entry points, which take the note's `NoteOperationQueue` slot once (#483). The api layer never acquires a slot itself.
- Toasts and in-progress rows behave as for the palette command; the result mirrors the finish line.

| Verb | Module call | Reported |
|------|-------------|----------|
| `elaborate` | `elaboration.scanNote(file, true)` (bypasses the stub gate) | proposal id; the note in `written` when auto-accept rewrote it |
| `scanFolder` | `scanFns[feature]({ folder, recursive }, true)`; `""` / `/` = vault root; missing folder refused | new pending ids of the feature's proposal kind (diff of `list()` before/after; none for summarize, tidy); `count` |
| `deepDive.run` | `deepDive.run(notePath, options)` | `runId`, generated ids, created paths under auto-accept |
| `deepDive.regenerate` | `deepDive.regenerate(target)` | the proposal id; the note path when it was accepted |
| `proposals.accept` | per-kind adapter (`proposals.ts`) | refuses an id not in the kind's pending list |
| `proposals.reject` | per-kind adapter | same refusal |

## Proposal adapters (`proposals.ts`)

`buildProposalAdapters(app, modules)` (proposals.ts:33) returns `Record<ProposalKind, ProposalAdapter>`, so a new proposal kind fails to compile until it has one.

| Kind | accept call | `applied` from | `written` | `items` |
|------|-------------|----------------|-----------|---------|
| elaboration | `acceptProposal(id, content, { onStale })` | its boolean | source note | — |
| enrichment | `acceptSelectedFromView(id)` (every item) | left the pending list | source note | — |
| organize | `acceptProposal(id)` | left the pending list | `<proposedDirectory>/<basename>` when that file exists | — |
| deep-dive | `acceptProposal(id)` | its boolean | `proposedPath` | — |
| title | `acceptProposal(id, { resolution })` | `TitleAcceptOutcome` (`conflict` -> error naming the target) | renamed path or merge target | — |
| rem | `acceptProposal(id, items ?? every matchedText)` | left the pending list | source note | candidate `matchedText`s |
| illustrate | `acceptProposal(id, items ?? every item id)` | left the pending list | source note | item ids |

`ApiProposal.notePath` is the note the proposal changes; for deep dive it is the note it would create, with `sourceNotePath` the topic's source.

## Status and capabilities (`status.ts`, `capabilities.ts`)

- Key source (`keySourceFor`, status.ts:9): `default-key` (the provider is `ai.provider` and `ai.apiKey` is set), `provider-key` (`ai.providerKeys[provider]` set), `local` (Ollama, local Whisper), `missing`. No key value is ever read into a result.
- `status().ai`: one entry per `AI_FEATURE_IDS` via `resolveAIConfig` (provider, model, effort or null for Default, key source). `transcription` uses `transcriptionKeyProvider`. `systemOne` reports `provider-key` / `missing`.
- `status().features` / `capabilities().features`: keyed by every `FeatureModules` key. `available: false` = module not built (video on mobile). `keyReady`: audio and video read the transcription key; a key with an AI feature id reads that id; intake is `null`.
- `capabilities().verbs`: `VERB_DEFINITIONS` with `available` = its feature (when it names one) enabled and built. Each param carries a JSON Schema.

## Dependencies

In: `shared/` (`redactSecrets`, `resolveAIConfig`, `AI_FEATURE_IDS`, `transcriptionKeyProvider`; types), `pipeline/` (`SYNAPSE_PIPELINE` runtime, `PipelineModuleMap` / `PipelineModuleKey` types), `views/` (`PROPOSAL_KINDS` runtime, `ProposalKind` type), `settings.ts` and `modules/` (types only), `obsidian` (`TFile`, `TFolder`, `normalizePath`). No feature barrel import: modules arrive through `deps.modules`.

Out: `main.ts` only.

## Tests

| File | Covers |
|------|--------|
| `api.test.ts` | version; capabilities (verb list + schemas, disabled feature, missing key, unbuilt module); status (resolved config, no key in output); elaborate (result mapping, missing note, disabled, redacted throw); scanFolder (no-confirm call, new ids, root, unknown feature / folder); deepDive run / regenerate mapping; proposals list / accept (elaboration onStale, REM default items, title conflict) / refusals |
