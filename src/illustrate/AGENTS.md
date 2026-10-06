---
last-updated: 2026-10-05
---

# Illustrate Module

Proposes real visuals for notes (#213): the AI picks spots that warrant a photo, diagram, or chart; photos are sourced from licensed repositories (Wikimedia Commons, Openverse) with license + attribution captured, diagrams are AI-emitted Mermaid, charts are Mermaid `xychart-beta` built only from numbers already in the note. Proposals are stored and reviewed per item in the unified sidebar (each item carries a `placement` preview from `shared/insertion-point.ts`); accept re-resolves the anchor against the live note and inserts an embed + `synapse-illustrate` caption callout (or a Mermaid fence) there. Participates in Fire Synapse (`pipelineKey: illustrate`, after REM, before Tidy).

## Public API (`index.ts`)

```ts
class IllustrateModule {
  onViewRefreshNeeded: (() => Promise<void>) | null
  onOpenProposalView: (() => void) | null

  constructor(deps: ModuleDeps, shouldAutoAccept?: () => boolean)   // index.ts:52; #228 getter default () => false
  onload(): Promise<void>                                            // registers illustrate-current-note, illustrate-folder
  onunload(): void
  getPendingProposals(): Promise<IllustrateProposal[]>
  illustrateNote(filePath: string): Promise<void>                    // index.ts:132; single note, Review toast
  scanVault(folderPath?: string, skipConfirmation?: boolean, onlyFile?: TFile): Promise<number>  // index.ts:160; PipelineScanFn
  resumeFromCheckpoint(checkpoint: Checkpoint): Promise<void>       // index.ts:206
  acceptProposal(id: string, acceptedItemIds: string[], options?: { silent?: boolean }): Promise<void>  // index.ts:258; queued write
  rejectProposal(id: string): Promise<void>
}

// providers/*.ts — the extension seam other media sources plug into
interface MediaProvider {
  readonly id: MediaProviderId                                       // 'wikimedia' | 'openverse'
  search(query: string, opts: MediaSearchOptions): Promise<MediaCandidate[]>
}
class WikimediaProvider implements MediaProvider                     // keyless Commons API, file namespace, 1024px scaled URL
class OpenverseProvider implements MediaProvider                     // keyless /v1/images/; resetRun() + OPENVERSE_MAX_QUERIES_PER_RUN = 10

// license.ts
normalizeLicense(raw: string): LicenseName | null                    // Commons short names + Openverse codes -> 'CC BY-SA' etc.
isLicenseAllowed(license: string, allowed: readonly string[]): boolean
LICENSE_NAMES, DEFAULT_LICENSE_FILTER                                // ['CC0', 'Public domain', 'CC BY', 'CC BY-SA']

// diagram.ts / chart.ts
validateMermaid(raw: string): string | null                          // known first token, no fences/scripts, <= 4000 chars
parseChartData(value: unknown): ChartData | null
buildXyChart(data: ChartData): string

renderIllustrateSettings(ctx: SettingsSectionContext): void
```

## Types (`types.ts`)

```ts
type IllustrateSpotKind = 'photo' | 'diagram' | 'chart'
type MediaProviderId = 'wikimedia' | 'openverse'

interface MediaCandidate {
  provider: MediaProviderId; title: string
  fileUrl: string        // download / URL-embed target
  thumbnailUrl: string   // sidebar preview only, never downloaded before accept
  pageUrl: string; license: string; licenseUrl: string; attribution: string; mimeType?: string
}

interface ChartData { title: string; xLabels: string[]; series: Array<{ label?: string; values: number[] }>; yLabel?: string }

type IllustrateSpot =   // analyzer output, one per anchor
  | { kind: 'photo'; query: string; anchor; caption; rationale }
  | { kind: 'diagram'; mermaid: string; ... }
  | { kind: 'chart'; chart: ChartData; ... }

type IllustrateItem =   // resolved, persisted; placement?: ResolvedInsertion (shared/insertion-point.ts) is the review preview, absent on pre-placement proposals
  | { id; kind: 'photo'; anchor; caption; rationale; placement?; candidate: MediaCandidate }
  | { id; kind: 'diagram' | 'chart'; anchor; caption; rationale; placement?; mermaid: string }

interface IllustrateProposal { id; sourceNotePath; createdAt; items: IllustrateItem[]; status: IllustrateProposalStatus; acceptedItemIds?: string[] }

interface IllustrateSettings {
  enabled: boolean                          // default false (opt-in: note-derived queries leave the vault)
  providers: Record<MediaProviderId, boolean>
  maxItemsPerNote: number                   // default 3
  licenseFilter: string[]                   // default DEFAULT_LICENSE_FILTER
  preferDownload: boolean                   // default true; false embeds the remote URL
  proposalFolderPath: string                // default '.synapse/illustrate'
  excludeTags: string[]                     // default ['no-illustrate']
}
```

## File Inventory

| File | Exports | Purpose |
|------|---------|---------|
| `index.ts` | `IllustrateModule`, barrel | Lifecycle, commands, scan/resume batch core, accept/reject |
| `note-analyzer.ts` | `NoteAnalyzer`, `parseSpots` | One AI call -> validated spots (JSON, fenced note via `wrapUntrusted`) |
| `providers/wikimedia.ts` | `WikimediaProvider`, `parseCommonsPage` | Commons search via `requestUrl` |
| `providers/openverse.ts` | `OpenverseProvider`, `parseOpenverseResult`, `OPENVERSE_MAX_QUERIES_PER_RUN` | Openverse search, per-run cap |
| `license.ts` | `normalizeLicense`, `isLicenseAllowed`, `LICENSE_NAMES`, `DEFAULT_LICENSE_FILTER` | License normalization + allow-list |
| `diagram.ts` | `validateMermaid`, `mermaidBlock` | Mermaid gate for AI diagrams and built charts |
| `chart.ts` | `parseChartData`, `buildXyChart` | Note-data-only `xychart-beta` |
| `inserter.ts` | `buildPhotoBlock`, `buildMermaidItemBlock`, `attributionLine` | Block builders (placement lives in `shared/insertion-point.ts`) |
| `asset-writer.ts` | `AssetWriter`, `attachmentFileName` | `requestUrl` -> `arrayBuffer` -> `vault.createBinary` at `fileManager.getAvailablePathForAttachment` (15 MB cap) |
| `proposal-store.ts` | `IllustrateStore` | JSON files in `illustrate.proposalFolderPath` |
| `note-scanner.ts` | `isEligibleNote`, `hasIllustrations`, `MIN_WORDS_TO_ILLUSTRATE` | Batch eligibility (>= 80 words, no existing illustrate callout) |
| `settings-section.ts` | `renderIllustrateSettings`, `ILLUSTRATE_FEATURE_TOOLTIP` | Accordion; license chips are raw DOM checkboxes |
| `types.ts` | types above | |
| `*.test.ts` | tests | Every file above except `types.ts` |

## Data Flow

```
illustrateNote(path) / scanVault(folder?, skip?, onlyFile?) / resumeFromCheckpoint(cp)
  --> exclusions: isPathExcluded(path, 'illustrate') || matchesExcludeTag(illustrate.excludeTags)
  --> batch only: isEligibleNote(cachedRead)
  --> per note, under noteQueue.run(path): buildProposal
        vault.read -> parseFrontmatter.body -> NoteAnalyzer.analyze (AI, cache-tracked)
        photo   -> first enabled provider whose candidate passes isLicenseAllowed(licenseFilter)
        diagram -> spot.mermaid (already validated)
        chart   -> validateMermaid(buildXyChart(spot.chart))
        every item: placement = resolveInsertionPoint(content, anchorFor(spot.anchor))   // index.ts anchorFor: leading '#' -> 'heading', else 'paragraph'
        items.length > 0 -> IllustrateStore.save(pending)
  --> maybeAutoAccept (#228) -> acceptProposal(all item ids, silent in batch)
  --> checkpoint completeItem per note; complete -> deferred refresh-sidebar-view

acceptProposal(id, itemIds)
  --> under noteQueue.run(path): photos downloaded first (AssetWriter) unless !preferDownload; failure -> remote URL embed + info notice
  --> one vault.process: blocks.reduce(applyInsertion(acc, resolveInsertionPoint(acc, anchorFor(anchor)), block))   // re-resolved live; stored placement is preview only
  --> status accepted | partially-accepted, acceptedItemIds
```

## Dependencies

| Import | From |
|--------|------|
| `AIClient`, `wrapUntrusted`, `parseJson`, `isRecord`, `stripCodeFences`, `sanitizeUrl`, `buildCallout`, `CALLOUT_TYPES.illustrate`, `parseFrontmatter`, `resolveInsertionPoint`, `applyInsertion`, `wordCount`, `readJsonFile`, `ensureFolder`, exclusions, cache-notice, `reviewAction`, `redactError`, `fireAndForget`, `openScanFolderPicker` | `../shared` |
| `CommandRegistrar` (type) | `../commands` |
| `requestUrl`, `TFile`, `Plugin`, `normalizePath`, `Setting` | `obsidian` |

No feature-module imports. Mobile-safe: `requestUrl` only, no Node built-ins.
