import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { getTestBed } from '@angular/core/testing';
import {
  BrowserDynamicTestingModule,
  platformBrowserDynamicTesting,
} from '@angular/platform-browser-dynamic/testing';

// `initTestEnvironment` may only run once per test environment, and Vitest can share a single
// environment across spec files (e.g. the threads pool used on the CI runner). Guard against a
// second call, which otherwise throws "Cannot set base providers because it has already been called".
const testBed = getTestBed();
if (!testBed.platform) {
  testBed.initTestEnvironment(
    BrowserDynamicTestingModule,
    platformBrowserDynamicTesting(),
    { teardown: { destroyAfterEach: true } }
  );
}

// `initTestEnvironment(..., { teardown: { destroyAfterEach: true } })` is also what registers Angular's
// per-test TestBed reset — but the `!platform` guard above means that only runs for the FIRST spec file
// in a shared environment (the CI runner reuses one environment across files). Every file/test after
// that would then hit "Cannot configure the test module when the test module has already been
// instantiated" on its next `configureTestingModule`. Register the reset unconditionally so every test
// gets a clean TestBed regardless of isolation. (No-op cost when isolation IS on — each file is fresh.)
afterEach(() => {
  getTestBed().resetTestingModule();
});
