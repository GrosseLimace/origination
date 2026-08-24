# PowerShell Script Guide

> **Purpose:** This guide is the **PowerShell layer** over [`script-contract.md`](script-contract.md). It covers what is specific to the language: file structure and the comment-based help block, `#requires`, strict mode and error preference, parameter binding, collection unrolling, and versions and platforms.
>
> **Read [`script-contract.md`](script-contract.md) first.** It carries the rules that are not about PowerShell — exit codes and diagnostics, the testability seam, shared-code ownership, guards, path safety, and invoking external tools — and they apply here in full. This file does not restate them.
>
> **What this guide is NOT.** It is not a guide to PowerShell as an interactive shell — an ad-hoc command at a prompt answers to nobody and needs none of this. It is not an application coding standard; for the application itself see [`csharp.md`](csharp.md) and [`angular.md`](angular.md). It does not cover how to test, which is [`automated-testing.md`](automated-testing.md), though several rules here exist purely to make testing possible and say so.

Normative keywords — **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, **MAY** — follow [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119). Terms shared with the contract are defined in its [glossary](script-contract.md#glossary).

Conventions here follow Microsoft's [PowerShell documentation](https://learn.microsoft.com/en-us/powershell/scripting/) and the community [PowerShell Practice and Style](https://poshcode.gitbook.io/powershell-practice-and-style/) guide, except where a repository-script concern (testability, exit-code discipline, path containment) calls for something stricter.

---

## 1. Anatomy of a Script

Every script **MUST** be laid out in this order. A reader who knows the order can find any part of any script without reading it end to end, and a test can rely on the same structure.

```powershell
<#
.SYNOPSIS
One line: what this does.

.DESCRIPTION
What it does, and any decision a maintainer would otherwise have to infer.

.PARAMETER Path
One entry per parameter.

.EXAMPLE
pwsh -File tools/do-thing.ps1 -Path src

.NOTES
Exits:
    0 - success
    1 - the thing this script checks failed
    2 - could not run (missing dependency or unreadable config)
#>

#requires -Version 7

[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Path,
    [switch]$WhatIfOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# --- Constants ---
$ScriptRoot = $PSScriptRoot

# --- Helpers ---
function Get-Thing {
    param([string]$From)
    # ...
}

# ---------------------------------------------------------------------------
# Driver
#
# Dot-sourcing this file loads the helpers above and stops here WITHOUT running
# the driver, so tests can drive the shipped functions rather than a copy.
# ---------------------------------------------------------------------------
if ($MyInvocation.InvocationName -eq '.') { return }

# ... driver body ...
exit 0
```

Rules:

- The **comment-based help block MUST come first**, before `#requires`. A `#requires` statement placed above the help block silently detaches it, and `Get-Help` then reports nothing. Nothing warns you.
- Inside the help block, a line **MUST NOT** begin with a `.Word` token unless it is a real help keyword. `.NET` at the start of a line is parsed as an unknown section and truncates the help.
- The documented exit codes **MUST live in a `.NOTES` section** of a `<# #>` help block, not merely "somewhere in the header". Text appended after a `.PARAMETER` belongs to *that parameter's* description, and text after `.OUTPUTS` belongs to the outputs — so an exit contract added at the end of a help block routinely ends up documenting the last parameter instead. Nothing in the file shows this; only `Get-Help` does. In a script whose header is a plain `#` comment run rather than a help block, the equivalent is an `# Exits:` block inside that run. See [`script-contract.md`](script-contract.md) §2.
- `#requires -Version` **MUST** state the minimum the script actually needs. See [§4](#4-versions-and-platforms).


---

## 2. Strict Mode and Error Preference

Every script and module **MUST** set both:

```powershell
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
```

`Set-StrictMode -Version Latest` turns a reference to an uninitialized variable, a non-existent property, and an invalid method call into visible errors. Without it, a typo in a property name yields `$null` and the script carries on with a hole in its data. This is the single most common way a repository script does the wrong thing quietly: a payload accessor reading a field that was renamed returns `$null`, the guard that depends on it sees nothing to object to, and the operation proceeds.

`$ErrorActionPreference = 'Stop'` makes a cmdlet error terminate rather than emit to the error stream and continue. Continuing past a failed `Get-Content` means operating on nothing.

**Adding strict mode to an existing script is not a mechanical change.** It surfaces faults in code that currently appears to work, which is the point, but it means the edit needs the same care as a behavior change. Scripts **MUST** be brought into strict mode **one file at a time, together with that file's tests**. A repository **MUST NOT** sweep strict mode across many files in one change — the sweep will appear to work and will have moved latent faults into a release.

A script **MAY** opt out, and a few genuinely should. One that reads loosely-shaped external data with optional fields, and is deliberately fail-open, will throw on an absent optional property under strict mode — and if its own `catch` then swallows that, the feature stops working silently instead of failing loudly. Strict mode is the right default precisely because it converts silence into noise, so the cases where silence is the requirement are the cases to exempt. An opt-out **MUST** be stated in the file, with its reason, so the next reader finds a decision rather than an omission and a remediation pass skips it deliberately rather than breaking it.

A repository **MAY** track its remaining non-compliant files as a **ratchet**: a recorded count that a new script cannot increase, lowered as files are brought into line. A ratchet is a mechanism; a plan to fix it later is not. Counting a documented opt-out as a violation makes the ratchet lie, so exempt files **SHOULD** be excluded from the count rather than carried in it forever.

Strict mode also catches a read of `$LASTEXITCODE` (or any other automatic variable) before anything in the current scope has set it — and a native command that signals success simply by exiting cleanly, with no explicit success path of its own, may never touch it at all. Reset it immediately before the call: `$global:LASTEXITCODE = $null`. The scope matters: a bare `$LASTEXITCODE = $null` inside a function creates a same-named **local** variable that shadows the real automatic one, so a command that genuinely fails afterward reads back that local `$null` instead of its own exit code, silently swallowing the failure.

---

## 3. Parameters and Empty Input

> Working-directory independence is not a PowerShell concern; it sits in [`script-contract.md`](script-contract.md) §1, which `$PSScriptRoot` anchors.

### 3.1 Say so when empty is legal

`[Parameter(Mandatory)]` on a `[string]` rejects `''`. On a collection type it rejects an empty collection. Both are rejected as a **binding exception, before the function body runs**, so no guard inside the function can soften it and no `try` inside it can catch it.

Where empty is a value the parameter should accept, the script **MUST** say so:

```powershell
param(
    [Parameter(Mandatory)][AllowEmptyString()][string]$Line,
    [Parameter(Mandatory)][AllowEmptyCollection()][string[]]$Files
)
```

This one cause has produced more defects than any other item in this guide. The most costly shape: a helper that wrote captured output refused the empty final line that any tool's trailing newline produces, so a **failing build reported the wrong exit code and the failure was never surfaced at all**.

### 3.2 Collections unroll on the way out

PowerShell unrolls a returned collection. One element comes back bare, none comes back `$null`, and only two or more come back as an array. A caller written against the many-case breaks on nought and one.

Returning:

```powershell
return ,$results      # comma operator prevents unrolling
```

Calling:

```powershell
$items = @(Get-Thing -From $x)   # array subexpression normalizes the result
```

Functions returning collections **MUST** use exactly **one** of these. **They do not compose.** The comma stops the unroll, and `@(...)` then wraps the intact collection in a one-element array, so `.Count` reports `1` however many items there are. Measured under strict mode:

| return style | used directly | wrapped in `@()` |
|---|---|---|
| `return $collection` | **throws** at nought and one | correct at nought, one, many |
| `return ,$collection` | correct at nought, one, many | **wrong — always `1`** |

Prefer `@(...)` at the call site when the function has more than one `return`, since it covers all of them without each having to remember the comma.

Wrapping the **return value itself** in `@(...)` is not a substitute for this. A function that does `return @($collection)` still hands its caller a bare element or `$null` if the caller captures it without wrapping — the unroll happens again at the assignment, regardless of what the callee returned. The `@(...)` that matters is always the one at the call site.

Tests for such a function **MUST** cover **nought, one, and many**. A suite that covers only many passes over both real failures, and one that adds a single-item case still misses nought — which is the case that silently returns `$null` rather than throwing.

### 3.3 Hashtable keys that are not always present

Dot access on a hashtable throws under strict mode when the key is **absent**, but not when the key is present with a `$null` or empty value — the two look identical at the point where a script reads them, and only one throws. A hashtable literal built along several branches, where one branch's shape omits a key that another branch includes, has this problem the moment something reads that key unconditionally.

Use the indexer (`$table['key']`, which returns `$null` for a missing key rather than throwing) at any read that cannot otherwise prove the key is always there. Prefer making every branch include every key — with an explicit `$null` or empty value where a branch has nothing to report — over indexing everywhere; a shape that is genuinely optional is a design decision, and one call site quietly working around a hole that a sibling call site correctly guards against is more often an oversight than an intentional exception.

### 3.4 `$null` does not become an empty array

A scalar argument bound to a typed array parameter (`[string[]]$Files`) auto-wraps into a one-element array — this is why a single string can be passed where a function expects a list. `$null` does **not** get the same treatment: it binds as a literal `$null`, not `@()`. A function that reads `.Count` or `.Length` on that parameter without checking for `$null` first throws the instant a caller passes one through — including a caller that just collapsed an empty collection on its own return, per §3.2.

---

## 4. Versions and Platforms

State the minimum version and mean it. `#requires -Version 7` fails fast with a clear message; discovering the requirement through a syntax error inside a hook does not.

Where a script **must** run under Windows PowerShell 5.1 — a CI agent's default shell, a scheduled task, a machine-provisioning extension that does not relaunch into `pwsh` — then:

- It **MUST** be ASCII-only. Use `[OK]`, not a check mark; straight quotes, not typographic ones.
- It **MUST NOT** use PowerShell 7 syntax: null-coalescing (`??`, `??=`), the ternary operator, `-Parallel`, or `Get-Error`.
- It **SHOULD** carry `# PSv5.1-compatible.` in the header, so the constraint is visible to the next editor.

Scripts requiring PowerShell 7 **MAY** use its syntax and Unicode freely. Do not impose 5.1 constraints on files that have no 5.1 caller — the cost is real and the benefit imaginary.

Prefer `Join-Path` and `[System.IO.Path]::DirectorySeparatorChar` over literal separators in anything that may run on more than one platform.


---

## 5. Checklist

This list covers the PowerShell layer only. The contract's own checklist is at [`script-contract.md`](script-contract.md) §8, and both apply.

- [ ] Help block first, `#requires` after it, exit codes in a `.NOTES` section
- [ ] No help-block line starts with a `.Word` that is not a real help keyword
- [ ] `Set-StrictMode -Version Latest` and `$ErrorActionPreference = 'Stop'`
- [ ] Strict mode adopted one file at a time, together with that file's tests
- [ ] Any strict-mode opt-out states its reason in the file and is excluded from the ratchet
- [ ] `AllowEmptyString` / `AllowEmptyCollection` wherever empty is legal
- [ ] Collection returns use `,$x` **or** call sites use `@(...)`, never both
- [ ] Every capture site wraps in `@(...)` too — a callee-side wrap alone does not survive the caller's assignment
- [ ] Tests for a collection-returning function cover nought, one, and many
- [ ] Hashtable reads use the indexer, not dot access, wherever a key can be genuinely absent
- [ ] A typed array parameter is checked for `$null` before `.Count`/`.Length`, since a `$null` argument does not coerce to an empty array
- [ ] An automatic variable read after invoking a native command (e.g. `$LASTEXITCODE`) is reset to a known value, at its own scope, immediately beforehand
- [ ] `#requires -Version` matches what the script actually needs
- [ ] A 5.1-compatible script is ASCII-only, free of PS7 syntax, and says so in its header
- [ ] `Join-Path` rather than literal separators in anything cross-platform

---

## Glossary

Terms shared with the contract — driver, seam, fail closed, ratchet, differential test, reparse point, the CWE identifiers, TOCTOU — are defined in [`script-contract.md`](script-contract.md#glossary). PowerShell-specific terms:

| Term | Definition |
|---|---|
| **Dot-source** | Running a file with `.` so its definitions land in the caller's scope instead of a child scope. How a test reaches a script's functions. |
| **Seam (PowerShell form)** | The `if ($MyInvocation.InvocationName -eq '.') { return }` line that lets a file be dot-sourced for its functions without running its driver. |
| **Strict mode** | `Set-StrictMode -Version Latest`, which turns uninitialized variables, absent properties, and invalid method calls into errors rather than `$null`. |
