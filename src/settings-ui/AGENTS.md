---
last-updated: 2026-09-14
---

# Settings UI Module

The Obsidian settings tab. `settings-tab.ts` is a thin orchestrator: it builds a `SettingsSectionContext` (`shared/settings-section.ts`), renders the declarative `SETTINGS_SECTIONS` list in order, then appends the per-section reset footers and the version line. The cross-feature sections (AI configuration, auto-accept, exclusions, general, about) live in `global-sections.ts` as renderers with the same `(ctx) => void` signature as every feature's `render<Feature>Settings`. `src/settings.ts` (types + defaults) deliberately stays at the `src/` root.

## Public API

Exported from `index.ts`:

```ts
// settings-tab.ts:68
class SynapseSettingTab extends PluginSettingTab {
  constructor(app: App, plugin: SynapsePlugin)
  display(): void    // settings-tab.ts:118 — rebuilds the whole tab
}
```

Module-level exports (not re-exported by the barrel):

```ts
// settings-tab.ts:27
interface SettingsSectionEntry { key: string; render: (ctx: SettingsSectionContext) => void; platform?: 'desktop' | 'mobile' }
const SETTINGS_SECTIONS: readonly SettingsSectionEntry[]   // settings-tab.ts:34 — render order: ai, autoAccept, exclusions, general, elaboration, intake, image, audio, video, enrichment, summarize, tidy, organize, deepDive, title, rem, about
function isSectionVisible(entry: SettingsSectionEntry, platform?: { isDesktop: boolean; isMobile: boolean }): boolean   // settings-tab.ts:55

// global-sections.ts
function renderAiConfiguration(ctx: SettingsSectionContext): void   // :75  configSection('ai'); hosts renderTranscriptionCredentials
function renderAutoAccept(ctx: SettingsSectionContext): void        // :268 configSection('autoAccept'); subscribes via ctx.onFeatureToggle
function renderExclusions(ctx: SettingsSectionContext): void        // :339 configSection('exclusions')
function renderGeneral(ctx: SettingsSectionContext): void           // :428 configSection('general')
function renderAbout(ctx: SettingsSectionContext): void             // :468 configSection('about'); hosts the global reset-all
```

## File Inventory

| File | Exports | Purpose |
|------|---------|---------|
| `index.ts` | `SynapseSettingTab` | Barrel |
| `settings-tab.ts` | `SynapseSettingTab`, `SETTINGS_SECTIONS`, `SettingsSectionEntry`, `isSectionVisible` | Orchestrator: section registry, platform gating, per-section reset footers (#442), version footer |
| `global-sections.ts` | `renderAiConfiguration`, `renderAutoAccept`, `renderExclusions`, `renderGeneral`, `renderAbout` | Cross-feature section renderers |
| `settings-tab.test.ts` | Tests | Registry order/visibility, auto-accept live state, exclusions chips, reset rows; mocks `../changelog` and `../shared/confirm-modal` |
| `global-sections.test.ts` | Tests | General section toggles, auto-accept `onFeatureToggle` refresh; mocks `../changelog` |

## Dependencies

| Import | From | File |
|--------|------|------|
| `App`, `Platform`, `PluginSettingTab`, `Setting`, `ButtonComponent` (type) | `obsidian` | `settings-tab.ts:1-2` |
| `SynapsePlugin` (type) | `../main` | `settings-tab.ts:3` |
| `createSettingsSectionContext`, `sectionMatchesDefaults`, `SettingsSectionContext` (type) | `../shared` | `settings-tab.ts:4-5` |
| `render<Feature>Settings` (elaboration, intake, image, audio, video, enrichment, summarize, tidy, organize, deep-dive, title, rem) | each feature barrel | `settings-tab.ts:6-17` |
| `Setting` | `obsidian` | `global-sections.ts:1` |
| `MODEL_OPTIONS`, `AIProvider` (type) | `../settings` | `global-sections.ts:2-3` |
| `addEnhancedSlider`, `FolderPickerModal`, `ALL_FEATURE_IDS`, `renderFeatureChipSelect`, `PROVIDER_METADATA`, `aiProviderToCredential`, `decorateCredentialField`, `ConfirmModal`, `applyResetAll` + types | `../shared` | `global-sections.ts:4-19` |
| `PROPOSAL_KINDS`, `ProposalKind` (type) | `../views` | `global-sections.ts:20-21` |
| `renderTranscriptionCredentials` | `../audio` | `global-sections.ts:22` |
| `applyApiKeyEmphasis`, `API_KEY_NO_SUBSCRIPTION_NOTE` | `../onboarding` | `global-sections.ts:23` |
| `foldActiveNoteProperties` | `../properties-fold` | `global-sections.ts:24` |
| `ChangelogModal` | `../changelog` | `global-sections.ts:25` |

Consumer: `main.ts` (`addSettingTab(new SynapseSettingTab(this.app, this))`). Feature modules never import this module; they receive a `SettingsSectionContext`.
