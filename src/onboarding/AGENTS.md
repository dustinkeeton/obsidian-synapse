---
last-updated: 2026-09-14
---

# Onboarding Module

First-run welcome gate + required-API-key emphasis (#89). `planFirstRun` is pure and returns a plan; `runFirstRunOnboarding` applies it through injected deps (called once from `main.ts:299-307`); `settings-ui` applies the emphasis. No Obsidian runtime import.

## Public API

Exported from `index.ts`:

```ts
// onboarding.ts:18
const WELCOME_NOTICE_DURATION_MS = 12000
// onboarding.ts:26
const WELCOME_MESSAGE: string
// onboarding.ts:30
const REQUIRED_FIELD_CLASS = 'synapse-setting-required'
// onboarding.ts:33 / :36 / :45
const API_KEY_DESC: string
const API_KEY_REQUIRED_DESC: string
const API_KEY_NO_SUBSCRIPTION_NOTE: string

// onboarding.ts:53
function needsApiKey(settings: SynapseSettings): boolean

// onboarding.ts:65
interface FirstRunPlan {
  showWelcome: boolean   // show WELCOME_MESSAGE once
  markSeen: boolean      // persist onboarding.hasSeenWelcome = true
}
// onboarding.ts:79
function planFirstRun(settings: SynapseSettings, isFreshInstall: boolean): FirstRunPlan

// onboarding.ts:93
interface EmphasisTarget {
  settingEl: { toggleClass(cls: string, on: boolean): void }
  setDesc(desc: string): unknown
}
// onboarding.ts:105 — toggles REQUIRED_FIELD_CLASS and swaps API_KEY_DESC / API_KEY_REQUIRED_DESC by needsApiKey()
function applyApiKeyEmphasis(target: EmphasisTarget, settings: SynapseSettings): void

// onboarding.ts:114
interface FirstRunDeps {
  getSettings: () => SynapseSettings
  isFreshInstall: boolean
  markSeen: () => Promise<void>                       // caller persists onboarding.hasSeenWelcome = true
  notifications: Pick<NotificationManager, 'info'>
}
// onboarding.ts:123 — planFirstRun -> markSeen() when plan.markSeen -> info(WELCOME_MESSAGE, WELCOME_NOTICE_DURATION_MS) when plan.showWelcome; never throws (console.warn(redactError))
function runFirstRunOnboarding(deps: FirstRunDeps): Promise<void>
```

## File Inventory

| File | Exports | Purpose |
|------|---------|---------|
| `index.ts` | everything above | Barrel |
| `onboarding.ts` | `WELCOME_NOTICE_DURATION_MS`, `WELCOME_MESSAGE`, `REQUIRED_FIELD_CLASS`, `API_KEY_DESC`, `API_KEY_REQUIRED_DESC`, `API_KEY_NO_SUBSCRIPTION_NOTE`, `needsApiKey`, `FirstRunPlan`, `planFirstRun`, `EmphasisTarget`, `applyApiKeyEmphasis`, `FirstRunDeps`, `runFirstRunOnboarding` | Pure plan + emphasis helpers + the deps-injected first-run runner |
| `onboarding.test.ts` | Tests | |

## Dependencies

| Import | From | File |
|--------|------|------|
| `SynapseSettings` (type) | `../settings` | `onboarding.ts:10` |
| `redactError` (runtime) | `../shared` | `onboarding.ts:11` |
| `NotificationManager` (type) | `../shared` | `onboarding.ts:12` |

Consumers: `main.ts:299-307` (`runFirstRunOnboarding`; `markSeen` sets `settings.onboarding.hasSeenWelcome = true` then `saveSettings()`), `settings-ui/settings-tab.ts` (`applyApiKeyEmphasis`, `API_KEY_NO_SUBSCRIPTION_NOTE`). State lives in `settings.onboarding.hasSeenWelcome` (`settings.ts`).
