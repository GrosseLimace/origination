import { test } from '@playwright/test';
import { AppPage } from './pages/app.page';

// Smoke: the built app is alive and serving its shell. See AppPage for the offline/auth caveats
// (a full authenticated journey is deferred pending a test-only auth-bypass decision).
test.describe('App shell', () => {
  test('serves the application shell', async ({ page }) => {
    await new AppPage(page).expectShellServed();
  });
});
