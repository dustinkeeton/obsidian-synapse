---
last-updated: 2026-09-14
---

# Settings UI Module

The Obsidian settings tab. Orchestrates the shared accordion plumbing (`shared/settings-section.ts`) and every feature's `render<Feature>Settings` renderer; owns only the cross-feature sections (AI configuration, auto-accept, exclusions, general, reset). `src/settings.ts` (types + defaults) deliberately stays at the `src/` root.

## Public API

Exported from `index.ts`:

```ts
// settings-tab.ts:128
class SynapseSettingTab extends PluginSettingTab {
  constructor(app: App, plugin: SynapsePlugin)
  display(): void    // settings-tab.ts:230 — rebuilds the whole tab
}
```

## File Inventory

| File | Exports | Purpose |
|------|---------|---------|
| `index.ts` | `SynapseSettingTab` | Barrel |
| `settings-tab.ts` | `SynapseSettingTab` | Tab class; `FEATURE_SECTION_RENDERERS` (`settings-tab.ts:105`) is the ordered list of feature accordions |
| `settings-tab.test.ts` | Tests | Mocks `../changelog` and `../shared/confirm-modal` |

## Dependencies

| Import | From | File |
|--------|------|------|
| `App`, `PluginSettingTab`, `Setting`, `ButtonComponent` (type) | `obsidian` | `settings-tab.ts:1-2` |
| `SynapsePlugin` (type) | `../main` | `settings-tab.ts:3` |
| `MODEL_OPTIONS`, `AIProvider` (type) | `../settings` | `settings-tab.ts:4-5` |
| `addEnhancedSlider`, `createSettingsSectionContext`, `FolderPickerModal`, `ALL_FEATURE_IDS`, `renderFeatureChipSelect`, `PROVIDER_METADATA`, `aiProviderToCredential`, `decorateCredentialField`, `ConfirmModal`, `applyResetAll`, `sectionMatchesDefaults` + types | `../shared` | `settings-tab.ts:6-24` |
| `PROPOSAL_KINDS`, `ProposalKind` (type) | `../views` | `settings-tab.ts:25-26` |
| `render<Feature>Settings` (elaboration, intake, image, audio, video, enrichment, summarize, tidy, organize, deep-dive, title, rem) + `renderTranscriptionCredentials` | each feature barrel | `settings-tab.ts:27-38` |
| `applyApiKeyEmphasis`, `API_KEY_NO_SUBSCRIPTION_NOTE` | `../onboarding` | `settings-tab.ts:39` |
| `foldActiveNoteProperties` | `../properties-fold` | `settings-tab.ts:40` |
| `ChangelogModal` | `../changelog` | `settings-tab.ts:41` |

Consumer: `main.ts` (`addSettingTab(new SynapseSettingTab(this.app, this))`). Feature modules never import this module; they receive a `SettingsSectionContext`.
