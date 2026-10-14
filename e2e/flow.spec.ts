import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { expect, test } from './fixtures.ts'

/** On phone-sized viewports the sidebar is a drawer that must be opened first. */
async function ensureSidebar(page: Page) {
  const nav = page.getByRole('navigation', { name: 'Notes' })
  if (!(await nav.isVisible())) await page.getByRole('button', { name: 'Toggle sidebar' }).click()
  await expect(nav).toBeVisible()
  return nav
}

/** Pre-signed-in state: account + valid token in localStorage. */
async function signedIn(page: Page, vim = true) {
  await page.addInitScript((vim) => {
    if (localStorage.getItem('wisp-notes:settings')) return
    localStorage.setItem(
      'wisp-notes:settings',
      JSON.stringify({ account: { email: 'me@example.com', name: 'Me' }, vim, livePreview: true }),
    )
    localStorage.setItem(
      'wisp-notes:token',
      JSON.stringify({ token: 'good-token', expiresAt: Date.now() + 3_600_000 }),
    )
  }, vim)
}

test('sign in → browse → edit → auto-save → rename → search', async ({ page, drive, isMobile }) => {
  // Sign in with Google
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
  await page.getByRole('button', { name: 'Sign in with Google' }).click()
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
  await expect(page.locator('.cm-lp-task')).toHaveCount(1) // live preview checkbox

  // Edit with vim (on by default): end of document, new line, type
  await expect(page.getByTestId('vim-mode')).toHaveText(/normal/i)
  await editor.click()
  await page.keyboard.press('Escape')
  await page.keyboard.type('Go')
  await expect(page.getByTestId('vim-mode')).toHaveText(/insert/i)
  await page.keyboard.type('Added from the browser 🎉')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('status', { name: 'Save status: Unsaved' })).toBeVisible()

  // No save on idle (auto-save runs once a minute); :w saves now
  await page.waitForTimeout(4000)
  await expect(page.getByRole('status', { name: 'Save status: Unsaved' })).toBeVisible()
  await page.keyboard.type(':w')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('status', { name: 'Save status: Saved' })).toBeVisible({ timeout: 10_000 })
  expect(drive.files()['Work/Plan.md']).toContain('Added from the browser 🎉')

  // Rename the open note via its actions menu
  nav = await ensureSidebar(page)
  await nav.getByRole('button', { name: 'Actions for Plan' }).click()
  await page.getByRole('menuitem', { name: 'Rename' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('New name').fill('Roadmap')
  await dialog.getByRole('button', { name: 'Rename' }).click()
  await expect(page).toHaveURL(/\/n\/Work\/Roadmap\.md$/)
  await expect.poll(() => drive.files()['Work/Roadmap.md']).toContain('Added from the browser')
  expect(drive.files()['Work/Plan.md']).toBeUndefined()

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

test('shows the latest content from another device when returning to the tab', async ({ page, drive }) => {
  await signedIn(page, false)
  await page.goto('/n/Inbox.md')
  const editor = page.locator('.cm-content')
  await expect(editor).toContainText('Things to sort.')
  drive.write('Inbox.md', '# Inbox\n\nEdited on my laptop.')
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(editor).toContainText('Edited on my laptop.')
})

test('imports a folder (Markdown + screenshots)', async ({ page, drive, isMobile }) => {
  const dir = mkdtempSync(join(tmpdir(), 'wisp-import-'))
  const exp = join(dir, 'Notion Export')
  mkdirSync(join(exp, 'img'), { recursive: true })
  writeFileSync(join(exp, 'Meeting notes.md'), '# Meeting\n\nSee screenshot.')
  writeFileSync(join(exp, 'img', 'shot.png'), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  try {
    await signedIn(page)
    await page.goto('/')
    const nav = await ensureSidebar(page)
    const chooser = page.waitForEvent('filechooser')
    await nav.getByRole('button', { name: 'Import folder' }).click()
    await (await chooser).setFiles(exp)
    await expect(page.getByText('Imported 2 files.')).toBeVisible({ timeout: 10_000 })
    expect(drive.files()['Notion Export/Meeting notes.md']).toBe('# Meeting\n\nSee screenshot.')
    expect([...drive.bytes('Notion Export/img/shot.png')!]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
    if (isMobile) await ensureSidebar(page)
    await nav.getByRole('button', { name: /^Notion Export/ }).click()
    await expect(nav.getByRole('link', { name: /^Meeting notes/ })).toBeVisible()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('works offline from the cache and shows the offline status', async ({ page, drive }) => {
  await signedIn(page, false)
  await page.goto('/n/Inbox.md')
  await expect(page.locator('.cm-content')).toContainText('Things to sort.')
  drive.offline = true
  await page.reload()
  await expect(page.locator('.cm-content')).toContainText('Things to sort.')
  await expect(page.getByRole('status', { name: 'Save status: Offline' })).toBeVisible()
})

test('drag a note into a folder', async ({ page, drive, isMobile }) => {
  test.skip(isMobile, 'HTML5 drag and drop is mouse-only; phones use "Move to…"')
  await signedIn(page, false)
  await page.goto('/')
  const nav = await ensureSidebar(page)
  await nav.getByRole('link', { name: /^Inbox/ }).dragTo(nav.getByRole('button', { name: /^Home/ }))
  await expect.poll(() => drive.files()['Home/Inbox.md']).toBe('# Inbox\n\nThings to sort.')
  expect(drive.files()['Inbox.md']).toBeUndefined()
  await expect(nav.getByRole('link', { name: /^Inbox/ })).toHaveAttribute('href', '/n/Home/Inbox.md')
})

test('vim \\ff opens search', async ({ page, drive, isMobile }) => {
  void drive // installs the Drive mock
  test.skip(isMobile, 'keyboard shortcut')
  await signedIn(page)
  await page.goto('/n/Inbox.md')
  const editor = page.locator('.cm-content')
  await expect(editor).toContainText('Things to sort.')
  await editor.click()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('vim-mode')).toHaveText(/normal/i)
  await page.keyboard.type('\\ff')
  await expect(page.getByRole('combobox', { name: 'Search notes' })).toBeFocused()
  await expect(editor).toContainText('Things to sort.')
})

test('\\ff opens search when focus is outside the editor', async ({ page, drive, isMobile }) => {
  void drive // installs the Drive mock
  test.skip(isMobile, 'keyboard shortcut')
  await signedIn(page)
  await page.goto('/n/Inbox.md')
  await expect(page.locator('.cm-content')).toContainText('Things to sort.')
  await page
    .getByRole('navigation', { name: 'Notes' })
    .getByRole('link', { name: /^Inbox/ })
    .focus()
  await page.keyboard.type('\\ff')
  await expect(page.getByRole('combobox', { name: 'Search notes' })).toBeFocused()
})

test('drag a note onto another note to nest it as a sub-note', async ({ page, drive, isMobile }) => {
  test.skip(isMobile, 'HTML5 drag and drop is mouse-only; phones use "Move to…"')
  await signedIn(page, false)
  await page.goto('/')
  const nav = await ensureSidebar(page)
  await nav.getByRole('button', { name: /^Home/ }).click()
  await nav.getByRole('link', { name: /^Inbox/ }).dragTo(nav.getByRole('link', { name: /^Recipes/ }))
  await expect.poll(() => drive.files()['Home/Recipes/Inbox.md']).toBe('# Inbox\n\nThings to sort.')
  const recipes = nav.getByRole('treeitem', { name: 'Recipes' })
  await expect(recipes).toHaveAttribute('aria-expanded', 'true')
  await recipes.getByRole('link', { name: /^Inbox/ }).click()
  await expect(page).toHaveURL(/\/n\/Home\/Recipes\/Inbox\.md$/)
  await recipes.getByRole('button', { name: 'Collapse Recipes' }).click()
  await expect(recipes).toHaveAttribute('aria-expanded', 'false')
})

test('upload an image as a note icon', async ({ page, drive }) => {
  await signedIn(page, false)
  await page.goto('/')
  const nav = await ensureSidebar(page)
  await nav.getByRole('button', { name: 'Actions for Inbox' }).click()
  await page.getByRole('menuitem', { name: 'Change icon' }).click()
  // 3×2 red PNG
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAYAAACddGYaAAAAEklEQVR4nGP4z8DwHxkzEC4AAA75Df+JXyZEAAAAAElFTkSuQmCC',
    'base64',
  )
  await page
    .getByTestId('icon-upload')
    .setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: png })
  const img = nav.getByRole('treeitem', { name: 'Inbox' }).locator('img[data-icon="custom"]')
  await expect(img).toBeVisible()
  expect(await img.evaluate((el: HTMLImageElement) => [el.naturalWidth, el.naturalHeight])).toEqual([64, 64])
  await expect
    .poll(() => JSON.parse(drive.files()['_meta.json'] ?? '{}').notes?.['Inbox.md'] as string | undefined)
    .toMatch(/^data:image\/png;base64,/)
})

test('Ctrl+click opens links: notes in the app, websites in a new tab', async ({ page, drive, isMobile }) => {
  test.skip(isMobile, 'Ctrl+click needs a mouse and keyboard')
  drive.write(
    'Work/Links.md',
    'Back to [the inbox](../Inbox.md).\n\nOr visit [the site](https://example.com/).\n\nEnd',
  )
  await signedIn(page)
  await page.route('https://example.com/**', (r) => r.fulfill({ body: 'external' }))
  await page.goto('/n/Work/Links.md')
  const editor = page.locator('.cm-content')
  await expect(editor).toContainText('the site')
  await editor.getByText('End').click() // cursor off the link lines → live preview hides the syntax

  // A plain click only moves the cursor
  await editor.getByText('the inbox').click()
  await expect(page).toHaveURL(/\/n\/Work\/Links\.md$/)
  await editor.getByText('End').click()

  const popup = page.waitForEvent('popup')
  await editor.getByText('the site').click({ modifiers: ['ControlOrMeta'] })
  await expect(await popup).toHaveURL('https://example.com/')

  await editor.getByText('the inbox').click({ modifiers: ['ControlOrMeta'] })
  await expect(page).toHaveURL(/\/n\/Inbox\.md$/)
  await expect(editor).toContainText('Things to sort.')
})

test('a note with "/" in its name opens from a deep link and survives a reload', async ({
  page,
  drive,
  isMobile,
}) => {
  test.skip(isMobile, 'same code path as desktop')
  drive.write('Ops.md', 'placeholder')
  drive.renameRemote('Ops.md', 'CI/CD.md')
  await signedIn(page)
  await page.goto('/n/CI%2FCD.md')
  await expect(page.locator('.cm-content')).toContainText('placeholder')
  await page.reload()
  await expect(page.locator('.cm-content')).toContainText('placeholder')
  await expect(page).toHaveTitle('CI/CD · Wisp Notes')
})
