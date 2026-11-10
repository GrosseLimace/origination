// @ts-check
//
// Module boundaries for the SPA:
//   shared   imports only shared (and plain models and environment settings)
//   core     imports core and shared, never a feature
//   features import core and shared, their own files, and only the modules they build on (moduleDependsOn below),
//            through each one's public index.ts
//   main.ts and app.* are the composition root and may import anything
// Only the boundary rules are on. Angular's recommended rule set is a separate decision.
const { defineConfig } = require('eslint/config');
const tseslint = require('typescript-eslint');
const boundaries = require('eslint-plugin-boundaries');

/**
 * The modules each module builds on: the backend's module map, plus the frontend-only modules. A folder under
 * src/app/features is a module. Imports between modules only follow these arrows, and only to an index.ts.
 */
const moduleDependsOn = {
  customers: [],
  contracts: ['customers'],
  engagement: ['customers'],
  producers: ['contracts', 'customers'],
  lists: ['producers', 'contracts', 'customers'],
  'bid-sheet': ['engagement'],
  'usage-analytics': ['lists', 'contracts', 'customers'],
  calculators: [],
  help: [],
  'whats-new': [],
};

/** Who may import whom. Anything not allowed here is a violation (default: disallow). */
const dependencies = {
  default: 'disallow',
  message: '{{ from.element.type }} may not import {{ to.element.type }} ({{ to.element.path }})',
  policies: [
    // The composition root (in no element) may import anything.
    { from: { element: { isUnknown: true } }, allow: { to: { element: { type: ['core', 'shared', 'models', 'feature', 'environment', 'testing'] } } } },
    { from: { element: { type: 'core' } }, allow: { to: { element: { type: ['core', 'shared', 'models', 'environment'] } } } },
    { from: { element: { type: 'shared' } }, allow: { to: { element: { type: ['shared', 'models', 'environment'] } } } },
    { from: { element: { type: 'models' } }, allow: { to: { element: { type: 'models' } } } },
    { from: { element: { type: 'environment' } }, allow: { to: { element: { type: 'environment' } } } },
    // The shared test helpers stub core services.
    { from: { element: { type: 'testing' } }, allow: { to: { element: { type: ['core', 'shared', 'models', 'environment'] } } } },
    { from: { element: { type: 'feature' } }, allow: { to: { element: { type: ['core', 'shared', 'models', 'environment'] } } } },
    // Another module only if this one builds on it, and only through its index.ts. A module's own files are
    // internal and never checked.
    ...Object.entries(moduleDependsOn)
      .filter(([, dependsOn]) => dependsOn.length > 0)
      .map(([module, dependsOn]) => ({
        from: { element: { type: 'feature', captured: { module } } },
        allow: { to: { element: { type: 'feature', captured: { module: dependsOn }, fileInternalPath: 'index.ts' } } },
      })),
    // Tests may also use the shared test helpers.
    { from: { file: { categories: 'test' } }, allow: { to: { element: { type: 'testing' } } } },
  ],
};

module.exports = defineConfig(
  {
    ignores: ['dist/**', '.angular/**', 'coverage/**', 'node_modules/**', 'tests/**'],
  },
  {
    files: ['src/**/*.ts'],
    languageOptions: { parser: tseslint.parser },
    plugins: { boundaries },
    settings: {
      // Resolves the @core/*, @shared/*, @features/<module> and @models aliases from tsconfig.json.
      'import/resolver': { typescript: { project: './tsconfig.json' } },
      // Files outside every element (src/main.ts, src/setup-tests.ts and src/app/app.*) are the composition root
      // and aren't checked.
      'boundaries/elements': [
        { type: 'core', pattern: 'src/app/core', partialMatch: false },
        { type: 'shared', pattern: 'src/app/shared', partialMatch: false },
        { type: 'models', pattern: 'src/app/models', partialMatch: false },
        { type: 'feature', pattern: 'src/app/features/*', capture: ['module'], partialMatch: false },
        { type: 'environment', pattern: 'src/environments', partialMatch: false },
        { type: 'testing', pattern: 'src/testing', partialMatch: false },
      ],
      'boundaries/files': [{ category: 'test', pattern: '**/*.spec.ts' }],
    },
    rules: {
      'boundaries/dependencies': ['error', dependencies],
    },
  },
);
