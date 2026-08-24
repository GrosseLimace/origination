# Script Contract

> **Purpose:** This guide defines the contract every **script that lives in a repository** owes its caller, whatever language it is written in — build and release tooling, repo automation, git hooks, CI steps, environment setup, and the small utilities that accumulate around an application. It covers working-directory independence, exit codes and diagnostics, the testability seam, shared-code ownership, guards, path safety, and invoking external tools.
>
> **This guide is language-neutral. Language layers sit on top of it**, carrying the syntax and the mechanisms: [`powershell.md`](powershell.md) today, others as they are written. Where a rule below needs a language-specific idiom, the layer supplies it.
>
> **What this guide is NOT.** It is not a guide to any language as an interactive shell — an ad-hoc command at a prompt answers to nobody and needs none of this. It is not an application coding standard; for the application itself see [`csharp.md`](csharp.md) and [`angular.md`](angular.md). It does not cover how to test, which is [`automated-testing.md`](automated-testing.md), though several rules here exist purely to make testing possible and say so.

Normative keywords — **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, **MAY** — follow [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119). A definition for every term of art appears on first use and again in the [Glossary](#glossary).

**Why this guide exists.** Repository scripts tend to be written one at a time, by whoever needed one, and each is reasonable on its own. The cost shows up later: no two are shaped alike, so nothing can be tested the same way twice, and a defect found in one file teaches you nothing about the other twenty. Every rule below is here because a specific defect was found and traced to its absence. The rules are ordinary; the consistency is the point.

**Why it is not named after a language.** These rules were written from PowerShell defects, and then found unchanged in this repo's Python. Two ports of one tool held to different standards because of their file extensions is how that class of defect survives. The examples below remain PowerShell, because that is where they were measured; the rules are not.

`tools/lint-script-contract.ps1` enforces the mechanical subset.

---

## 1. Do Not Depend on the Caller's Working Directory

A script **MUST NOT** resolve its own resources relative to the current directory. A user profile that runs `Set-Location` on launch, a hook invoked from an arbitrary directory, or a CI step with a different default all move it. Anchor on `$PSScriptRoot`:

```powershell
$repoRoot = Split-Path -Parent $PSScriptRoot
$config = Join-Path $repoRoot 'config/settings.json'
```

Where a script genuinely operates on "the repository I was invoked in", that **MUST** be an explicit parameter with a documented default, not an implicit `.`.


---

## 2. Exit Codes and Diagnostics

### 2.1 Every code means one documented thing

A script's exit code is its API. Codes **MUST** be chosen up front, **MUST** be documented where the language layer requires (for PowerShell, [`powershell.md`](powershell.md) §1) — placement decides whether anyone actually reads them — and **MUST NOT** overlap in meaning. The default set:

| Code | Meaning |
|---|---|
| `0` | Success, including "nothing to do" |
| `1` | The thing this script checks failed — violations found, validation rejected |
| `2` | Could not run — missing dependency, unreadable configuration, unsupported platform |

Reserving `2` for "could not run" is what separates *a broken tool* from *a failing change*. Without it, a gate-shaped script that cannot load its own rules reports the same thing as a script that found a genuine violation, and the pipeline treats a broken tool as a real finding.

**Where the caller defines the codes, the script does not get to choose them.** Git hooks, CI task runners, pre-commit frameworks and editor hooks each assign their own meanings, often to a smaller set than the table above. A script in that position **MUST** document that it is following the caller's protocol rather than this default, and **MUST NOT** invent a third code the caller will not interpret. Two consequences are worth writing down where they apply:

- If the protocol has no "could not run" value, the script cannot signal its own failure — dying, timing out, or being cancelled will read as success. Anything security-relevant in that position needs its timeout and its failure modes treated as part of the control, because a guard that cannot report a malfunction is a guard that fails open.
- If the script wraps another that has a richer set, the mapping **MUST** be stated. Collapsing a runner's `1` and `2` onto a single value the caller understands is legitimate; leaving it undocumented makes it look like a mismatch with the wrapped script's own contract.

### 2.2 An exception is never one of them

A raw exception **MUST NOT** escape as a documented exit code. This is the failure mode the previous rule exists to prevent, and it is easy to reintroduce: an unhandled throw in a script whose `1` means "violations found" reports a crash as a finding, indistinguishable from the real thing.

The driver **MUST** therefore be wrapped, mapping anything unexpected onto the "could not run" code:

```powershell
try {
    $findings = Invoke-Check -Path $Path
    if ($findings.Count -gt 0) { exit 1 }
    exit 0
} catch {
    [Console]::Error.WriteLine("ERROR: $($_.Exception.Message)")
    exit 2
}
```

Because this is a property of structure rather than of text, no linter finds it. It **MUST** be covered by the script's own tests.

### 2.3 Diagnostics go to stderr, data goes to stdout

Machine-readable output **MUST** go to stdout and nothing else may. Diagnostics — progress, warnings, rejections — **MUST** go to stderr:

```powershell
[Console]::Error.WriteLine('INFO: nothing to update')
Write-Output $payload    # stdout: the only thing a caller parses
```

`Write-Host` writes to the information stream and **MUST NOT** be used for data a caller reads. A caller that pipes stdout gets a clean payload only if diagnostics went elsewhere.

### 2.4 Printed strings are ASCII

A string the script **prints** **MUST** be ASCII. Comments and documentation need not be: they are never written to a stream, so they cannot mangle.

The console encoding decides how a child process's output decodes when something captures it, and at a legacy code page (cp437 is a real Windows default) characters such as an em dash map to a plain hyphen on the way through. Anything matching on that output, a test or a downstream parser, sees a different string than the source contains, and so does a developer on that console.

Scope the rule to what is emitted. A sweep that treats every non-ASCII character in a file as a defect will report mostly comments and bury the few that matter.

### 2.5 A rejection is either fatal or a skip, and which one follows from what the script does

This is the choice most often made twice in the same repository, differently. Fix it by tying it to the script's contract rather than to taste:

- A script that **only reads** and produces advisory output **MAY** treat a rejected input as a skip: emit a `NOTE:` and exit `0`. Its caller loses information, not correctness.
- A script that **writes, deletes, or gates** **MUST** treat a rejected input as fatal: emit an `ERROR:` and exit non-zero. Staying quiet here presents a refused operation as a completed one.

Whichever applies, the script's header **MUST** say so, and the message prefix (`NOTE:`, `INFO:`, `ERROR:`) **MUST** match the severity of what actually happened.


---

## 3. The Testability Seam

A script with a driver body **MUST** carry a seam immediately before that driver:

```powershell
if ($MyInvocation.InvocationName -eq '.') { return }
```

Dot-sourced, the file stops there and exposes its functions to the caller. Invoked as a script or through the call operator, `InvocationName` is the path or `&` rather than `.`, so behavior is unchanged.

Without a seam, a test that dot-sources the file **runs the script** — and since most of these call `exit`, that terminates the test host. The alternative, copying the functions into the test, tests the copy and not the shipped code.

Two things about seams are easy to get wrong, and both have caused a suite to test nothing:

**Everything above the seam still runs when the file is dot-sourced.** The seam stops the statements after it, not before it. A guard above the seam that calls `exit` means no function is ever defined and the host dies on import. Any statement that can exit, prompt, write, or import a module that might be absent **MUST** be below the seam. If moving it there is a real refactor, that is the work — a seam placed above such a guard is decorative.

**Verify dot-sourceability by running it, not by reading it.** Whether a script exposes its functions on import is a runtime property. Reading the file will tell you the wrong answer in both directions: guards that look fatal often bind their arguments and fall through harmlessly, and a file that reads cleanly can still die on a module import.

Because a linter can only match the seam's *text* and never its *position*, a refactor that moves a helper below the seam turns that file's suite into a silent no-op that still reports green. Repositories **SHOULD** therefore carry one generic test that discovers every seamed script from the tree and asserts each still exposes its functions, so a newly seamed script is covered as soon as it lands.


---

## 4. Shared Code Has One Owner

When several scripts need the same helper, it **MUST** live in one place and be imported:

```powershell
. "$PSScriptRoot\_common.ps1"          # dot-source a shared script
Import-Module "$PSScriptRoot\Thing.psm1"   # or a module
```

**A comment saying "keep these in sync" is not a mechanism.** It records an intention and delegates the work to whoever happens to notice. Copies drift, and they drift in the way that is hardest to catch: the same function name with different parameters, so a caller written against one copy is wrong against another and the mistake looks like a typo.

Where the platform genuinely forces copies — script directories that cannot see a common path, a distribution format that must stay self-contained — then all of the following **MUST** hold:

1. One copy is the **owner**, named as such in every other copy's header.
2. Copies are **signature-identical**. Same function name means same parameters and same return shape, without exception. Two helpers that take different arguments **MUST** have different names.
3. The copies are covered by a **differential test** that drives every copy from one corpus and requires identical output, so drift fails a test rather than waiting to be noticed.

Point 3 has a limit worth stating: **a differential test finds drift and never a shared defect.** Two copies that are wrong in the same way agree perfectly. Behavioral tests are still required; the differential test only protects the invariant that the copies are the same.

Where duplication is not forced, it **MUST** be collapsed. Two near-identical modules in a repository are not redundancy, they are two places for a fix to be needed and one place for it to be forgotten.


---

## 5. Guards Must Stop Things

A run of security findings in one body of scripts kept returning to a single shape: **a guard that ran, reported, and then did not stop anything.** The check was present, its message was accurate, and the operation proceeded regardless. Reviewers read the guard and believed it.

The rules that prevent this shape:

**A guard MUST stop the operation it guards, in the same control flow.** Detecting a bad value and continuing is not a guard, it is a log line.

**Know what your control-flow keyword exits.** `continue` and `break` inside a `switch` leave **the switch**, not the enclosing loop. A validation loop shaped like this rejects every unsafe value and then exports all of them:

```powershell
foreach ($item in $items) {
    switch ($item.Kind) {
        'path' {
            if (-not (Test-Safe $item)) {
                Write-Warning "rejected: $($item.Name)"
                continue          # leaves the SWITCH. The foreach body carries on.
            }
        }
    }
    Export-Item $item             # reached even for a rejected item
}
```

Use a flag, a `return` from a helper, or restructure so the rejection cannot fall through.

**Validate the value that flows, not a different representation of it.** A check on the absolute path proves nothing about the relative path the rest of the script actually uses. Where a value is transformed after validation, the transformed value is what reaches the sink and what **MUST** be validated.

**Re-validate at the point of no return.** An up-front check plus a subprocess call plus a parse is a window in which the world can change. Any irreversible operation — a delete, an overwrite, a push — **MUST** re-check immediately before it acts, even when that looks redundant.

**Fail closed.** A guard that cannot determine whether input is safe **MUST** treat it as unsafe. Every `catch` in a validation helper returns "no".

**Assert which guard fired.** When layered guards produce the same visible outcome, a test asserting that outcome cannot tell you *which* one produced it — so the guard you meant to test can be deleted outright and the test stays green. Tests **MUST** assert the specific message, exact value, or boundary that only the guard under test can produce. See [`automated-testing.md`](automated-testing.md).

### 5.1 A sanitiser is not a guard

Where output crosses into something that *parses* it — a CI agent reading logging commands out of a build log, a shell, a template — rejecting the value is usually wrong. You still have to emit it. So the rule above inverts: a sanitiser **neutralises and lets the value through**, and it has its own failure modes.

**Sanitise inside the writer, never at the call site.** One function emits, so one function sanitises. Applied per call site, a sanitiser is correct only for the call sites that exist today, and the next one is written by someone who does not know the rule exists.

**Enumerate every writer, and let a test hold the list.** This is where sanitising actually goes wrong. A file gets one obvious writer hardened and its quieter sibling missed — the marker emitter but not the progress line, the report but not the captured tool output. Each miss looks like a different bug and is the same bug. A test that walks the source for every write and requires each one to either sanitise or appear in a documented allowlist is worth more than another test of the sanitiser itself, because **a sanitiser with full unit coverage tells you nothing about which writers call it.**

**A prefix guards only the line it is on.** The commonest version of the miss:

```powershell
function Write-Info {
    param([string]$Message)
    Write-Output "[gate] $Message"   # a CR or LF in $Message starts a NEW line,
}                                    # and the prefix is not on that one
```

Anything an agent recognises at the start of a line is reachable through any value containing a line break. For single-line output, fold the breaks. For **multi-line** output where the structure is the diagnostic — a build log, a lint report — folding destroys the thing a developer needs to read, so prefix **every** line instead.

**Prefer a non-whitespace prefix.** Indenting each line reads more nicely and only works if the consumer requires its marker at column 0 rather than at the first non-space character. That is a property of someone else's parser, so do not bet on it.

**Split on line boundaries, not on `` `n ``.** A lone CR is a line break to a terminal and to most log consumers. A tool that draws progress with carriage returns will otherwise smuggle a line start straight through.

**Say why, where a writer is deliberately left raw.** There will be one — a bootstrap that runs before the sanitiser is defined, a value that provably never crosses a trust boundary. Record the reason at the site and in the allowlist the test reads. "Every writer is sanitised except the ones that are not" is how the missed sibling survives review.


---

## 6. Path Safety

Scripts that read, write, or delete paths derived from repository content or user input **MUST** contain those paths. This is [CWE-22](https://cwe.mitre.org/data/definitions/22.html) (path traversal) and [CWE-59](https://cwe.mitre.org/data/definitions/59.html) (link following); see [`security.md`](security.md) for the broader policy.

**Reject rooted paths and parent references.** A relative path is relative:

```powershell
if ([System.IO.Path]::IsPathRooted($RelPath)) { return $false }
if ($RelPath -match '(^|[\\/])\.\.([\\/]|$)') { return $false }
```

Match `..` as a whole path component. A file legitimately named `a..b` is not traversal.

**Normalize without touching the filesystem.** `[System.IO.Path]::GetFullPath` collapses a path as a string. `Resolve-Path` consults the disk and reports a path whose parent is a symlink or junction as perfectly ordinary — it is not a containment check and **MUST NOT** be used as one.

**Walk the chain for reparse points.** Textual containment is not enough: a path can sit inside the repository and still resolve outside it through a committed symlink, junction, or mount point. Walk every existing component from the target up to the root and reject any that carries the reparse-point attribute. `Get-Item -Force` returns the link itself rather than following it, so its `Attributes` expose the bit.

**Do not decode a path through a URI round trip.** `System.Uri` normalizes percent-escapes while parsing, and `UnescapeDataString` cannot tell an escape the URI layer added from one that was a literal character in the filename. A directory named `%2e%2e` survives that round trip as `..`. Use string arithmetic on the two absolute paths instead.

**Check before reading, not only before writing.** A link aimed out of the repository leaks the contents of whatever it points at into whatever the script does next. Validate before the read as well.

**Validate the value you will actually use.** Containment applies to a string, not to a file. A guard that resolves `<root>/<relative>`, proves that lands inside the repository, and then hands the raw *relative* path to a tool has validated one path and used another: the tool resolves it against the process working directory, which is section 1's problem arriving by a different route. Absolutize once, pass the absolute path onward, and convert back to a repository-relative form only where a human or an annotation needs to read it.

**Say which form a path parameter takes.** A parameter named for one form that accepts both is a trap for the next caller. If a containment helper takes either an absolute or a repository-relative path, its contract **MUST** say so, and say what a relative one is resolved against, because that is what decides whether the caller's root argument and the resolution agree.


---

## 7. Invoking External Tools

An executable **MUST NOT** be invoked by bare name:

```powershell
# WRONG
& pwsh -File thing.ps1
& dotnet build

# RIGHT
$pwshExe = (Get-Command 'pwsh' -CommandType Application -ErrorAction Stop).Source
& $pwshExe -File thing.ps1
```

On Windows, `CreateProcess` searches the working directory before the trusted system paths. Repository scripts run with a checked-out repository as their working directory, so a planted `pwsh.exe` or `dotnet.exe` in that repository wins the lookup. This is [CWE-426](https://cwe.mitre.org/data/definitions/426.html), untrusted search path.

Resolve the tool once, near the top, and fail with the "could not run" code if it is absent. A script that needs a tool it cannot find has not found violations.

Where a script executes anything the repository itself supplies — a formatter from `node_modules`, a project-local script — that execution **MUST** be gated on a trust decision recorded **outside** the repository, in per-user configuration. A repository **MUST NOT** be able to flip the switch that authorizes running its own contents.


---

## 8. Checklist

Before opening a pull request that adds or changes a repository script, in any language:

- [ ] Nothing resolves against the caller's working directory
- [ ] Every exit code means one documented thing; `2` reserved for "could not run"
- [ ] The driver is wrapped so an exception cannot escape as a finding
- [ ] Diagnostics on stderr, machine-readable output on stdout and nothing else
- [ ] Every printed string is ASCII; non-ASCII confined to comments
- [ ] A rejection is fatal or a skip according to what the script does, and the header says which
- [ ] A seam sits immediately before the driver, with nothing exitable above it
- [ ] Loadability verified by running it, not by reading it
- [ ] No copied helper without an owner, identical signatures, and a differential test
- [ ] Every guard stops the operation it guards, and the tests assert which guard fired
- [ ] Output sinks sanitise inside the writer, every writer is enumerated by a test, and any deliberately raw one says why
- [ ] Paths validated as the representation that actually flows, re-checked before irreversible acts
- [ ] External tools resolved, never invoked by bare name

The language layer adds its own items; see [`powershell.md`](powershell.md) §5.

---

## Glossary

| Term | Definition |
|---|---|
| **Driver** | The executable body of a script — everything that runs when it is invoked, as distinct from the functions it defines. |
| **Seam** | The point in a script where loading it for its definitions stops and running it as a program continues. |
| **Ratchet** | A recorded count of known violations that a change may lower but never raise. |
| **Reparse point** | The filesystem attribute behind symlinks, junctions, and mount points. A path containing one can resolve outside the tree it appears to be in. |
| **Differential test** | A test driving two or more implementations from one corpus and requiring identical output, so copies cannot drift apart. |
| **Fail closed** | Treating an indeterminate safety check as a failure. The opposite, fail open, is what makes a broken guard invisible. |
| **CWE-22** | Path traversal — reaching a file outside an intended directory. |
| **CWE-59** | Link following — reaching an unintended file through a symlink or junction. |
| **CWE-426** | Untrusted search path — executing an attacker-supplied binary found before the intended one. |
| **TOCTOU** | Time-of-check to time-of-use. The window between validating something and acting on it, in which it can change. |
