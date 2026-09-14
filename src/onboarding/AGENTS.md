---
last-updated: 2026-09-14
---

# Onboarding Module

Pure first-run welcome gate + required-API-key emphasis (#89). Decision logic returns a plan; `main.ts` (`runFirstRunOnboarding`) and `settings-ui` perform the side effects. Imports only the `SynapseSettings` type.

## Public API

Exported from `index.ts`:

```ts
// onboarding.ts:17
const WELCOME_NOTICE_DURATION_MS = 12000
// onboarding.ts:25
const WELCOME_MESSAGE: string
// onboarding.ts:29
const REQUIRED_FIELD_CLASS = 'synapse-setting-required'
// onboarding.ts:32 / :35 / :44
const API_KEY_DESC: string
const API_KEY_REQUIRED_DESC: string
const API_KEY_NO_SUBSCRIPTION_NOTE: string

// onboarding.ts:52
function needsApiKey(settings: SynapseSettings): boolean

// onboarding.ts:64
interface FirstRunPlan {
  showWelcome: boolean   // show WELCOME_MESSAGE once
  markSeen: boolean      // persist onboarding.hasSeenWelcome = true
}
// onboarding.ts:78
function planFirstRun(settings: SynapseSettings, isFreshInstall: boolean): FirstRunPlan

// onboarding.ts:92
interface EmphasisTarget {
  settingEl: { toggleClass(cls: string, on: boolean): void }
  setDesc(desc: string): unknown
}
// onboarding.ts:104 — toggles REQUIRED_FIELD_CLASS and swaps API_KEY_DESC / API_KEY_REQUIRED_DESC by needsApiKey()
function applyApiKeyEmphasis(target: EmphasisTarget, settings: SynapseSettings): void
```

## File Inventory

| File | Exports | Purpose |
|------|---------|---------|
| `index.ts` | everything above | Barrel |
| `onboarding.ts` | `WELCOME_NOTICE_DURATION_MS`, `WELCOME_MESSAGE`, `REQUIRED_FIELD_CLASS`, `API_KEY_DESC`, `API_KEY_REQUIRED_DESC`, `API_KEY_NO_SUBSCRIPTION_NOTE`, `needsApiKey`, `FirstRunPlan`, `planFirstRun`, `EmphasisTarget`, `applyApiKeyEmphasis` | Pure plan + emphasis helpers |
| `onboarding.test.ts` | Tests | |

## Dependencies

| Import | From | File |
|--------|------|------|
| `SynapseSettings` (type) | `../settings` | `onboarding.ts:11` |

Consumers: `main.ts` (`planFirstRun`, `WELCOME_MESSAGE`, `WELCOME_NOTICE_DURATION_MS`), `settings-ui/settings-tab.ts` (`applyApiKeyEmphasis`, `API_KEY_NO_SUBSCRIPTION_NOTE`). State lives in `settings.onboarding.hasSeenWelcome` (`settings.ts`).
