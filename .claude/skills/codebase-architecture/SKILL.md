---
name: codebase-architecture
description: Codebase architecture standards and best practices for the Synapse Obsidian plugin. Covers file structure conventions, module patterns, naming conventions, dependency rules, and code organization. Use when enforcing or communicating architectural decisions.
user-invocable: false
---

# Codebase Architecture Standards

## Module Pattern

Every feature module follows a consistent contract: it takes the application handle plus a
settings getter, exposes a **load/registration entry point** where it wires up its commands,
views, and event listeners, and a **teardown/cleanup path** that releases everything it
registered.

```typescript
class FeatureModule {
  constructor(host: AppHost, getSettings: () => SynapseSettings) {}
  register(): void | Promise<void>;  // load/registration entry point — wire up commands, views, events
  teardown(): void;                  // cleanup path — release everything registered above
}
```

`AppHost` stands for whatever handle the application entry point owns (the app, plugin, or
server instance) — modules receive it, they never construct it. The two lifecycle methods
above are illustrative names; use whatever your framework or runtime convention dictates, but
keep the two-phase contract: one place that registers, one place that tears down.

## File Structure Conventions

```
src/
├── <entry>.ts                 # App entry point only — bootstrap/wiring, no business logic
├── settings.ts                # Unified settings interface + defaults
├── settings-ui.*              # Settings UI, if the app exposes settings to users
├── <feature>/                 # One directory per feature module
│   ├── index.ts               # Module class — the feature's public API
│   ├── types.ts               # Feature-specific interfaces and types
│   ├── <implementation>.ts    # Internal implementation files
│   └── <ui>/                  # UI components (views, modals, screens) if needed
└── shared/                    # Cross-feature building blocks
    ├── <service-client>.ts    # Shared client(s) for external services / APIs
    ├── <utils>.ts             # Cross-cutting helpers — retry, error handling
    └── <io>.ts                # File-system / storage / network operations
```

The names in angle brackets are placeholders — use whatever your project calls its entry file
(`main`, `index`, `app`, `server`, …), its features, and its shared utilities. The **shape**
is what matters: a thin entry file, a unified settings interface, one directory per feature
(each with an `index` public API, a `types` file, and internal implementation), and a `shared/`
directory for cross-feature building blocks.

## Rules

1. **No circular dependencies** — feature modules may depend on `shared/` but never on each other, except VideoModule → AudioModule (documented exception)
2. **Minimal runtime deps** — prefer the platform's HTTP client (`fetch`) for API calls and `child_process` for external tools over adding npm dependencies
3. **Types in `types.ts`** — each feature has its own types file; shared types go in `shared/`
4. **Index files are public API** — other modules import from `feature/index.ts`, never from internal files
5. **Settings are read-only in modules** — modules receive `getSettings()`, never mutate settings directly
6. **All host registrations in the load path** — commands, events, and views are registered through the host handle in the module's registration entry point, so teardown happens in one place
7. **Naming**: files use kebab-case, classes use PascalCase, functions/variables use camelCase
8. **Exports**: prefer named exports over default exports (except the entry-point class)
