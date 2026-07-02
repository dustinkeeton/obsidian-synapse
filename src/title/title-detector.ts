// The canonical home for note-title predicates is `shared/title-detector` so
// that features outside `title/` (e.g. elaboration's generic-title guard) can
// reuse them without importing from this feature module -- the dependency rules
// allow features to depend on `shared/` but never on each other. Re-exported
// here to preserve the title module's public surface (`isUntitled`). Imported
// through the `../shared` barrel (never the internal `shared/title-detector`
// file) per the shared-import rule.
export { isUntitled } from '../shared';
