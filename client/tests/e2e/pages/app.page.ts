import { Page, expect } from '@playwright/test';

/**
 * Page Object for the application shell (style-guides/automated-testing.md §10 POM).
 *
 * The app uses MSAL redirect auth, which can't complete headless and tears the live page
 * down on load. So this thin smoke verifies the deployment is *alive and serving its shell*
 * (§11) via an HTTP fetch of the served document — deterministic and offline.
 *
 * A full authenticated browser journey (render the signed-in shell, exercise a read/write)
 * needs a deliberate, env-fenced test-only auth bypass that must never ship to production.
 * That decision is deferred for design review; until then this proves "the build serves".
 */
export class AppPage {
  constructor(private readonly page: Page) {}

  async expectShellServed(): Promise<void> {
    const res = await this.page.request.get('/');
    expect(res.status()).toBe(200);

    const html = await res.text();
    expect(html).toContain('<title>Scoular Origination Workbench</title>');
    expect(html).toContain('<app-root></app-root>');
  }
}
