---
name: codebase-architecture
description: Codebase architecture standards and best practices for the Synapse Obsidian plugin. Covers file structure conventions, module patterns, naming conventions, dependency rules, and code organization. Use when enforcing or communicating architectural decisions.
user-invocable: false
---

# Codebase Architecture Standards

## Module Pattern

Every feature module follows a consistent contract:

```typescript
class FeatureModule {
  constructor(host: AppHost, getSettings: () => SynapseSettings) {}
  async onload(): Promise<void>;  // register commands, views, events
  onunload(): void;               // cleanup
}
```

`AppHost` stands for whatever handle the application entry point owns (the app or plugin instance) — modules receive it, they never construct it.

## File Structure Conventions

```
src/
├── main.ts                    # App entry point only — no business logic
├── settings.ts                # Unified settings interface + defaults
├── settings-tab.ts            # Settings UI
├── <feature>/
│   ├── index.ts               # Module class (public API for the feature)
│   ├── types.ts               # Feature-specific interfaces and types
│   ├── <implementation>.ts    # Internal implementation files
│   └── views/                 # UI components (modals, views) if needed
└── shared/
    ├── ai-client.ts           # Unified AI API client
    ├── api-utils.ts           # Retry, error handling utilities
    └── file-utils.ts          # File-system / storage operations
```

## Rules

1. **No circular dependencies** — feature modules may depend on `shared/` but never on each other, except VideoModule → AudioModule (documented exception)
2. **Minimal runtime deps** — prefer the platform's HTTP client (`fetch`) for API calls and `child_process` for external tools over adding npm dependencies
3. **Types in `types.ts`** — each feature has its own types file; shared types go in `shared/`
4. **Index files are public API** — other modules import from `feature/index.ts`, never from internal files
5. **Settings are read-only in modules** — modules receive `getSettings()`, never mutate settings directly
6. **All host registrations in `onload()`** — commands, events, views registered through the host handle so teardown happens in one place
7. **Naming**: files use kebab-case, classes use PascalCase, functions/variables use camelCase
8. **Exports**: prefer named exports over default exports (except the entry-point class)
