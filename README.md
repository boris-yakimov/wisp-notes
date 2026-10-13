# Wisp Notes

Minimal personal notes app: Markdown notes in a private GitHub repo, folder tree with icons,
CodeMirror editor with vim motions and live preview, auto-save to GitHub, full-text search.

```sh
npm install
npm run dev        # http://localhost:5173
npm test           # unit/integration tests
npx playwright install chromium && npm run e2e   # end-to-end tests
npm run build      # static site in dist/
```

On first start, enter a fine-grained personal access token limited to your notes repository with
**Contents: Read and write**, plus owner, repo and branch.

Shortcuts: `Ctrl/Cmd+K` search, `Ctrl/Cmd+S` or `:w` save now. Vim mode and live preview can be toggled in Settings.

See [ARCHITECTURE.md](ARCHITECTURE.md) for how it works.
