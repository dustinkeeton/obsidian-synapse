---
last-updated: 2026-10-09
---

# Illustrate Module

Proposes real visuals for notes (#213): the AI picks spots that warrant a photo and, only when `illustrate.mermaid` is on (#549, default off), a diagram or chart; photos are sourced from licensed repositories (Wikimedia Commons, Openverse) with license + attribution captured, diagrams are AI-emitted Mermaid, charts are Mermaid `xychart-beta` built only from numbers already in the note. With Mermaid off the analyzer prompt asks for photos only, `parseSpots` drops any `diagram`/`chart` the model still emits, and `resolveItem` refuses them, so every entry point (manual, batch, Fire Synapse, post-op legs) is covered by the one flag. Proposals are stored and reviewed per item in the unified sidebar (each item carries a `placement` preview from `shared/insertion-point.ts`, which never splits a paragraph/list/fence/table and prefers the spot after a heading's opening paragraph); accept re-resolves the anchor against the live note and inserts an embed + `synapse-illustrate` caption callout (or a Mermaid fence) there. Participates in Fire Synapse (`pipelineKey: illustrate`, after REM, before Tidy) and, per `illustrate.runAfter`, as a post-op leg after elaboration / transcription (audio, video, image) / summarize / enrichment / deep-dive, sourcing photos from the acted-on material first (`providers/source.ts`).

## Public API (`index.ts`)

```ts
class IllustrateModule {
  onViewRefreshNeeded: (() => Promise<void>) | null
  onOpenProposalView: (() => void) | null

  constructor(deps: ModuleDeps, shouldAutoAccept?: () => boolean)   // index.ts:121; #228 getter default () => false
  onload(): Promise<void>                                            // registers illustrate-current-note, illustrate-folder
  onunload(): void
  getPendingProposals(): Promise<IllustrateProposal[]>
  illustrateNote(filePath: string, ctx?: SourceContext): Promise<void>   // single note, Review toast (info notice + no-op when no provider and Mermaid are enabled); with ctx (post-op): silent, word gate + exclusions only, source images first, optional linked-page fetch, placed INSIDE ctx.producedRegion when it is a callout; skipped while a run for the path is in flight, when a proposal is already pending, or when the region already holds a synapse-illustrate callout
  scanVault(folderPath?: string, skipConfirmation?: boolean, onlyFile?: TFile): Promise<number>  // index.ts:324; PipelineScanFn; returns 0 with an info notice when no provider and Mermaid are enabled
  resumeFromCheckpoint(checkpoint: Checkpoint): Promise<void>       // index.ts:374
  acceptProposal(id: string, acceptedItemIds: string[], options?: { silent?: boolean }): Promise<void>  // index.ts:427; queued write
  rejectProposal(id: string): Promise<void>
}

// providers/*.ts — the extension seam other media sources plug into
interface MediaProvider {
  readonly id: MediaProviderId                                       // 'wikimedia' | 'openverse'
  search(query: string, opts: MediaSearchOptions): Promise<MediaCandidate[]>
}
class WikimediaProvider implements MediaProvider                     // keyless Commons API, file namespace, 1024px scaled URL
class OpenverseProvider implements MediaProvider                     // keyless /v1/images/; resetRun() + OPENVERSE_MAX_QUERIES_PER_RUN = 10
class SourceProvider implements MediaProvider                        // id 'source'; built per call from ctx.sourceImages; ranked by alt/title token overlap (imageRelevance), zero-overlap images dropped; license 'Source page', licenseUrl = pageUrl
fetchLinkedPageImages(urls: string[], { maxPages, maxImages? }): Promise<SourceImage[]>   // linked-pages.ts: fetchHtmlDocument + extractImageUrls per page; skips non-HTML / non-http(s); per-URL failures debug-logged; cap 12

// license.ts
normalizeLicense(raw: string): LicenseName | null                    // Commons short names + Openverse codes -> 'CC BY-SA' etc.
isLicenseAllowed(license: string, allowed: readonly string[]): boolean
LICENSE_NAMES, DEFAULT_LICENSE_FILTER, SOURCE_PAGE_LICENSE            // default filter ['CC0', 'Public domain', 'CC BY', 'CC BY-SA']; 'Source page' is added when any runAfter toggle turns on, never removed automatically

// note-analyzer.ts
parseSpots(response: string, maxSpots: number, options?: { mermaid?: boolean }): IllustrateSpot[]   // pure; mermaid false (default true) drops diagram/chart entries
buildSystemPrompt(mermaid: boolean): string                          // false = photo-only schema + rules

// diagram.ts / chart.ts
validateMermaid(raw: string): string | null                          // known first token, no fences/scripts, <= 4000 chars
parseChartData(value: unknown): ChartData | null
buildXyChart(data: ChartData): string

renderIllustrateSettings(ctx: SettingsSectionContext): void
```

## Types (`types.ts`)

```ts
type IllustrateSpotKind = 'photo' | 'diagram' | 'chart'
type RepositoryProviderId = 'wikimedia' | 'openverse'   // user-toggled
type MediaProviderId = RepositoryProviderId | 'source'
type IllustrateRunAfterKey = 'elaboration' | 'transcription' | 'summarize' | 'enrichment' | 'deepDive'

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
  | { id; kind: 'photo'; anchor; caption; rationale; placement?; region?; candidate: MediaCandidate }
  | { id; kind: 'diagram' | 'chart'; anchor; caption; rationale; placement?; region?; mermaid: string }   // region?: RegionLocator — the callout the visual belongs inside; absent = whole note, never inside containers

interface IllustrateProposal { id; sourceNotePath; createdAt; items: IllustrateItem[]; status: IllustrateProposalStatus; acceptedItemIds?: string[] }

interface IllustrateSettings {
  enabled: boolean                          // default false (opt-in: note-derived queries leave the vault)
  providers: Record<RepositoryProviderId, boolean>
  mermaid: boolean                          // default false (#549); gates diagram + chart kinds in the prompt, parseSpots and resolveItem
  runAfter: Record<IllustrateRunAfterKey, boolean>   // all default false; post-op chaining (pipeline/post-op-hooks.ts illustrate leg)
  fetchLinkedPages: boolean                 // default false; one request per linked page when a chained run has < 3 source images
  maxLinkedPagesPerNote: number             // default 3
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
| `note-analyzer.ts` | `NoteAnalyzer`, `parseSpots`, `buildSystemPrompt` | One AI call -> validated spots (JSON, fenced note via `wrapUntrusted`); photo-only prompt + filter when `mermaid` is off |
| `providers/wikimedia.ts` | `WikimediaProvider`, `parseCommonsPage` | Commons search via `requestUrl` (30 s timeout) |
| `providers/openverse.ts` | `OpenverseProvider`, `parseOpenverseResult`, `OPENVERSE_MAX_QUERIES_PER_RUN` | Openverse search, per-run cap, 30 s timeout |
| `providers/source.ts` | `SourceProvider`, `imageRelevance`, `toSourceCandidate` | Acted-on material's own images as candidates (#213) |
| `linked-pages.ts` | `fetchLinkedPageImages`, `MAX_LINKED_PAGE_IMAGES` | Opt-in linked-page image pooling for chained runs |
| `license.ts` | `normalizeLicense`, `isLicenseAllowed`, `LICENSE_NAMES`, `DEFAULT_LICENSE_FILTER` | License normalization + allow-list |
| `diagram.ts` | `validateMermaid`, `mermaidBlock` | Mermaid gate for AI diagrams and built charts |
| `chart.ts` | `parseChartData`, `buildXyChart` | Note-data-only `xychart-beta` |
| `inserter.ts` | `httpUrlOrEmpty(url)` (inserter.ts:6), `buildPhotoBlock(item, vaultPath, fallbackReason?)`, `buildMermaidItemBlock`, `attributionLine` | Block builders (placement lives in `shared/insertion-point.ts`); only `http:`/`https:` provider URLs are written — `mdLink` and the remote `![caption](url)` embed degrade to plain caption text for any other scheme; a failed download appends `(download failed; remote embed: <reason>)` to the callout |
| `asset-writer.ts` | `AssetWriter`, `attachmentFileName` | `requestUrl` -> `arrayBuffer` -> `vault.createBinary` at `fileManager.getAvailablePathForAttachment` (15 MB cap) |
| `proposal-store.ts` | `IllustrateStore` | JSON files in `illustrate.proposalFolderPath` |
| `note-scanner.ts` | `isEligibleNote`, `hasIllustrations`, `MIN_WORDS_TO_ILLUSTRATE` | Batch eligibility (>= 80 words, no existing illustrate callout) |
| `settings-section.ts` | `renderIllustrateSettings`, `ILLUSTRATE_FEATURE_TOOLTIP` | Accordion; license chips are raw DOM checkboxes; `.synapse-illustrate-empty-config` helper shows while no provider and Mermaid are on |
| `types.ts` | types above | |
| `*.test.ts` | tests | Every file above except `types.ts` |

## Data Flow

```
illustrateNote(path, ctx)   // post-op (#213)
  --> exclusions; wordCount(cachedRead) >= 80
  --> images = ctx.sourceImages; if fetchLinkedPages && ctx.sourceUrls && images < 3: += fetchLinkedPageImages(urls, { maxPages: maxLinkedPagesPerNote, maxImages: 12 - images })
  --> region = ctx.producedRegion kind 'callout' ? locateRegion(content, region) : none; region already has a synapse-illustrate callout (hasCallout, either spelling) -> null
  --> buildProposal(file, {}, images, region): analyzer sees ONLY the region's de-prefixed text; placements resolved with { within: region, insideContainers: true }; photo spots try SourceProvider(images) first (license 'Source page' must pass licenseFilter), then enabled repositories
  --> dedupePhotos (#583, every buildProposal): an image matched by several spots stays at the spot with the highest imageRelevance(query+caption+anchor), tie -> earliest placement line; losers re-resolve excluding every claimed fileUrl (next source image, then repositories) or drop
  --> maybeAutoAccept; refreshView; errors -> notifyError (no operation toast, no confirm)

illustrateNote(path) / scanVault(folder?, skip?, onlyFile?) / resumeFromCheckpoint(cp)
  --> exclusions: isPathExcluded(path, 'illustrate') || matchesExcludeTag(illustrate.excludeTags)
  --> batch only: isEligibleNote(cachedRead)
  --> per note, under noteQueue.run(path): buildProposal
        vault.read -> parseFrontmatter.body -> NoteAnalyzer.analyze (AI, cache-tracked; buildSystemPrompt(illustrate.mermaid), parseSpots(.., { mermaid }))
        photo   -> first enabled provider whose candidate passes isLicenseAllowed(licenseFilter)
        diagram -> spot.mermaid (already validated); null when illustrate.mermaid is off
        chart   -> validateMermaid(buildXyChart(spot.chart)); null when illustrate.mermaid is off
        every item: placement = resolveInsertionPoint(content, anchorFor(spot.anchor))   // index.ts anchorFor: leading '#' -> 'heading', else 'paragraph'
        items.length > 0 -> IllustrateStore.save(pending)
  --> maybeAutoAccept (#228) -> acceptProposal(all item ids, silent in batch)
  --> checkpoint completeItem per note; complete -> deferred refresh-sidebar-view

acceptProposal(id, itemIds)
  --> under noteQueue.run(path): photos downloaded first (AssetWriter) unless !preferDownload; failure -> remote URL embed + info notice
  --> items whose synapse-illustrate callout titled `<caption>` (either spelling, `parseCalloutHeader`) or Mermaid body already exist in the note, or photos whose fileUrl or attributionLine is already present (or repeats an earlier accepted item's fileUrl), are skipped (alreadyInserted); success notice reports `(N already present)`
  --> one vault.process: blocks.reduce(applyInsertion(acc, resolveInsertionPoint(acc, anchorFor(anchor), resolveOptions(item.region)), block))   // re-resolved live; stored placement is preview only; item.region -> inside the callout with `> ` prefixes
  --> status accepted | partially-accepted, acceptedItemIds
```

## Dependencies

| Import | From |
|--------|------|
| `AIClient`, `wrapUntrusted`, `parseJson`, `isRecord`, `stripCodeFences`, `sanitizeUrl`, `buildCallout`, `CALLOUT_TYPES.illustrate`, `parseFrontmatter`, `resolveInsertionPoint`, `applyInsertion`, `fetchHtmlDocument`, `extractImageUrls`, `SourceContext`/`SourceImage`, `wordCount`, `readJsonFile`, `ensureFolder`, exclusions, cache-notice, `reviewAction`, `redactError`, `fireAndForget`, `openScanFolderPicker` | `../shared` |
| `CommandRegistrar` (type) | `../commands` |
| `requestUrl`, `TFile`, `Plugin`, `normalizePath`, `Setting` | `obsidian` |

No feature-module imports. Mobile-safe: `requestUrl` only, no Node built-ins.
