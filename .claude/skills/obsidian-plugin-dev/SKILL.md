---
name: obsidian-plugin-dev
description: Obsidian plugin development patterns, API usage, manifest configuration, settings management, testing, and build pipeline. Use when working on plugin architecture, lifecycle hooks, tests, or Obsidian API integration.
user-invocable: false
---

# Obsidian Plugin Development Reference

## Project Structure

```
plugin-root/
├── src/
│   └── main.ts           # Plugin class extending Plugin
├── manifest.json          # Plugin metadata (id, name, version, minAppVersion)
├── package.json           # npm dependencies
├── tsconfig.json          # TypeScript config (ES6 target, strict mode)
├── esbuild.config.mjs     # Bundler (main.ts → main.js, obsidian external)
├── styles.css             # Plugin styles
├── versions.json          # Version-to-Obsidian compatibility
└── main.js                # Compiled output (generated)
```

## manifest.json

```json
{
  "id": "synapse",
  "name": "Synapse",
  "version": "0.1.0",
  "minAppVersion": "0.15.0",
  "description": "Flesh out and elaborate on notes with AI assistance",
  "author": "Dustin Keeton",
  "isDesktopOnly": false
}
```

## Plugin Lifecycle

```typescript
import { Plugin } from 'obsidian';

export default class SynapsePlugin extends Plugin {
  async onload() {
    // Load settings, register UI, commands, events
    await this.loadSettings();
    this.addSettingTab(new SynapseSettingTab(this.app, this));
    this.registerCommands();
  }

  onunload() {
    // Automatic cleanup for registered resources
  }
}
```

## Feature Modules (scaling beyond main.ts)

Larger plugins split features into modules that mirror the plugin lifecycle:

```typescript
class FeatureModule {
  constructor(plugin: Plugin, getSettings: () => SynapseSettings) {}
  async onload(): Promise<void>;  // register commands, views, events
  onunload(): void;               // cleanup
}
```

- Register everything through the `Plugin` instance (`addCommand`, `registerEvent`, `registerDomEvent`) inside the module's `onload()` so Obsidian's automatic cleanup covers it on unload.
- Prefer zero runtime npm dependencies: use `requestUrl`/`fetch` for API calls and `child_process` for external tools — keeps the bundle lean and eases community-plugin review.

## Key API Patterns

- **Commands**: `this.addCommand({ id, name, callback })` or `editorCallback` for editor context
- **Ribbon icons**: `this.addRibbonIcon(icon, title, callback)`
- **Settings**: `this.loadData()` / `this.saveData()` with `Object.assign(DEFAULT_SETTINGS, loaded)`
- **Events**: `this.registerEvent(this.app.vault.on('modify', callback))`
- **DOM events**: `this.registerDomEvent(document, 'click', callback)` (auto-cleanup)
- **File operations**: `this.app.vault.read(file)`, `this.app.vault.modify(file, content)`
- **Modals**: Extend `Modal` class with `onOpen()` / `onClose()`
- **Setting tabs**: Extend `PluginSettingTab` with `display()` method

## Build Pipeline

- `npm install` → install deps (obsidian, @types/node, esbuild, typescript)
- `npm run dev` → esbuild watch mode (rebuilds on change)
- `npm run build` → production build with type checking (`tsc -noEmit && esbuild`)
- Obsidian API is external (provided at runtime, not bundled)

## Testing Obsidian Plugins

The `obsidian` package ships types only — the real module exists inside the app, so tests rely on a centralized mock:

- **Module mock:** `src/__mocks__/obsidian.ts`, auto-loaded by the runner's module mocking, provides stub classes and helpers for `TFile`, `TFolder`, `Plugin`, `Modal`, `Notice`, `normalizePath`, `requestUrl`, etc.
- **No `obsidian` imports in test files** — tests exercise the mock, never the real module.
- **Mock factories** (central test-utils directory) keep fixtures uniform:
  - `createMockApp()` — fresh `App` with spy vault/metadataCache/workspace
  - `createMockPlugin(settingsOverrides?)` — a `Plugin` with pre-loaded settings
  - `makeSettings(overrides?)` — settings defaults deep-merged with overrides
  - `mockFile(path)` — a `TFile` instance for the given path
- **UI classes are exempt from unit tests** — anything extending `Modal`, `ItemView`, or `PluginSettingTab` is tested indirectly through its callers; extract decision logic into pure functions instead.

## Development Tips

- Use a dedicated development vault, not your primary vault
- Install Hot-Reload plugin for auto-reloading during dev
- Use `new Notice('message')` for user-facing notifications
- Settings persist to `data.json` in the plugin directory
