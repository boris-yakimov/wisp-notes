/**
 * Regenerates docs/screenshot.png for the README (Terminal theme, sample notes).
 * Skipped in normal runs; to update: README_SCREENSHOT=1 npx playwright test readme-screenshot --project=desktop
 */
import { expect, test } from './fixtures.ts'

const NOTE = `# Kubernetes cheatsheet

Quick reference for **day-to-day cluster work**. See also [Docker basics](Docker%20basics.md) and the [official docs](https://kubernetes.io/docs/).

## Inspect

- \`kubectl get pods -A\` lists pods in every namespace
- \`kubectl describe pod <name>\` shows *events* and restarts
- [x] Set up \`kubectx\` and \`kubens\`
- [ ] Learn \`kubectl debug\`

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

test('README screenshot', async ({ page, drive, isMobile }) => {
  test.skip(isMobile || !process.env.README_SCREENSHOT, 'only when regenerating the README screenshot')
  const files: Record<string, string> = {
    'DevOps/Kubernetes cheatsheet.md': NOTE,
    'DevOps/Docker basics.md': '# Docker basics',
    'DevOps/Terraform.md': '# Terraform',
    'DevOps/AWS/IAM policies.md': '# IAM policies',
    'DevOps/AWS/S3 lifecycle.md': '# S3 lifecycle',
    'DevOps/_meta.json': JSON.stringify({
      icon: 'server',
      notes: {
        'Kubernetes cheatsheet.md': 'ship-wheel',
        'Docker basics.md': 'container',
        'Terraform.md': 'blocks',
      },
    }),
    'DevOps/AWS/_meta.json': JSON.stringify({ icon: 'cloud' }),
    'Projects/Wisp Notes roadmap.md': '# Roadmap',
    'Projects/Homelab.md': '# Homelab',
    'Projects/_meta.json': JSON.stringify({ icon: 'rocket', notes: { 'Homelab.md': 'house' } }),
    'Reading/Books 2026.md': '# Books',
    'Reading/_meta.json': JSON.stringify({ icon: 'book-open' }),
    'Journal.md': '# Journal',
    'Inbox.md': '# Inbox',
  }
  for (const [p, c] of Object.entries(files)) drive.write(p, c)
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
      JSON.stringify({ DevOps: true, 'DevOps/AWS': true, Projects: true }),
    )
  })
  await page.goto('/n/DevOps/Kubernetes%20cheatsheet.md')
  const editor = page.locator('.cm-content')
  await expect(editor).toContainText('rollout status')
  // Unfocused editor: live preview hides all Markdown syntax
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await page.addStyleTag({ content: '.cm-fat-cursor { display: none }' }) // no stray cursor in the picture
  await page.mouse.move(1270, 890)
  await page.waitForTimeout(800) // code-block language highlighting loads lazily
  await page.screenshot({ path: 'docs/screenshot.png' })
})
