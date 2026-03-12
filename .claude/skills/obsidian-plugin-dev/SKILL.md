---
name: obsidian-plugin-dev
description: Obsidian plugin development patterns, API usage, manifest configuration, settings management, and build pipeline. Use when working on plugin architecture, lifecycle hooks, or Obsidian API integration.
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
  "id": "auto-notes",
  "name": "Auto Notes",
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

export default class AutoNotesPlugin extends Plugin {
  async onload() {
    // Load settings, register UI, commands, events
    await this.loadSettings();
    this.addSettingTab(new AutoNotesSettingTab(this.app, this));
    this.registerCommands();
  }

  onunload() {
    // Automatic cleanup for registered resources
  }
}
```

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

## Development Tips

- Use a dedicated development vault, not your primary vault
- Install Hot-Reload plugin for auto-reloading during dev
- Use `new Notice('message')` for user-facing notifications
- Settings persist to `data.json` in the plugin directory
