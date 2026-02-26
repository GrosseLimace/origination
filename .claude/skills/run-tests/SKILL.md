---
name: run-tests
description: Framework-aware test runner - detects project type and runs appropriate test command (dotnet test, ng test, npm test). Use when user says run tests, test, or check tests.
---

# Run Tests Skill

## Purpose

Automatically detect the project's test framework and run tests with appropriate options.

## When to Use

Run `/run-tests` to execute the project's test suite. Works across .NET, Angular, and Node.js projects.

## Process

### Step 1: Detect Project Type

Check for these files in order to determine the test framework:

| File Present | Framework | Command |
|--------------|-----------|---------|
| `*.csproj` with test references | xUnit/.NET | `dotnet test` |
| `angular.json` | Angular/Karma | `ng test --watch=false` |
| `package.json` with test script | Node/Jest | `npm test` |

### Step 2: Check for Test Configuration

Look for test configuration that might affect how tests run:

**.NET**:
- Check for `*.Tests.csproj` projects
- Look for test settings files

**Angular**:
- Check `karma.conf.js` for configuration
- Look for `--code-coverage` options

### Step 3: Run Tests

Execute the appropriate command:

**.NET**:
```bash
dotnet test --verbosity normal
```

**Angular**:
```bash
ng test --watch=false --browsers=ChromeHeadless
```

**Node.js**:
```bash
npm test
```

### Step 4: Report Results

Summarize the test run:

```text
TEST RUN COMPLETE

Framework: [xUnit/Karma/Jest]
Command: [command that was run]

Results:
- Total: XX tests
- Passed: XX
- Failed: XX
- Skipped: XX

[If failures exist, list the failing test names]

Coverage: XX% (if available)
```

## Options

Users can specify options:

- `/run-tests verbose` - Run with maximum verbosity
- `/run-tests coverage` - Include coverage report
- `/run-tests <path>` - Run tests in specific directory/file

## Notes

- If no test framework is detected, inform the user and ask what framework to use
- If tests fail, offer to help debug the failures
- For long-running test suites, suggest running specific test files