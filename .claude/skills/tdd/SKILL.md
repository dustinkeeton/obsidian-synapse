---
name: tdd
description: Test-Driven Development skill. Guides writing tests before implementation — test-first workflow, co-located test files, and boundary mocking. Enforces Red-Green-Refactor cycle.
user-invocable: true
---

# Test-Driven Development (TDD)

When this skill is invoked, follow the TDD workflow below. If invoked with arguments (e.g., `/tdd src/shared/validation.ts`), scope the work to that file or module. If invoked without arguments, audit the codebase for missing test coverage and propose a plan.

## How and when to use

Reach for TDD whenever you are about to change behavior:

- **New source files** — write the test first. Before a new function, class, or module exists, write a failing test that pins the behavior you intend, then implement against it (the Red-Green-Refactor cycle below).
- **Bug fixes** — reproduce before you repair. Write a failing **regression test** that captures the bug first, watch it fail, then fix the code until it passes. The test stays behind as a guard against the bug returning.
- **Refactors** — lean on the existing tests as a safety net. If the code you are about to restructure has no tests, add them first so the refactor is verifiable.

This skill is both **user-invocable** and **agent-granted**:

- **User-invoked** — run `/tdd <path>` to scope the workflow to a file or module (e.g. `/tdd src/shared/validation.ts`), or `/tdd` with no argument to audit the codebase for missing coverage and propose a plan.
- **Agent-granted** — agents that list `tdd` in their `skills:` frontmatter follow this workflow automatically when writing new code or fixing bugs, without an explicit invocation.

## Framework & Structure

- **Test runner:** the project's standard runner — `npm test` runs the suite
- **Test files:** Co-located next to source as `<name>.test.<ext>` (e.g., `src/shared/validation.test.ts`)
- **Test utilities:** a central test-utils directory (e.g., `src/__test-utils__/`) — mock factories, fixtures, helpers

## Red-Green-Refactor Cycle

When implementing a new function, class, or feature:

1. **RED** — Write a failing test first. Run the runner scoped to that file (most runners accept a path argument) to confirm it fails.
2. **GREEN** — Write the minimum implementation to make the test pass.
3. **REFACTOR** — Clean up both test and production code. Run tests again to confirm they still pass.

Every new source file must have a corresponding test file, unless it is:
- A type-only file (`types.ts`)
- A re-export barrel (`index.ts` that only re-exports)
- A thin UI shell over host-application base classes (test these indirectly through their callers, or extract testable logic into pure functions)

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
5. **Mock at the boundary** — Mock external dependencies (network clients, `child_process`, host-application APIs), not internal functions. If you need to mock an internal function, refactor to inject the dependency.
6. **No real API calls** — Tests must never hit real network endpoints. Mock all HTTP.
7. **Security functions get exhaustive coverage** — sanitizers and validators (e.g., `sanitizeUrl`, `sanitizePath`) must test: null bytes, path traversal, shell metacharacters, non-HTTP schemes, XSS vectors, and each pattern the sanitizer strips.

## Mocking Patterns

Examples use Vitest-style APIs (`vi`); adapt to the project's runner.

### Module mocks and factories
Mock host-application or platform modules centrally (a `__mocks__/` directory the runner auto-loads) so every test consumes the same stubs. Keep per-object mock factories in the test-utils directory — fresh instance per test, override-friendly defaults.

### Mocking global `fetch`
```typescript
beforeEach(() => { global.fetch = vi.fn(); });
afterEach(() => { vi.restoreAllMocks(); });
```

### Mocking `child_process`
```typescript
vi.mock('child_process', () => ({
  execFile: vi.fn((cmd, args, opts, cb) => cb(null, '{}', '')),
}));
```

## Architectural Test Rules

1. **Import boundaries** — Feature modules (`elaboration/`, `audio/`, `video/`) must not import from each other, except the documented `video/ → audio/` dependency. Consider an architectural test that scans imports.
2. **Settings immutability** — Tests should pass frozen settings and verify no mutations.

## Running Tests

```bash
npm test   # full suite
```

Use the runner's watch and coverage modes during development where available.

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
