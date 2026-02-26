---
name: env-check
description: Verify development environment matches project requirements - checks installed packages, runtimes, and configuration files. Use when user says check environment, env check, or verify setup.
---

# Environment Check Skill

## Purpose

Verify that the development environment is correctly configured and all dependencies are installed.

## When to Use

Run `/env-check` when:
- Starting work on a project after a break
- After pulling changes that might have new dependencies
- When encountering import/module errors
- Setting up a project on a new machine

## Process

### Step 1: Detect Environment Type

Check for these files to determine the environment type:

| File | Environment Type |
|------|-----------------|
| `*.csproj` or `*.sln` | .NET |
| `angular.json` | Angular |
| `package.json` | Node.js |

### Step 2: Check Active Environment

**.NET**:
```bash
dotnet --version
dotnet --list-sdks
```

**Node.js**:
```bash
node --version
npm --version
```

**Angular** (in addition to Node.js checks):
```bash
ng version
```

### Step 3: Compare Installed vs Required

**.NET**:
Check `*.csproj` for `<PackageReference>` entries and verify with:
```bash
dotnet list package
```

**Node.js / Angular**:
Compare `package.json` dependencies against:
```bash
npm list --depth=0
```

### Step 4: Check Configuration Files

Verify these configuration files exist and are valid:

| Project Type | Config Files |
|--------------|--------------|
| .NET | `appsettings.json`, `appsettings.Development.json` |
| Angular | `environment.ts`, `angular.json` |
| Node.js | `.env`, `config.json` |

### Step 5: Generate Report

```text
ENVIRONMENT CHECK COMPLETE

Environment Type: [.NET/Angular/Node.js]
Active Environment: [name or path]

Runtime Versions:
- .NET: X.X.X (or N/A)
- Node: X.X.X (or N/A)
- Angular CLI: X.X.X (or N/A)

Dependencies:
- Required: XX packages
- Installed: XX packages
- Missing: [None / List]
- Outdated: [None / List]

Configuration:
- [config file]: [Found / Missing]
- [config file]: [Found / Missing]

Status: [Ready / Action Required]

[If action required, list specific steps to fix]
```

## Common Fixes

If issues are found, suggest fixes:

**Missing npm packages**:
```bash
npm install
```

**Missing .NET packages**:
```bash
dotnet restore
```

## Notes

- Don't automatically install packages - just report what's missing
- Highlight version mismatches that might cause issues
- Check for common issues like wrong .NET SDK version for the project