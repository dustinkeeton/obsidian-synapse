---
last-updated: 2026-09-14
---

# Modules Registry

Feature-module lifecycle registry (#504): the single ordered list that constructs every feature module, loads the ones whose settings section is enabled, and unloads them in reverse. `main.ts` iterates this list instead of naming modules. Imports every feature barrel plus `shared` (`ModuleDeps`, `FeatureModule`, `FeatureSettingsKey`), `settings` (types), and `obsidian` (`Platform`). Adding a module = one `MODULE_FACTORIES` entry plus its `enabled`-flagged settings section.

## Public API

Exported from `index.ts`:

```ts
// registry.ts:35
type FeatureModules = { [K in FeatureSettingsKey]: FeatureModuleClasses[K] }   // one slot per enabled-flagged settings section; video: VideoModule | null
type FeatureModuleKey = keyof FeatureModules                                     // 'elaboration' | 'audio' | 'video' | 'image' | 'enrichment' | 'summarize' | 'tidy' | 'organize' | 'deepDive' | 'title' | 'rem' | 'intake'

// registry.ts:39
interface ModuleWiring {
  transcribeUrl: RoutedUrlTranscriber   // tier-routed URL transcription; set as video.urlTranscriber and wrapped as summarize's transcribeUrl
  intake: IntakeDeps                    // fireOnFile + transcribeUrlToNote
}

// registry.ts:44
interface ModuleFactoryContext {
  deps: ModuleDeps
  built: Readonly<Partial<FeatureModules>>   // modules constructed by earlier entries
  wiring: ModuleWiring
}

// registry.ts:51
type ModuleEntry = {
  key: FeatureModuleKey                      // settings section gating onload via settings[key].enabled
  platform?: () => boolean                   // omitted = every platform; false leaves the slot null
  create: (ctx: ModuleFactoryContext) => FeatureModule
}

// registry.ts:74
const MODULE_FACTORIES: readonly ModuleEntry[]   // elaboration, audio, video (desktop), image, enrichment, summarize, tidy, organize, deepDive, title, rem, intake

// registry.ts:119
function constructFeatureModules(deps: ModuleDeps, wiring: ModuleWiring): FeatureModules   // constructs all (disabled included); throws if a dependency entry is missing
// registry.ts:129
function listFeatureModules(modules: FeatureModules): FeatureModule[]                      // registry order, nulls omitted
// registry.ts:135
function loadFeatureModules(modules: FeatureModules, settings: SynapseSettings): Promise<void>   // awaits onload() per enabled module, in order
// registry.ts:142
function unloadFeatureModules(modules: FeatureModules): void                               // onunload() in reverse registry order
```

## Registry Entries

| Key | Class | Platform | Constructor extras (after `ModuleDeps`) |
|-----|-------|----------|------------------------------------------|
| `elaboration` | `ElaborationModule` | all | `() => settings.autoAccept.elaboration` |
| `audio` | `AudioModule` | all | `AudioExtractor` on desktop, else `undefined` |
| `video` | `VideoModule` | desktop | `built.audio`; `urlTranscriber = wiring.transcribeUrl` |
| `image` | `ImageModule` | all | none |
| `enrichment` | `EnrichmentModule` | all | `() => settings.autoAccept.enrichment` |
| `summarize` | `SummarizeModule` | all | `transcribeUrl` (wraps `wiring.transcribeUrl`, returns `.text`), `transcribeAudio` (`vault.readBinary` -> `built.audio.transcribe`) |
| `tidy` | `TidyModule` | all | none |
| `organize` | `OrganizeModule` | all | `() => settings.autoAccept.organize` |
| `deepDive` | `DeepDiveModule` | all | `() => settings.autoAccept['deep-dive']` |
| `title` | `TitleModule` | all | `() => settings.autoAccept.title` |
| `rem` | `RemModule` | all | `() => settings.autoAccept.rem` |
| `intake` | `IntakeModule` | all | `wiring.intake` |

## File Inventory

| File | Exports | Purpose |
|------|---------|---------|
| `index.ts` | everything above | Barrel |
| `registry.ts` | `MODULE_FACTORIES`, `constructFeatureModules`, `listFeatureModules`, `loadFeatureModules`, `unloadFeatureModules`, types | Ordered factory list + lifecycle loops |
| `registry.test.ts` | Tests | Every `src/<feature>/index.ts` `export class *Module` is constructed by the registry; record key order; desktop gating; `urlTranscriber` wiring; enabled-gated load order; reverse unload; proposal-hook slots |

## Wiring (main.ts)

`main.ts:60-81` builds `ModuleDeps` and calls `constructFeatureModules`; the `ModuleWiring` closures resolve `SynapsePlugin.urlTranscription` / `synapseRunner`, which `main.ts:84-100` builds right after construction (they only run at operation time). `main.ts:173-177` assigns `onViewRefreshNeeded` / `onOpenProposalView` on every module exposing those slots, then `loadFeatureModules`; `onunload` (`main.ts:267`) calls `unloadFeatureModules`.

## Dependencies

| Import | From | File |
|--------|------|------|
| `Platform` | `obsidian` | `registry.ts:1` |
| `SynapseSettings`, `AutoAcceptSettings` (types) | `../settings` | `registry.ts:2` |
| `ModuleDeps`, `FeatureModule`, `FeatureSettingsKey` (types) | `../shared` | `registry.ts:3` |
| `ElaborationModule`, `AudioModule`, `VideoModule`, `AudioExtractor`, `ImageModule`, `EnrichmentModule`, `SummarizeModule`, `TidyModule`, `OrganizeModule`, `DeepDiveModule`, `TitleModule`, `RemModule`, `IntakeModule` | feature barrels | `registry.ts:4-16` |
| `RoutedUrlTranscriber`, `IntakeDeps` (types) | `../video`, `../intake` | `registry.ts:7,17` |
