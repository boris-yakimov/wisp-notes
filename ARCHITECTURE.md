# Wisp Notes — Architecture

Static React SPA. The browser talks directly to the GitHub REST API; there is no backend.
Notes are Markdown files in a private repo; folders are categories; `_meta.json` in a folder
holds its icon (`{ "icon": "book-open" }`) and doubles as a placeholder so empty folders exist in Git.

## Modules (`src/`)

| Path                                   | Responsibility                                                                                                                                                                                                          |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `github/client.ts`                     | Typed Octokit wrapper: repo info, branch head, recursive tree, blobs, Git Data API writes. `validateConnection`.                                                                                                        |
| `github/errors.ts`                     | Normalizes failures into `GitHubError.kind` (`bad-token`, `forbidden`, `not-found`, `empty-repo`, `conflict`, `network`).                                                                                               |
| `github/base64.ts`, `github/sha.ts`    | UTF-8 safe base64; local git blob SHA-1 (matches GitHub's SHAs).                                                                                                                                                        |
| `settings/settings.ts`, `store/app.ts` | Token/owner/repo/branch + editor prefs in `localStorage`.                                                                                                                                                               |
| `cache/db.ts`                          | IndexedDB (`idb`): `snapshots` (last tree per repo), `blobs` (content by SHA — never stale), `drafts` (unsaved edits).                                                                                                  |
| `repo/session.ts`                      | **Central service.** `RepoSession` owns client + cache + drafts + auto-saver, serializes commits, exposes reactive state through the `useRepo` zustand store.                                                           |
| `repo/commit.ts`                       | `commitChanges`: blobs → tree (`base_tree`) → commit → non-forced ref update, with conflict handling.                                                                                                                   |
| `repo/autosave.ts`                     | `AutoSaver`: 3 s idle debounce, 45 s max interval, one flush at a time, exponential backoff retry. Pure timer logic.                                                                                                    |
| `repo/ops.ts`                          | Pure change-set builders for create/rename/delete notes & folders and icon changes (each = one commit).                                                                                                                 |
| `repo/tree.ts`, `repo/paths.ts`        | `buildTree` (flat paths → sorted folder tree), meta parsing, path helpers, conflict-copy names.                                                                                                                         |
| `search/index.ts`, `search/service.ts` | MiniSearch index (title ×4, path, content; prefix + fuzzy, AND). Service prefetches all note blobs (4 concurrent) and re-indexes incrementally on session changes.                                                      |
| `editor/Editor.tsx`                    | CodeMirror 6 (lazy-loaded chunk): Markdown, vim (`@replit/codemirror-vim`, `:w` saves), history, search. Options toggled via compartments.                                                                              |
| `editor/livePreview.ts`                | ViewPlugin hiding Markdown syntax outside lines touched by the selection; checkbox/bullet widgets; only visible ranges. `computeDecorations` is pure and unit-tested.                                                   |
| `components/`                          | UI: `AppShell` (sidebar column / mobile drawer), `NotesSidebar` + `Sidebar` (tree, context menu), `NotePage`, `QuickOpen` (Ctrl/Cmd+K), `DialogHost` (prompt/confirm/icon picker), `SettingsPage`, `Home`, `StatusBar`. |
| `store/ui.ts`, `store/dialog.ts`       | UI-only state (expanded folders, drawer, palette, vim mode) and promise-based dialogs.                                                                                                                                  |

## Data flow

1. **Startup**: `RepoSession.start()` renders the cached snapshot + drafts from IndexedDB immediately, then
   fetches branch head + recursive tree (2 requests). Blobs are fetched lazily by SHA and cached forever;
   only SHAs not in the cache are downloaded. Offline → cached data, "Offline" status.
2. **Editing**: every change → `editNote` → draft written to IndexedDB (survives tab close) → `AutoSaver.notifyChange`.
3. **Saving**: `flushDrafts` batches all drafts into one commit via `commit()` (serialized queue).
   Ctrl/Cmd+S and `:w` call `saver.saveNow()`. Drafts left over from a previous session are saved on startup.
4. **Conflicts**: each change carries the blob SHA it was based on. If the ref update is rejected or the remote
   blob differs from the base, the head is refetched; unchanged-remote files are re-applied on top, changed ones
   are written as `Name (conflict YYYY-MM-DD).md` and the user is notified. Deletes of remotely changed files are dropped.
5. **Structural ops** (`useTreeActions`): build change set (`ops.ts`) → flush affected drafts → `applyOptimistic`
   (tree updates at once, rolls back on failure) → one commit. Renames reuse existing blob SHAs (no re-upload).
6. **Search**: `SearchService` listens to session changes and reindexes only notes whose version (SHA or draft
   timestamp) changed. Works offline from cached blobs.

## Security

- PAT stored in `localStorage`; recommend a fine-grained token for the single repo, Contents read/write only.
- Production build injects a strict CSP (`vite.config.ts`): only own scripts, `connect-src` limited to
  `api.github.com`. No third-party scripts; Markdown is never rendered as HTML.

## Testing

- `npm test` — Vitest + Testing Library + MSW + fake-indexeddb. `src/test/fakeGitHub.ts` is an in-memory GitHub
  (trees, blobs, commits, refs, conflicts, offline, injected failures) used by MSW (`src/test/msw.ts`).
- `npm run e2e` — Playwright against the production build (CSP active), desktop + Pixel 7 viewports,
  same fake via `page.route` (`e2e/fixtures.ts`). Fails on CSP violations or page errors.
- `npm run lint`, `npm run typecheck`, `npm run build`.

## Conventions for maintainers

- Keep GitHub/IndexedDB logic out of components: add methods to `RepoSession` or pure builders in `repo/`.
- New operations: pure builder in `ops.ts` + unit test, then wire through `useTreeActions.run`.
- All dependencies pinned to exact versions.
