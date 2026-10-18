/**
 * Regenerates the README screenshots in docs/ (Terminal theme, sample notes with logo icons):
 * screenshot.png (a note), search-names.png (Ctrl+K) and search-contents.png (Ctrl+G).
 * Skipped in normal runs; to update: README_SCREENSHOT=1 npx playwright test readme-screenshot --project=desktop
 */
import type { Page } from '@playwright/test'
import { expect, test } from './fixtures.ts'

const NOTE = `# Kubernetes cheatsheet

Quick reference for **day-to-day cluster work**. See also [Helm charts](Helm%20charts.md) and the [official docs](https://kubernetes.io/docs/).

## Inspect

- \`kubectl get pods -A\` lists pods in every namespace
- \`kubectl describe pod <name>\` shows *events* and restarts
- [x] Set up \`kubectx\` and \`kubens\`
- [ ] Learn \`kubectl debug\`

| Status | Meaning |
|---|---|
| <span style="color: green">Running</span> | All containers started |
| <span style="color: orange">Pending</span> | Waiting for a node or an image |
| <span style="color: red">CrashLoopBackOff</span> | Keeps crashing: check \`kubectl logs\` |

> Tip: \`alias k=kubectl\` saves a lot of typing.

## Deploy

\`\`\`yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: wisp-api
spec:
  replicas: 3 # scale here
\`\`\`

\`\`\`bash
kubectl apply -f deploy.yaml
kubectl rollout status deploy/wisp-api --timeout=120s
\`\`\`
`

const HELM = `# Helm charts

Upgrade a release and <span style="color: green">roll back</span> if it fails:

\`\`\`bash
helm upgrade --install wisp-api ./chart -n prod --atomic --timeout 5m
kubectl get pods -n prod -l app=wisp-api
helm rollback wisp-api 1 -n prod
\`\`\`

- Pin chart versions in \`Chart.lock\`
- Keep secrets in **Vault**, not in \`values.yaml\`
`

const ARGO = `# Argo CD rollout

1. Merge to \`main\`, Argo CD syncs within a minute
2. Watch it: \`kubectl -n argocd get applications\`
3. <span style="color: red">Never</span> edit live resources by hand
`

const FILES: Record<string, string> = {
  'Kubernetes/Kubernetes cheatsheet.md': NOTE,
  'Kubernetes/Helm charts.md': HELM,
  'Kubernetes/Argo CD rollout.md': ARGO,
  'Kubernetes/_meta.json': JSON.stringify({
    icon: 'logo:kubernetes',
    notes: {
      'Kubernetes cheatsheet.md': 'logo:kubernetes',
      'Helm charts.md': 'logo:helm',
      'Argo CD rollout.md': 'logo:argocd',
    },
  }),
  'Infrastructure/Terraform modules.md':
    '# Terraform modules\n\n```hcl\nmodule "vpc" {\n  source = "./modules/vpc"\n}\n```\n',
  'Infrastructure/Ansible playbooks.md': '# Ansible playbooks\n\n`ansible-playbook site.yml --check`\n',
  'Infrastructure/Docker basics.md':
    '# Docker basics\n\n`docker compose up -d`, then `kubectl` for the cluster.\n',
  'Infrastructure/_meta.json': JSON.stringify({
    icon: 'logo:terraform',
    notes: {
      'Terraform modules.md': 'logo:terraform',
      'Ansible playbooks.md': 'logo:ansible',
      'Docker basics.md': 'logo:docker',
    },
  }),
  'Cloud/AWS/IAM policies.md': '# IAM policies\n\nLeast privilege, always.\n',
  'Cloud/AWS/S3 lifecycle.md': '# S3 lifecycle\n\nMove logs to Glacier after 30 days.\n',
  'Cloud/AWS/_meta.json': JSON.stringify({ icon: 'logo:aws' }),
  'Cloud/GCP/Cloud Run deploys.md': '# Cloud Run deploys\n\n`gcloud run deploy wisp-api --source .`\n',
  'Cloud/GCP/_meta.json': JSON.stringify({
    icon: 'logo:gcp',
    notes: { 'Cloud Run deploys.md': 'logo:cloudrun' },
  }),
  'Cloud/_meta.json': JSON.stringify({ icon: 'cloud' }),
  'Code/Python snippets.md':
    '# Python snippets\n\n```python\nimport subprocess\nsubprocess.run(["kubectl", "get", "nodes"], check=True)\n```\n',
  'Code/Go concurrency.md': '# Go concurrency\n\nUse `errgroup` for fan-out.\n',
  'Code/Rust ownership.md': '# Rust ownership\n\nBorrow, don’t clone.\n',
  'Code/TypeScript tips.md': '# TypeScript tips\n\n`satisfies` over `as`.\n',
  'Code/_meta.json': JSON.stringify({
    icon: 'logo:github',
    notes: {
      'Python snippets.md': 'logo:python',
      'Go concurrency.md': 'logo:go',
      'Rust ownership.md': 'logo:rust',
      'TypeScript tips.md': 'logo:typescript',
    },
  }),
  'Databases/Postgres tuning.md': '# Postgres tuning\n\n`shared_buffers` = 25% of RAM.\n',
  'Databases/Redis patterns.md': '# Redis patterns\n\nRate limiting with `INCR` + `EXPIRE`.\n',
  'Databases/_meta.json': JSON.stringify({
    icon: 'logo:postgresql',
    notes: { 'Postgres tuning.md': 'logo:postgresql', 'Redis patterns.md': 'logo:redis' },
  }),
  'Inbox.md': '# Inbox\n\n- Try `kubectl debug` on the flaky pod\n- Renew the TLS certificate\n',
  'Journal.md': '# Journal\n\nShipped the new search.\n',
  '_meta.json': JSON.stringify({ notes: { 'Inbox.md': 'inbox', 'Journal.md': 'notebook-pen' } }),
}

async function setup(page: Page, drive: { write: (p: string, c: string | null) => void }) {
  for (const [p, c] of Object.entries(FILES)) drive.write(p, c)
  for (const p of ['Work/Plan.md', 'Work/_meta.json', 'Home/Recipes.md', 'Work', 'Home']) drive.write(p, null)
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.addInitScript(() => {
    localStorage.setItem(
      'wisp-notes:settings',
      JSON.stringify({
        account: { email: 'me@example.com', name: 'Me' },
        vim: true,
        livePreview: true,
        theme: 'terminal',
      }),
    )
    localStorage.setItem(
      'wisp-notes:token',
      JSON.stringify({ token: 'good-token', expiresAt: Date.now() + 3_600_000 }),
    )
    localStorage.setItem(
      'wisp-notes:expanded',
      JSON.stringify({ Kubernetes: true, Code: true, Cloud: true, 'Cloud/AWS': true }),
    )
  })
  await page.goto('/n/Kubernetes/Kubernetes%20cheatsheet.md')
  await expect(page.locator('.cm-content')).toContainText('rollout status')
  // Logo icons are images: wait until they are all loaded.
  await expect
    .poll(() =>
      page
        .locator('nav img[data-icon^="logo:"]')
        .evaluateAll((imgs) =>
          imgs.every((i) => (i as HTMLImageElement).complete && (i as HTMLImageElement).naturalWidth > 0),
        ),
    )
    .toBe(true)
  await page.addStyleTag({ content: '.cm-fat-cursor { display: none }' }) // no stray cursor in the picture
}

test.describe('README screenshots', () => {
  test.skip(({ isMobile }) => isMobile || !process.env.README_SCREENSHOT, 'only when regenerating them')

  test('note', async ({ page, drive }) => {
    await setup(page, drive)
    // Unfocused editor: live preview hides all Markdown syntax
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await page.mouse.move(1270, 890)
    await page.waitForTimeout(800) // code-block language highlighting loads lazily
    await page.screenshot({ path: 'docs/screenshot.png' })
  })

  test('name search', async ({ page, drive }) => {
    await setup(page, drive)
    await page.keyboard.press('Control+k')
    const box = page.getByRole('combobox', { name: 'Search notes' })
    await box.pressSequentially('netes', { delay: 30 }) // part of a word: finds "Kubernetes …"
    const results = page.getByRole('listbox', { name: 'Results' }).getByRole('option')
    await expect(results.first()).toContainText('Kubernetes')
    // Focus the cheatsheet so the preview shows a formatted note
    const target = results.filter({ hasText: 'Kubernetes cheatsheet' })
    while ((await target.getAttribute('aria-selected')) !== 'true') await box.press('ArrowDown')
    await expect(page.getByRole('region', { name: 'Preview' })).toContainText('rollout status')
    await page.mouse.move(1270, 890)
    await page.waitForTimeout(800)
    await page.screenshot({ path: 'docs/search-names.png' })
  })

  test('content search', async ({ page, drive }) => {
    await setup(page, drive)
    await page.keyboard.press('Control+g')
    const box = page.getByRole('combobox', { name: 'Search note contents' })
    // Wait for the background download, so every page is searchable
    await expect(page.getByTestId('grep-status')).not.toContainText('not downloaded', { timeout: 10_000 })
    await box.pressSequentially('kubectl', { delay: 30 })
    const results = page.getByRole('listbox', { name: 'Results' }).getByRole('option')
    await expect.poll(() => results.count()).toBeGreaterThan(8)
    // Focus a match in Helm charts: its code block is shown in the preview with the match selected
    const target = results.filter({ hasText: 'Helm charts' }).first()
    while ((await target.getAttribute('aria-selected')) !== 'true') await box.press('ArrowDown')
    await expect(page.getByRole('region', { name: 'Preview' })).toContainText('helm rollback')
    await expect(page.getByRole('region', { name: 'Preview' }).locator('.cm-search-hit')).toHaveText(
      'kubectl',
    )
    await page.mouse.move(1270, 890)
    await page.waitForTimeout(800)
    await page.screenshot({ path: 'docs/search-contents.png' })
  })
})
