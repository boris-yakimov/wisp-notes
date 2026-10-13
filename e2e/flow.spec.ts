import type { Page } from '@playwright/test'
import { expect, test } from './fixtures.ts'

/** On phone-sized viewports the sidebar is a drawer that must be opened first. */
async function ensureSidebar(page: Page) {
  const nav = page.getByRole('navigation', { name: 'Notes' })
  if (!(await nav.isVisible())) await page.getByRole('button', { name: 'Toggle sidebar' }).click()
  await expect(nav).toBeVisible()
  return nav
}

test('connect → browse → edit → auto-save → rename → search', async ({ page, gh, isMobile }) => {
  // Connect
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Connect to GitHub' })).toBeVisible()
  await page.getByLabel('Personal access token').fill('good-token')
  await page.getByLabel('Owner').fill('me')
  await page.getByLabel('Repository').fill('notes')
  await page.getByRole('button', { name: 'Connect' }).click()
  await expect(page.getByText('Connected to me/notes')).toBeVisible()
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByText(/Select a note|Loading notes/)).toBeVisible()

  // Browse: folder with its icon, open a note
  let nav = await ensureSidebar(page)
  const work = nav.getByRole('treeitem', { name: 'Work' })
  await expect(work.locator('svg[data-icon="briefcase"]')).toBeVisible()
  await nav.getByRole('button', { name: /^Work/ }).click()
  await nav.getByRole('link', { name: /^Plan/ }).click()
  await expect(page).toHaveURL(/\/n\/Work\/Plan\.md$/)
  if (isMobile) await expect(nav).toBeHidden() // drawer closes after navigating
  const editor = page.locator('.cm-content')
  await expect(editor).toContainText('Ship Wisp Notes this week.')
  // Live preview: the bold markers are hidden off the cursor line, a checkbox is rendered
  await expect(page.locator('.cm-lp-task')).toHaveCount(1)

  // Edit with vim (on by default): go to end of document, open a new line, type
  await expect(page.getByTestId('vim-mode')).toHaveText(/normal/i)
  await editor.click()
  await page.keyboard.press('Escape')
  await page.keyboard.type('Go')
  await expect(page.getByTestId('vim-mode')).toHaveText(/insert/i)
  await page.keyboard.type('Added from the browser 🎉')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('status', { name: 'Save status: Unsaved' })).toBeVisible()

  // Auto-save after ~3s idle
  await expect(page.getByRole('status', { name: 'Save status: Saved' })).toBeVisible({ timeout: 10_000 })
  expect(gh.files()['Work/Plan.md']).toContain('Added from the browser 🎉')
  expect(gh.commitCount()).toBe(2)

  // Rename the open note via its actions menu
  nav = await ensureSidebar(page)
  await nav.getByRole('button', { name: 'Actions for Plan' }).click()
  await page.getByRole('menuitem', { name: 'Rename' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('New name').fill('Roadmap')
  await dialog.getByRole('button', { name: 'Rename' }).click()
  await expect(page).toHaveURL(/\/n\/Work\/Roadmap\.md$/)
  await expect.poll(() => gh.files()['Work/Roadmap.md']).toContain('Added from the browser')
  expect(gh.files()['Work/Plan.md']).toBeUndefined()
  expect(gh.commitCount()).toBe(3)

  // Search (content match) and jump to the note with the match selected
  await page.goto('/') // fresh load: cached tree + background prefetch
  if (isMobile) {
    nav = await ensureSidebar(page)
    await nav.getByRole('button', { name: /^Search/ }).click()
  } else {
    await expect(page.getByRole('navigation', { name: 'Notes' })).toBeVisible()
    await page.keyboard.press('Control+k')
  }
  const box = page.getByRole('combobox', { name: 'Search notes' })
  await box.fill('pancakes')
  const results = page.getByRole('listbox', { name: 'Results' }).getByRole('option')
  await expect(results).toHaveCount(1, { timeout: 10_000 })
  await expect(results.first()).toContainText('Recipes')
  await expect(results.first().locator('mark')).toHaveText(/pancakes/i)
  await box.press('Enter')
  await expect(page).toHaveURL(/\/n\/Home\/Recipes\.md$/)
  await expect(editor).toContainText('Pancakes')
  expect(await page.evaluate(() => window.getSelection()?.toString())).toMatch(/pancakes/i)
})

test('works offline from the cache and shows the offline status', async ({ page, gh }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'wisp-notes:settings',
      JSON.stringify({
        token: 'good-token',
        owner: 'me',
        repo: 'notes',
        branch: 'main',
        vim: false,
        livePreview: true,
      }),
    )
  })
  await page.goto('/n/Inbox.md')
  await expect(page.locator('.cm-content')).toContainText('Things to sort.')
  gh.offline = true
  await page.reload()
  await expect(page.locator('.cm-content')).toContainText('Things to sort.')
  await expect(page.getByRole('status', { name: 'Save status: Offline' })).toBeVisible()
})
