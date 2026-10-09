---
last-updated: 2026-10-06
---

# Settings UI Module

The Obsidian settings tab. `settings-tab.ts` is a thin orchestrator: it builds a `SettingsSectionContext` (`shared/settings-section.ts`), renders the declarative `SETTINGS_SECTIONS` list in order, then appends the per-section reset footers and the version line. On a development build (`BUILD_INFO.dev`, see `shared/build-info.ts`, #542) a warning callout replaces the muted footer and is also rendered first, above every section; the production footer is unchanged. The cross-feature sections (AI configuration, auto-accept, exclusions, general, about) live in `global-sections.ts` as renderers with the same `(ctx) => void` signature as every feature's `render<Feature>Settings`. `src/settings.ts` (types + defaults) deliberately stays at the `src/` root.

## Public API

Exported from `index.ts`:

```ts
// settings-tab.ts:77
class SynapseSettingTab extends PluginSettingTab {
  constructor(app: App, plugin: SynapsePlugin, buildInfo?: Readonly<BuildInfo>)   // buildInfo defaults to BUILD_INFO; injected by tests
  display(): void    // settings-tab.ts:136 — rebuilds the whole tab
}
```

Module-level exports (not re-exported by the barrel):

```ts
// settings-tab.ts:28
interface SettingsSectionEntry { key: string; render: (ctx: SettingsSectionContext) => void; platform?: 'desktop' | 'mobile' }
const SETTINGS_SECTIONS: readonly SettingsSectionEntry[]   // settings-tab.ts:35 — render order: ai, autoAccept, exclusions, general, elaboration, intake, image, audio, video, enrichment, summarize, tidy, organize, deepDive, title, rem, about
function isSectionVisible(entry: SettingsSectionEntry, platform?: { isDesktop: boolean; isMobile: boolean }): boolean   // settings-tab.ts:57
function renderDevBuildBanner(containerEl: HTMLElement, info: BuildInfo, version: string): void   // settings-tab.ts:66 — `.synapse-dev-build-banner` callout: bold "Development build" lead + `describeDevBuild` detail

// global-sections.ts
function renderAiConfiguration(ctx: SettingsSectionContext): void   // :83  configSection('ai'); hosts renderTranscriptionCredentials, renderVoiceSetting (:244, #540) and, last, renderSystemOneCredentials (:247, #558)

// voice-setting.ts:17 (#540)
function renderVoiceSetting(body: HTMLElement, ctx: SettingsSectionContext): void   // one `.synapse-voice-card`: "Voice" Setting row (`.synapse-voice-row`, raw-DOM `select.synapse-voice-select` over VOICE_OPTIONS in row.controlEl; unknown saved value -> neutral), `.synapse-voice-neutral-note` only while neutral, `.synapse-voice-custom` panel (label + hint, `textarea.synapse-voice-custom-input`, info-icon blank hint, live `N chars` count) only while custom; card gets `synapse-voice-card--custom` while custom; all toggled in place, no rerender; writes settings.ai.voice / voiceCustom

// system-one-credentials.ts:7 (#558)
function renderSystemOneCredentials(body: HTMLElement, ctx: SettingsSectionContext): void   // "System 1 decisions" toggle (rerender on change); when on: "TypeSafe API key" password row decorated via decorateCredentialField(provider 'typesafe'), "Decision model" dropdown over SYSTEM_ONE_MODEL_OPTIONS (unknown saved model normalized to the first option before the row renders), "Confidence floor" enhanced slider 0.5-0.95 step 0.05; writes settings.ai.systemOne
function renderAutoAccept(ctx: SettingsSectionContext): void        // :268 configSection('autoAccept'); subscribes via ctx.onFeatureToggle
function renderExclusions(ctx: SettingsSectionContext): void        // :339 configSection('exclusions')
function renderGeneral(ctx: SettingsSectionContext): void           // :428 configSection('general')
function renderAbout(ctx: SettingsSectionContext): void             // :468 configSection('about'); info card (manifest version, What's new → ChangelogModal), support tiles from FUNDING_LINKS, danger-zone reset-all (#529)
```

## File Inventory

| File | Exports | Purpose |
|------|---------|---------|
| `index.ts` | `SynapseSettingTab` | Barrel |
| `settings-tab.ts` | `SynapseSettingTab`, `SETTINGS_SECTIONS`, `SettingsSectionEntry`, `isSectionVisible`, `renderDevBuildBanner` | Orchestrator: section registry, platform gating, per-section reset footers (#442), version footer, dev-build banner top + bottom (#542) |
| `global-sections.ts` | `renderAiConfiguration`, `renderAutoAccept`, `renderExclusions`, `renderGeneral`, `renderAbout` | Cross-feature section renderers |
| `funding.ts` | `FUNDING_LINKS`, `FundingLink` | Single source of funding id/label/URL/subtitle/icon for the About support tiles (#529) |
| `funding.test.ts` | Tests | `FUNDING_LINKS` matches `manifest.json` fundingUrl and `.github/FUNDING.yml` |
| `system-one-credentials.ts` | `renderSystemOneCredentials` | System 1 decision lane rows inside the AI configuration section (#558) |
| `voice-setting.ts` | `renderVoiceSetting` + copy constants (`VOICE_DESC`, `NEUTRAL_NOTE`, `CUSTOM_*`) | Voice card inside the AI configuration section: dropdown header + in-card custom-instruction panel (#540) |
| `voice-setting.test.ts` | Tests | Single card + options + neutral default; custom panel inside the card + custom-state class toggle; labels/placeholder/blank hint + info icon; textarea pre-fill, persist, live char count; neutral-only note; unknown voice normalized |
| `system-one-credentials.test.ts` | Tests | Toggle-only when off; key/model/floor rows + Test affordance when on; toggle persists + rerenders; unknown model normalized |
| `settings-tab.test.ts` | Tests | Registry order/visibility, auto-accept live state, exclusions chips, reset rows, production footer vs dev banner (build info injected via the constructor), About info card/support tiles/danger-zone reset (#529); mocks `../changelog` and `../shared/confirm-modal` |
| `global-sections.test.ts` | Tests | General section toggles, auto-accept `onFeatureToggle` refresh; mocks `../changelog` |

## Dependencies

| Import | From | File |
|--------|------|------|
| `App`, `Platform`, `PluginSettingTab`, `Setting`, `ButtonComponent` (type) | `obsidian` | `settings-tab.ts:1-2` |
| `SynapsePlugin` (type) | `../main` | `settings-tab.ts:3` |
| `BUILD_INFO`, `createSettingsSectionContext`, `describeDevBuild`, `sectionMatchesDefaults`, `BuildInfo` + `SettingsSectionContext` (types) | `../shared` | `settings-tab.ts:4-5` |
| `render<Feature>Settings` (elaboration, intake, image, audio, video, enrichment, summarize, tidy, organize, deep-dive, title, rem) | each feature barrel | `settings-tab.ts:6-17` |
| `Setting` | `obsidian` | `global-sections.ts:1` |
| `MODEL_OPTIONS`, `AIProvider` (type) | `../settings` | `global-sections.ts:2-3` |
| `addEnhancedSlider`, `FolderPickerModal`, `ALL_FEATURE_IDS`, `renderFeatureChipSelect`, `PROVIDER_METADATA`, `aiProviderToCredential`, `decorateCredentialField`, `ConfirmModal`, `applyResetAll` + types | `../shared` | `global-sections.ts:4-19` |
| `PROPOSAL_KINDS`, `ProposalKind` (type) | `../views` | `global-sections.ts:20-21` |
| `renderTranscriptionCredentials` | `../audio` | `global-sections.ts:23` |
| `renderSystemOneCredentials` | `./system-one-credentials` | `global-sections.ts:24` |
| `renderVoiceSetting` | `./voice-setting` | `global-sections.ts:25` |
| `Setting`, `setIcon` · `VOICE_OPTIONS`, `SettingsSectionContext` + `VoiceMode` (types) | `obsidian` · `../shared` | `voice-setting.ts:1-3` |
| `Setting` · `SYSTEM_ONE_MODEL_OPTIONS` · `PROVIDER_METADATA`, `addEnhancedSlider`, `decorateCredentialField` + `CredentialFieldHandle`, `SettingsSectionContext` (types) | `obsidian` · `../settings` · `../shared` | `system-one-credentials.ts:1-4` |
| `applyApiKeyEmphasis`, `API_KEY_NO_SUBSCRIPTION_NOTE` | `../onboarding` | `global-sections.ts:23` |
| `foldActiveNoteProperties` | `../properties-fold` | `global-sections.ts:24` |
| `ChangelogModal` | `../changelog` | `global-sections.ts:25` |

Consumer: `main.ts` (`addSettingTab(new SynapseSettingTab(this.app, this))`). Feature modules never import this module; they receive a `SettingsSectionContext`.
