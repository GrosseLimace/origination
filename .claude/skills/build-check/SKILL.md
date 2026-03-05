---
name: build-check
description: Run project build and report errors - supports dotnet build, ng build, and npm run build. Use when user says build, check build, or compile.
---

# Build Check Skill

## Purpose

Run the project's build process and provide a clear summary of any errors or warnings.

## When to Use

Run `/build-check` to:
- Verify code compiles/transpiles without errors
- Check for type errors before committing
- Validate the project after major changes
- Ensure the build works before creating a PR

## Process

### Step 1: Detect Build System

Check for these files to determine the build system:

| File | Build System | Command |
|------|--------------|---------|
| `*.csproj` or `*.sln` | .NET | `dotnet build` |
| `angular.json` | Angular CLI | `ng build` |
| `package.json` with build script | Node.js/npm | `npm run build` |

### Step 2: Run Build

Execute the appropriate build command:

**.NET**:
```bash
dotnet build --verbosity normal
```

For solutions with multiple projects:
```bash
dotnet build [solution-name].sln --verbosity normal
```

**Angular**:
```bash
ng build --configuration development
```

For production build check:
```bash
ng build --configuration production
```

**Node.js**:
```bash
npm run build
```

### Step 3: Parse Build Output

Categorize the output:

| Category | Pattern | Action |
|----------|---------|--------|
| **ERROR** | `error CS`, `ERROR`, `Error:` | Must fix |
| **WARNING** | `warning CS`, `WARNING`, `Warning:` | Should review |
| **INFO** | Build succeeded, timing info | Report only |

### Step 4: Generate Report

```text
BUILD CHECK COMPLETE

Build System: [.NET/Angular/npm]
Command: [command that was run]
Duration: [X.Xs]

Result: [SUCCESS / FAILED]

Errors: [0 / count]
[If errors, list each with file:line and message]

Warnings: [0 / count]
[If warnings, list each with file:line and message]

Output Location: [bin/Debug/, dist/, build/, etc.]

[If failed]
RECOMMENDED FIXES:
1. [Specific fix for error 1]
2. [Specific fix for error 2]
```

## Common Error Categories

### .NET Errors
| Code | Meaning | Common Fix |
|------|---------|------------|
| CS0103 | Name does not exist | Missing using statement or typo |
| CS0246 | Type not found | Missing package reference or using |
| CS1061 | Missing member | Check class definition, update interface |
| CS0029 | Cannot convert type | Type mismatch, add cast or fix logic |

### Angular/TypeScript Errors
| Pattern | Meaning | Common Fix |
|---------|---------|------------|
| TS2304 | Cannot find name | Missing import or declaration |
| TS2339 | Property does not exist | Add property to interface or check spelling |
| TS2345 | Argument type mismatch | Fix parameter type or add conversion |
| NG0100 | ExpressionChanged | Move logic to ngOnInit or use ChangeDetectorRef |

## Options

- `/build-check prod` - Run production build (stricter checks)
- `/build-check verbose` - Show full build output
- `/build-check clean` - Clean before building

## Notes

- For .NET, check if `dotnet restore` is needed first
- For Angular, check if `npm install` is needed
- Report build time for performance tracking
- Offer to help fix any errors found