import '@testing-library/jest-dom/vitest';
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
