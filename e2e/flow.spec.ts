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

test('pick a colorful logo as a note icon', async ({ page, drive }) => {
  await signedIn(page, false)
  await page.goto('/')
  const nav = await ensureSidebar(page)
  await nav.getByRole('button', { name: 'Actions for Inbox' }).click()
  await page.getByRole('menuitem', { name: 'Change icon' }).click()
  await page.getByRole('tab', { name: 'Logos' }).click()
  const grid = page.getByRole('listbox', { name: 'Icons' })
  // Every logo in the grid is a real, loadable image (served from the build, allowed by the CSP).
  await expect(grid.getByRole('option', { name: 'AWS' }).locator('img')).toBeVisible()
  await page.getByRole('searchbox', { name: 'Search icons' }).fill('kubernetes')
  await grid.getByRole('option', { name: 'Kubernetes' }).click()
  const img = nav.getByRole('treeitem', { name: 'Inbox' }).locator('img[data-icon="logo:kubernetes"]')
  await expect(img).toBeVisible()
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0)
  await expect
    .poll(() => JSON.parse(drive.files()['_meta.json'] ?? '{}').notes?.['Inbox.md'] as string | undefined)
    .toBe('logo:kubernetes')
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

test('drag to the edge of a row to reorder; the middle still nests', async ({ page, drive, isMobile }) => {
  test.skip(isMobile, 'HTML5 drag and drop is mouse-only; phones use "Move up/down"')
  await signedIn(page, false)
  await page.goto('/')
  const nav = await ensureSidebar(page)
  const top = () =>
    nav
      .locator('[role=tree] > [role=treeitem]')
      .evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))
  await expect.poll(top).toEqual(['Home', 'Work', 'Inbox'])

  // Top edge of "Home": Inbox goes before it
  const home = nav.getByRole('button', { name: /^Home/ })
  await nav.getByRole('link', { name: /^Inbox/ }).dragTo(home, { targetPosition: { x: 40, y: 2 } })
  await expect.poll(top).toEqual(['Inbox', 'Home', 'Work'])
  await expect.poll(() => drive.files()['_meta.json']).toContain('"Inbox.md"')
  expect(drive.files()['Inbox.md']).toBeDefined() // reordered, not moved

  // Bottom edge of "Work": Home goes after it
  const work = nav.getByRole('button', { name: /^Work/ })
  const box = (await work.boundingBox())!
  await home.dragTo(work, { targetPosition: { x: 40, y: box.height - 2 } })
  await expect.poll(top).toEqual(['Inbox', 'Work', 'Home'])

  // Order survives a reload (read back from Drive)
  await page.reload()
  await expect.poll(top).toEqual(['Inbox', 'Work', 'Home'])

  // Middle of a folder row still moves the item into it
  await nav.getByRole('link', { name: /^Inbox/ }).dragTo(work)
  await expect.poll(() => drive.files()['Work/Inbox.md']).toBe('# Inbox\n\nThings to sort.')
})

test('images in a note are shown inline, loaded from Drive', async ({ page, drive, isMobile }) => {
  test.skip(isMobile, 'same code path as desktop')
  // 2×2 red PNG
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR4nGP4z8DwHwyBNAMDAE2kBf1ZNkx6AAAAAElFTkSuQmCC',
    'base64',
  )
  drive.write('Trips/Italy.md', '# Italy\n\n## Car\n\n![](Italy/Untitled%201.png)\n\nend')
  drive.writeBytes('Trips/Italy/Untitled 1.png', new Uint8Array(png))
  await signedIn(page)
  await page.goto('/n/Trips/Italy.md')
  const img = page.locator('.cm-image img')
  await expect(img).toBeVisible()
  await expect.poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBe(2)
  await expect(img).toHaveAttribute('src', /^blob:/)
  // The image file itself is not listed as a note in the sidebar
  await expect(page.getByRole('navigation', { name: 'Notes' }).getByText('Untitled 1')).toHaveCount(0)
})

test('paste an image from the clipboard: shown in the note and saved to Drive', async ({
  page,
  drive,
  isMobile,
}) => {
  test.skip(isMobile, 'same code path as desktop')
  await signedIn(page, false)
  await page.goto('/n/Work/Plan.md')
  const editor = page.locator('.cm-content')
  await expect(editor).toContainText('write tests')
  await editor.click()
  await page.keyboard.press('ControlOrMeta+End')
  // Clipboard with a 2×2 PNG, as when pasting a screenshot
  await editor.evaluate((el) => {
    const b64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR4nGP4z8DwHwyBNAMDAE2kBf1ZNkx6AAAAAElFTkSuQmCC'
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
    const data = new DataTransfer()
    data.items.add(new File([bytes], 'image.png', { type: 'image/png' }))
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
  })
  const img = page.locator('.cm-image img')
  await expect(img).toBeVisible()
  await expect.poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBe(2)
  await expect
    .poll(() => Object.keys(drive.files()).find((p) => p.startsWith('Work/Plan/Pasted image ')))
    .toMatch(/\.png$/)
  // The note text links to it once saved
  await page.keyboard.press('ControlOrMeta+s')
  await expect.poll(() => drive.files()['Work/Plan.md']).toMatch(/!\[\]\(Plan\/Pasted%20image%20[^)]+\.png\)/)
  // After a reload, the image comes back from Drive
  await page.reload()
  await expect(page.locator('.cm-image img')).toBeVisible()
  await expect
    .poll(() => page.locator('.cm-image img').evaluate((el) => (el as HTMLImageElement).naturalWidth))
    .toBe(2)
})

test('Ctrl+Shift+V pastes an image even in vim normal mode', async ({ page, context, drive, isMobile }) => {
  test.skip(isMobile, 'keyboard shortcut')
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await signedIn(page) // vim on
  await page.goto('/n/Work/Plan.md')
  const editor = page.locator('.cm-content')
  await expect(editor).toContainText('write tests')
  await editor.click()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('vim-mode')).toHaveText(/normal/i)
  await page.keyboard.type('gg')
  // Put a 2×2 PNG on the system clipboard, as a screenshot tool would
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 2
    canvas.getContext('2d')!.fillRect(0, 0, 2, 2)
    const blob = await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), 'image/png'))
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
  })
  await page.keyboard.press('ControlOrMeta+Shift+V')
  await expect(page.locator('.cm-image img')).toBeVisible()
  await expect(page.getByTestId('vim-mode')).toHaveText(/normal/i) // still in normal mode, no block selection
  await expect
    .poll(() => Object.keys(drive.files()).find((p) => p.startsWith('Work/Plan/Pasted image ')))
    .toMatch(/\.png$/)
  // Inserted as its own line below the first line ("# Plan"), like vim's linewise `p`
  await page.keyboard.press('ControlOrMeta+s')
  await expect
    .poll(() => drive.files()['Work/Plan.md'])
    .toMatch(/^# Plan\n!\[\]\(Plan\/Pasted%20image%20[^)]+\.png\)\n/)

  // With text on the clipboard it pastes the text
  await page.evaluate(() => navigator.clipboard.writeText('from clipboard'))
  await page.keyboard.press('ControlOrMeta+Shift+V')
  await expect(editor).toContainText('from clipboard')
})

test('tables show as a grid; arrow keys and vim j open them for editing', async ({
  page,
  drive,
  isMobile,
}) => {
  test.skip(isMobile, 'keyboard')
  drive.write(
    'Trips/Italy.md',
    '# Italy\n\nBefore\n\n| Activity | Date |\n|---|---|\n| [Plan](../Work/Plan.md) | May 7 |\n\nAfter',
  )
  await signedIn(page) // vim on
  await page.goto('/n/Trips/Italy.md')
  const editor = page.locator('.cm-content')
  const table = page.locator('table.cm-table')
  await expect(table).toBeVisible()
  await expect(table.locator('td').first()).toHaveText('Plan')

  // vim: from "Before", j j → onto the table's first line: Markdown shown
  await editor.getByText('Before').click()
  await page.keyboard.press('Escape')
  await page.keyboard.type('jj')
  await expect(table).toHaveCount(0)
  await expect(editor).toContainText('| Activity | Date |')
  await page.keyboard.type('G') // last line: grid again
  await expect(table).toBeVisible()

  // Arrow keys (vim off) from the line above enter the table too
  await page.getByRole('link', { name: 'Settings' }).click()
  await page.getByLabel('Vim mode').uncheck()
  await page.goBack()
  await expect(table).toBeVisible()
  await editor.getByText('Before').click()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await expect(table).toHaveCount(0)
  await page.keyboard.press('ControlOrMeta+End')
  await expect(table).toBeVisible()

  // Ctrl+click on a link in a cell opens the note
  await table.getByText('Plan').click({ modifiers: ['ControlOrMeta'] })
  await expect(page).toHaveURL(/\/n\/Work\/Plan\.md$/)
})

test('color selected text green or red from the toolbar, also in vim visual mode', async ({
  page,
  drive,
  isMobile,
}) => {
  test.skip(isMobile, 'mouse/keyboard selection')
  drive.write('Trips/Plan.md', 'Pay the deposit today\n\nBooking is paid\n\nend')
  await signedIn(page) // vim on
  await page.goto('/n/Trips/Plan.md')
  const editor = page.locator('.cm-content')
  await expect(editor).toContainText('the deposit')

  // Mouse: double-click a word selects it, the toolbar appears
  await editor.getByText('Pay the deposit today').dblclick({ position: { x: 5, y: 8 } })
  await page.getByRole('button', { name: 'Color text red' }).click()
  await expect(page.getByRole('toolbar', { name: 'Text color' })).toHaveCount(0)

  // vim visual mode: select "paid" with v + e
  await editor.getByText('Booking is paid').click()
  await page.keyboard.press('Escape')
  await page.keyboard.type('0wwve')
  await expect(page.getByTestId('vim-mode')).toHaveText(/visual/i)
  await page.getByRole('button', { name: 'Color text green' }).click()
  await expect(page.getByTestId('vim-mode')).toHaveText(/normal/i)

  await page.keyboard.type('G')
  await expect(page.locator('.cm-color-red')).toHaveText('Pay')
  await expect(page.locator('.cm-color-green')).toHaveText('paid')
  await expect(editor).not.toContainText('<span') // tags hidden off the cursor line
  await page.keyboard.press('ControlOrMeta+s')
  await expect
    .poll(() => drive.files()['Trips/Plan.md'])
    .toBe(
      '<span style="color: red">Pay</span> the deposit today\n\nBooking is <span style="color: green">paid</span>\n\nend',
    )
})

test('drag the sidebar edge to resize it; the width is remembered', async ({ page, isMobile }) => {
  test.skip(isMobile, 'The phone drawer has a fixed width')
  await signedIn(page, false)
  await page.goto('/')
  const nav = await ensureSidebar(page)
  const handle = page.getByRole('separator', { name: 'Resize sidebar' })
  const before = (await nav.boundingBox())!.width
  const h = (await handle.boundingBox())!
  await page.mouse.move(h.x + h.width / 2, h.y + 200)
  await page.mouse.down()
  await page.mouse.move(h.x + h.width / 2 + 150, h.y + 200, { steps: 5 })
  await page.mouse.up()
  await expect.poll(async () => Math.round((await nav.boundingBox())!.width)).toBe(Math.round(before + 150))
  await page.reload()
  await expect.poll(async () => Math.round((await nav.boundingBox())!.width)).toBe(Math.round(before + 150))
  await handle.dblclick()
  await expect.poll(async () => Math.round((await nav.boundingBox())!.width)).toBe(Math.round(before))
})
