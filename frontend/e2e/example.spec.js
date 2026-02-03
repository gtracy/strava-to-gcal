import { test, expect } from '@playwright/test';

test('has title', async ({ page }) => {
    await page.goto('/');

    // Expect a title "to contain" a substring.
    await expect(page).toHaveTitle(/frontend/);
});

test('shows sign in button', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: /Sign in with Google/i })).toBeVisible();
});
