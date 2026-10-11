import { expect, test } from '@playwright/test'

test('app shell loads', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Wisp Notes' })).toBeVisible()
  await expect(page).toHaveTitle('Wisp Notes')
})
