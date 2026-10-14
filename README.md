# Wisp Notes

Minimal personal notes app: Markdown notes in your Google Drive, folder tree with icons,
CodeMirror editor with vim motions and live preview, auto-save, full-text search, offline reading.

```sh
npm install
npm run dev        # http://localhost:5173
npm test           # unit/integration tests
npx playwright install chromium && npm run e2e   # end-to-end tests
npm run build      # static site in dist/
npx vite preview   # serve the build at http://localhost:4173
```

Sign in with Google on first start. Notes live in a **Wisp Notes** folder in your Drive. The app uses the
`drive.file` permission, so it only sees files it created or imported. Use **Import folder** (sidebar header or a
folder's menu) to bring in existing Markdown files such as a Notion export.

Drag notes and folders onto a folder in the sidebar to nest them (or use **Move to…** in their menu).

Notes can have sub-notes, like Notion pages: use **+** on a note row (or **New sub-note** in its menu), or drag
a note onto another note. Sub-notes of `Plan.md` live in a `Plan/` folder next to it, the same layout as a
Notion export, so imported Notion pages show up nested.

Folders and notes can have icons: **Change icon** in their menu, then pick one or **Upload image…** your own. **Auto-assign icons** on a folder guesses icons from names (Docker, Kubernetes, AWS, …)
for everything inside that has none yet, shows them, and saves after you confirm.

Shortcuts: `Ctrl/Cmd+K` search, `Ctrl/Cmd+S` or `:w` save now. Vim mode, live preview and the theme (System/Light/Dark) can be changed in Settings.

See [ARCHITECTURE.md](ARCHITECTURE.md) for how it works.

## Google Cloud setup (one time per new setup)

The app needs its own OAuth client ID so Google can show the sign-in screen and know which website may access
your Drive. It's free; enabling the Drive API normally doesn't require billing.

1. **Create a project**: open https://console.cloud.google.com, sign in with the Google account whose Drive should
   hold the notes, then project picker → **New project** → name `Wisp Notes` → **Create**, and select it.
2. **Enable the Drive API**: **APIs & Services → Library** → search "Google Drive API" → **Enable**.
3. **Consent screen** (**Google Auth Platform** / **OAuth consent screen**) → **Get started**:
   - App information: name `Wisp Notes`, your email as support email.
   - Audience: **External**.
   - Contact information: your email → accept the policy → **Create**.
4. **Test user**: **Audience → Test users → Add users** → your Gmail address. Leave the publishing status on
   **Testing** (only listed test users can sign in).
5. **Scope**: **Data Access → Add or remove scopes** → select `.../auth/drive.file` ("See, edit, create, and
   delete only the specific Google Drive files you use with this app") → **Update** → **Save**.
6. **Client ID**: **Clients → Create client** → type **Web application**, name `Wisp Notes local`.
   - **Authorized JavaScript origins**: `http://localhost:5173` (dev) and `http://localhost:4173` (preview).
   - **Authorized redirect URIs**: leave empty (the sign-in popup doesn't use them).
   - **Create** and copy the Client ID (ends in `.apps.googleusercontent.com`).
7. **Configure the app**: create `.env.local` in the project root (gitignored), then restart `npm run dev`:
   ```sh
   VITE_GOOGLE_CLIENT_ID=1234567890-abc123.apps.googleusercontent.com
   ```

Notes:

- Google may warn "Google hasn't verified this app" while the app is in Testing. Choose **Continue**; it's your own app.
- **Keep the project.** With `drive.file`, Google ties access to this client. If the project is deleted, your notes
  stay in Drive but the app can't see them until you import them again.
- Google issues sign-in tokens for about an hour and requires a click to renew them. When yours expires, a
  "Continue as …" banner appears; edits are kept on the device and saved after you continue.
- If you host the app later, add its URL under **Authorized JavaScript origins**.
