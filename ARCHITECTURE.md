# Wisp Notes — Architecture

Static React SPA. The browser talks directly to the Google Drive API v3; there is no backend.
Notes are Markdown files in a `Wisp Notes` folder in the user's Drive; subfolders are categories;
`_meta.json` in a folder holds its icon and its notes' icons (`{ "icon": "book-open", "notes": { "Plan.md": "star" } }`;
rename/move/delete of a note update it). An icon is a Lucide name or an uploaded image, stored inline as a 64×64 PNG `data:` URL (`components/customIcon.ts`; only base64 PNG/JPEG/GIF/WebP under 100 KB is rendered). A folder next to a note with the same name
(`Plan.md` + `Plan/`, Notion export layout) holds that note's sub-notes: `buildTree` attaches it as
`NoteNode.children`, and rename/move/delete of the note include it (`childFolderOf` in `paths.ts`). Creating a note
or folder whose name would pair with an unrelated item is rejected. Access uses the `drive.file` scope:
the app only sees files it created or imported.

## Modules (`src/`)

| Path                                         | Responsibility                                                                                                                                                                                                                                                                                                                |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `drive/auth.ts`                              | Google Identity Services token model: lazy-loads the GIS script, `signIn` (popup, needs a click), token in `localStorage` until expiry (≤1 h), `getToken` never opens UI (throws `auth`).                                                                                                                                     |
| `drive/client.ts`                            | `fetch`-based Drive client: `ensureRoot` (finds the root folder by `appProperties.wispRoot`, so it may be renamed/moved), `folderPath` (its location for Settings; parents the app didn't create are unreadable under `drive.file`), `listAll`, changes feed, download, multipart create, content update, rename/move, trash. |
| `drive/remoteTree.ts`                        | `RemoteTree`: Drive items by ID → derived path entries (`Entry {path, id, folder, md5}`); applies change-feed deltas.                                                                                                                                                                                                         |
| `drive/errors.ts`, `drive/md5.ts`            | Normalized `DriveError.kind` (`auth`, `cancelled`, `forbidden`, `quota`, `rate-limit`, `not-found`, `network`); MD5 of UTF-8 text (matches Drive's `md5Checksum`).                                                                                                                                                            |
| `settings/settings.ts`, `store/app.ts`       | Signed-in account + editor prefs + theme in `localStorage`. `settings/theme.ts` toggles `.dark` (Tailwind `dark:` variant) and `.synthwave`/`.terminal` (remap the neutral/indigo palette variables and fonts) on `<html>`; editor colors are CSS variables in `index.css`.                                                   |
| `cache/db.ts`                                | IndexedDB (`idb`): `snapshots` (remote state + change token per account), `blobs` (content by MD5 — never stale), `drafts` (unsaved edits).                                                                                                                                                                                   |
| `repo/session.ts`                            | **Central service.** `RepoSession` owns Drive client + cache + drafts + auto-saver, serializes all syncs and writes, exposes reactive state through the `useRepo` zustand store.                                                                                                                                              |
| `repo/apply.ts`                              | `executeOps`: runs path-based `DriveOp`s (`write`, `mkdir`, `rename`, `trash`) against Drive with conflict handling; `applyOpsToEntries` for optimistic UI.                                                                                                                                                                   |
| `repo/autosave.ts`                           | `AutoSaver`: saves 60 s after the first unsaved change (no idle debounce) or on `:w`/Ctrl+S, one flush at a time, exponential backoff retry. Pure timer logic.                                                                                                                                                                |
| `repo/ops.ts`                                | Pure builders for create/rename/delete notes & folders, icon changes and imports.                                                                                                                                                                                                                                             |
| `repo/tree.ts`, `repo/paths.ts`              | `buildTree` (entries → sorted folder tree), meta parsing, path helpers, conflict-copy names.                                                                                                                                                                                                                                  |
| `repo/useRepoSession.ts`                     | Creates the session for the account; refreshes on focus/visibility/online and every 60 s while visible.                                                                                                                                                                                                                       |
| `search/index.ts`, `search/service.ts`       | MiniSearch index (title ×4, path, content; prefix + fuzzy, AND). Service prefetches note contents (4 concurrent) and re-indexes incrementally.                                                                                                                                                                                |
| `editor/Editor.tsx`, `editor/livePreview.ts` | CodeMirror 6 (lazy chunk) with vim (`:w` saves) and the live-preview ViewPlugin (`computeDecorations` is pure and unit-tested); `editor/links.ts` handles Ctrl/Cmd+click on links, `repo/links.ts` resolves them (relative `.md` → note route, only http(s)/mailto opened externally).                                        |
| `components/`                                | UI: `AppShell`, `NotesSidebar`/`Sidebar` (tree, context menu, import), `NotePage`, `QuickOpen`, `DialogHost`, `SettingsPage` (sign in/out), `Home`, `StatusBar` (save status, sign-in banner, import progress).                                                                                                               |

## Data flow

1. **Startup**: render the cached remote state + drafts from IndexedDB immediately, then `changes.list` since the
   stored change token (full `files.list` on first use or if the token is invalid). Only files whose MD5 isn't
   cached are downloaded (lazily, or by the search prefetch). Repeats on tab focus/visibility and every 60 s.
2. **Editing**: every change → `editNote` → draft written to IndexedDB (survives tab close) → `AutoSaver.notifyChange`.
3. **Saving**: `flushDrafts` turns all drafts into `write` ops; `run()` (serialized queue) first pulls Drive
   changes, then uploads in parallel (4 at a time). Partial failures keep the remaining drafts for retry.
4. **Conflicts**: each draft remembers the MD5 it was based on. If Drive's current MD5 differs (and the file isn't
   empty), ours is written as `Name (conflict YYYY-MM-DD).md` and the user is notified. A note deleted elsewhere is recreated.
5. **Structural ops** (`useTreeActions`): build ops (`ops.ts`) → flush affected drafts → `applyOptimistic`
   (tree updates at once, rolls back on failure). Folder rename/move is one Drive update; delete moves to Drive trash.
   Moving: drag a note/folder onto a folder (onto a note → nested as its sub-note, empty space → top level) in `Sidebar.tsx`,
   or use "Move to…" in the context menu (keyboard/touch). Both call `moveOp`.
6. **Import**: picked files keep their relative structure under the target folder; text files are uploaded as
   strings (cached and searchable), others (screenshots) as binary. Clashing names get a ` (2)` suffix.
7. **Auth**: tokens last ~1 h and need a click to renew. On expiry or 401, `authRequired` shows a
   "Continue as …" banner; cached reading and local drafts keep working.

## Limits

- Drive has no multi-file transactions: a batch save is several independent uploads.
- Conflict check is "pull changes → compare MD5 → write" (no conditional writes in Drive v3); the race window is small.
- History: Drive keeps past versions for ~30 days / 100 versions per file; current files are kept indefinitely.

## Security

- `drive.file` limits access to the app's own files. Token in `localStorage` only until it expires; sign-out
  revokes it and clears local data.
- Production build injects a strict CSP (`vite.config.ts`): own scripts plus `accounts.google.com/gsi/client`;
  `connect-src` limited to `www.googleapis.com` and GIS. Markdown is never rendered as HTML.

## Testing

- `npm test` — Vitest + Testing Library + MSW + fake-indexeddb. `src/test/fakeDrive.ts` is an in-memory Drive
  (files, folders, MD5s, changes feed, pagination, offline, injected failures); `src/test/fakeGis.ts` stubs Google sign-in.
- `npm run e2e` — Playwright against the production build (CSP active), desktop + Pixel 7 viewports, same fake
  via `page.route` plus a stubbed GIS script (`e2e/fixtures.ts`). Fails on CSP violations or page errors.
- `npm run lint`, `npm run typecheck`, `npm run build`.
- README screenshot: `README_SCREENSHOT=1 npx playwright test readme-screenshot --project=desktop` rewrites
  `docs/screenshot.png`.

## Conventions for maintainers

- Keep Drive/IndexedDB logic out of components: add methods to `RepoSession` or pure builders in `repo/`.
- New operations: pure builder in `ops.ts` + unit test, then wire through `useTreeActions.run`.
- All dependencies pinned to exact versions.
- License: GPL-3.0-or-later (`LICENSE`). Runtime dependencies are MIT/ISC, which are GPL-compatible; check new ones.
