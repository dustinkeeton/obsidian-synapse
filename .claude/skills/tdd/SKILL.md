---
name: tdd
description: Test-Driven Development skill. Guides writing tests before implementation using Vitest, co-located test files, and centralized Obsidian mocks. Enforces Red-Green-Refactor cycle.
user-invocable: true
---

# Test-Driven Development (TDD)

When this skill is invoked, follow the TDD workflow below. If invoked with arguments (e.g., `/tdd src/shared/validation.ts`), scope the work to that file or module. If invoked without arguments, audit the codebase for missing test coverage and propose a plan.

## Framework & Structure

- **Test runner:** Vitest (`npm test` to run, `npm run test:watch` for watch mode)
- **Test files:** Co-located next to source as `<name>.test.ts` (e.g., `src/shared/validation.test.ts`)
- **Obsidian mock:** `src/__mocks__/obsidian.ts` — centralized mock for the `obsidian` module
- **Test utilities:** `src/__test-utils__/` — mock factories, fixtures, helpers

## Red-Green-Refactor Cycle

When implementing a new function, class, or feature:

1. **RED** — Write a failing test first. Run `npx vitest run <file>` to confirm it fails.
2. **GREEN** — Write the minimum implementation to make the test pass.
3. **REFACTOR** — Clean up both test and production code. Run tests again to confirm they still pass.

Every new `.ts` file must have a corresponding `.test.ts` file, unless it is:
- A type-only file (`types.ts`)
- A re-export barrel (`index.ts` that only re-exports)
- A UI class extending Obsidian `Modal`, `ItemView`, or `PluginSettingTab` (test these indirectly through their callers, or extract testable logic into pure functions)

## Test Priority Tiers

### Tier 1 — Pure functions (no mocking needed, write these first)
| Module | Key functions |
|--------|--------------|
| `shared/validation.ts` | `sanitizeUrl`, `sanitizePath`, `sanitizeAIResponse`, `ensureWithinVault` |
| `video/url-detector.ts` | `detectPlatform`, `isSupportedUrl` |
| `shared/file-utils.ts` | `wordCount` |
| `shared/api-utils.ts` | `withRetry`, `sleep` |
| `settings.ts` | `DEFAULT_SETTINGS` shape, `MODEL_OPTIONS` consistency |

### Tier 2 — Units with injectable/mockable dependencies
| Module | Mock surface |
|--------|-------------|
| `elaboration/detector.ts` | `App.vault.read`, `App.metadataCache` |
| `elaboration/proposer.ts` | `AIClient`, `App.vault.adapter.read`, `MetadataCache` |
| `elaboration/proposal-store.ts` | `App.vault.adapter` (CRUD) |
| `shared/ai-client.ts` | `requestUrl` from obsidian |
| `audio/transcriber.ts` | `global.fetch` |
| `audio/post-processor.ts` | `AIClient.complete()` |
| `video/audio-extractor.ts` | `child_process.execFile` |

### Tier 3 — Module orchestrators (integration-level)
| Module | What to verify |
|--------|---------------|
| `elaboration/index.ts` | scan → detect → propose → store pipeline |
| `audio/index.ts` | transcribe → post-process → save pipeline, inline insertion |
| `video/index.ts` | URL → extract → transcribe → save pipeline |

### Do NOT unit test
- `main.ts` (lifecycle glue — extract `deepMerge` to `shared/` if testing needed)
- Modal/View UI classes (extract testable logic to pure functions instead)
- `settings-tab.ts` (pure UI wiring)

## Test Quality Rules

1. **Arrange-Act-Assert** — Every test follows AAA with clear separation.
2. **Descriptive names** — `it('returns null when file is in excluded folder')`, not `it('test 1')`.
3. **One behavior per test** — Multiple assertions OK only when verifying facets of the same behavior.
4. **No test interdependence** — Each test sets up its own fixtures. No shared mutable state.
5. **Mock at the boundary** — Mock external dependencies (`fetch`, `requestUrl`, `execFile`, Obsidian APIs), not internal functions. If you need to mock an internal function, refactor to inject the dependency.
6. **No real API calls** — Tests must never hit real network endpoints. Mock all HTTP.
7. **Security functions get exhaustive coverage** — `sanitizeUrl`, `sanitizePath`, `sanitizeAIResponse` must test: null bytes, path traversal, shell metacharacters, non-HTTP schemes, XSS vectors, and each pattern the sanitizer strips.

## Mocking Patterns

### Obsidian module mock
All tests automatically use `src/__mocks__/obsidian.ts` via Vitest's auto-mocking. This provides stub classes for `TFile`, `TFolder`, `Plugin`, `Modal`, `Notice`, `normalizePath`, `requestUrl`, etc.

### Mock factories (in `src/__test-utils__/`)
- `createMockApp()` — Returns a fresh `App` with spy vault/metadataCache/workspace
- `createMockPlugin(settingsOverrides?)` — Returns a Plugin with pre-loaded settings
- `makeSettings(overrides?)` — Returns `DEFAULT_SETTINGS` deep-merged with overrides
- `mockFile(path)` — Creates a `TFile` instance with the given path

### Mocking `fetch` (for Transcriber)
```typescript
beforeEach(() => { global.fetch = vi.fn(); });
afterEach(() => { vi.restoreAllMocks(); });
```

### Mocking `child_process` (for AudioExtractor)
```typescript
vi.mock('child_process', () => ({
  execFile: vi.fn((cmd, args, opts, cb) => cb(null, '{}', '')),
}));
```

## Architectural Test Rules

1. **Import boundaries** — Feature modules (`elaboration/`, `audio/`, `video/`) must not import from each other, except the documented `video/ → audio/` dependency. Consider an architectural test that scans imports.
2. **No `obsidian` imports in test files** — Tests use the mock, never the real module.
3. **Settings immutability** — Tests should pass frozen settings and verify no mutations.

## Running Tests

```bash
npm test              # Single run
npm run test:watch    # Watch mode
npm run test:coverage # With coverage report
```

## TDD Workflow for New Features

### Adding a new detection heuristic (elaboration)
1. Add type variant to `DetectionReason` in `types.ts`
2. Write failing detector test with concrete input/expected output
3. Implement detection logic, run until green
4. Write prompt-building test for the new reason type
5. Add settings flag test, then implement the flag
6. Add edge case tests

### Adding a new transcription provider
1. Write tests: provider dispatch, missing API key, request format, response mapping, HTTP errors
2. Update types in `settings.ts`
3. Implement provider method in `Transcriber`
4. Write post-processor integration test
5. Add settings UI (not unit tested)

### Adding a new media source (e.g., Instagram)
1. Write URL detection tests for the new platform
2. Add regex and detection logic to `url-detector.ts`
3. Write audio extraction tests (mock `execFile`)
4. Verify `yt-dlp` handles the platform
5. Write integration test for full pipeline
