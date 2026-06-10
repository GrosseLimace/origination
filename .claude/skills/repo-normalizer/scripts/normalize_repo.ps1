# Normalize a repo to AGENTS.md-canonical, CLAUDE.md-as-shim layout.
#
# Three responsibilities:
#   1. Instructions: AGENTS.md becomes the canonical cross-vendor instruction file.
#      CLAUDE.md is reduced to a thin shim plus a small set of Claude-Code-only sections.
#   2. Docs tree: legacy claude-docs/ migrates to agents-docs/.
#   3. Skills tree placement: .claude/skills/ is the canonical git-tracked tree. If
#      only .codex/skills/ or .gemini/skills/ exists, move the newest into .claude/skills/.
#      Multi-agent fan-out is delegated to /sync-multiagent-skills.
#
# PSv5.1-compatible (works on PowerShell 5.1 and 7.x). Avoid v7-only syntax:
# no &&/||, no ternary, no null-coalescing.

[CmdletBinding(DefaultParameterSetName = 'DryRun')]
param(
    [Parameter(ParameterSetName = 'DryRun')] [switch]$DryRun,
    [Parameter(ParameterSetName = 'Apply')]  [switch]$Apply,
    [ValidateSet('agents', 'claude', 'newest')] [string]$Prefer = 'agents',
    [switch]$GitignoreMultiagent,
    [string]$ClaudeOnlyHeadings = ''
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$Script:DryRun = -not $Apply

# =============================================================================
# Constants
# =============================================================================

$Script:DocsDirName = 'agents-docs'
$Script:LegacyDocsDirName = 'claude-docs'
$Script:ReportRel = 'agents-docs/plans/agent-migration-report.md'
$Script:MergedCandidate = 'AGENTS.merged.candidate.md'

$Script:DefaultClaudeOnlyHeadings = @(
    'Claude-Specific Notes',
    'Claude Code Hooks',
    'MCP Servers',
    'Subagents',
    'Allowed Paths'
)

$Script:GitignoreMultiagentPatterns = @(
    '.codex/skills/',
    '.gemini/skills/',
    '.claude/skills/.sync-log'
)
$Script:GitignoreMultiagentHeader = '# /sync-multiagent-skills design-C: fan-out copies and audit log'

$Script:AgentsPreface = @'
# AGENTS.md

This file is the canonical shared instruction set for agents working in this repository.

## Agent Model

- `AGENTS.md` holds repo-wide rules, commands, architecture notes, and workflow guidance shared across tools (Claude Code, Codex CLI, Gemini CLI).
- `CLAUDE.md` is a thin shim that points to this file and only keeps Claude-Code-specific notes (hooks, MCP, subagents, settings.json permissions).
- Skill bundles live under `.claude/skills/` (canonical, git-tracked) and are fanned out to `.codex/skills/` and `.gemini/skills/` by `/sync-multiagent-skills`.
- If both agent files existed before normalization, review `AGENTS.merged.candidate.md` when the migration report says conflicts were preserved.
'@

$Script:ClaudeShim = @'
# CLAUDE.md

## Canonical Project Instructions

See `AGENTS.md` for the shared project rules, commands, architecture notes, and workflows. AGENTS.md is the canonical cross-vendor instruction file (Linux Foundation Agentic AI Foundation; Anthropic + OpenAI + Block, Dec 2025) and applies to Claude Code, Codex CLI, and Gemini CLI alike.

## Claude-Specific Notes

- Keep this file minimal.
- Document Claude-Code-only items here: hooks (`.claude/settings.json`), MCP servers, subagents, allowed-paths permissions.
- Custom skills (slash commands), session management, project context, and audit tracking belong in `AGENTS.md` because they apply to all three vendors via `/sync-multiagent-skills`.
'@

# =============================================================================
# State accumulators
# =============================================================================

$Script:Actions = New-Object 'System.Collections.Generic.List[string]'
$Script:Notes = New-Object 'System.Collections.Generic.List[string]'
$Script:Conflicts = New-Object 'System.Collections.Generic.List[string]'

function Add-Action { param([string]$Msg) [void]$Script:Actions.Add($Msg) }
function Add-Note   { param([string]$Msg) [void]$Script:Notes.Add($Msg) }
function Add-Conflict { param([string]$Msg) [void]$Script:Conflicts.Add($Msg) }

# =============================================================================
# Helpers
# =============================================================================

function Find-GitRoot {
    param([string]$Start = (Get-Location).Path)
    $code = & git -C $Start rev-parse --show-toplevel 2>$null
    if ($LASTEXITCODE -eq 0 -and $code) { return (Resolve-Path $code).Path }
    $cur = (Resolve-Path $Start).Path
    while ($cur) {
        if (Test-Path (Join-Path $cur '.git')) { return $cur }
        $parent = Split-Path -Parent $cur
        if ($parent -eq $cur) { break }
        $cur = $parent
    }
    return $Start
}

function Read-FileText {
    param([Parameter(Mandatory)][string]$Path)
    return [System.IO.File]::ReadAllText($Path, [System.Text.UTF8Encoding]::new($false))
}

function Write-FileText {
    param([Parameter(Mandatory)][string]$Path, [Parameter(Mandatory)][string]$Content)
    $parent = Split-Path -Parent $Path
    if ($parent -and -not (Test-Path $parent)) {
        New-Item -ItemType Directory -Force -Path $parent | Out-Null
    }
    [System.IO.File]::WriteAllText($Path, $Content, [System.Text.UTF8Encoding]::new($false))
}

function Test-FileNonEmpty {
    param([string]$Path)
    if (-not $Path) { return $false }
    if (-not (Test-Path $Path -PathType Leaf)) { return $false }
    try { return (Get-Item $Path).Length -gt 0 } catch { return $false }
}

function Format-NormalizedText {
    param([string]$Text)
    if ($null -eq $Text) { return "`n" }
    $t = $Text -replace "`r`n", "`n"
    # Collapse 3+ newlines to 2
    while ($t -match "`n`n`n") { $t = $t -replace "`n`n`n", "`n`n" }
    return $t.Trim() + "`n"
}

function Backup-FileToDir {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][string]$DestDir,
        [string]$Suffix = 'legacy'
    )
    $ts = (Get-Date).ToString('yyyyMMdd-HHmmss')
    $backup = Join-Path $DestDir ("{0}.{1}.{2}" -f (Split-Path -Leaf $Path), $Suffix, $ts)
    Add-Action "BACKUP: $Path -> $backup"
    if (-not $Script:DryRun) {
        if (-not (Test-Path $DestDir)) {
            New-Item -ItemType Directory -Force -Path $DestDir | Out-Null
        }
        Copy-Item -LiteralPath $Path -Destination $backup -Force
    }
    return $backup
}

function Move-PathSafe {
    param([Parameter(Mandatory)][string]$Source, [Parameter(Mandatory)][string]$Destination)
    Add-Action "MOVE: $Source -> $Destination"
    if ($Script:DryRun) { return }
    $destParent = Split-Path -Parent $Destination
    if ($destParent -and -not (Test-Path $destParent)) {
        New-Item -ItemType Directory -Force -Path $destParent | Out-Null
    }
    try {
        Move-Item -LiteralPath $Source -Destination $Destination -Force -ErrorAction Stop
    } catch {
        # Windows OneDrive paths or scripts inside src can break Move-Item's
        # internal delete step. Fall back to Copy + native Remove-Item with
        # -LiteralPath to avoid shell-parsing the source path (the prior
        # `cmd /c rd /s /q $Source` form would interpret &|;^ in the path
        # as command separators - CVE pattern flagged by security scanner
        # on IT/market-data#250).
        if (-not (Test-Path $Destination)) {
            Copy-Item -LiteralPath $Source -Destination $Destination -Recurse -Force
        }
        Remove-Item -LiteralPath $Source -Recurse -Force -ErrorAction SilentlyContinue
    }
}

function New-DirIfMissing {
    param([Parameter(Mandatory)][string]$Path)
    if (Test-Path $Path) { return }
    Add-Action "MKDIR: $Path"
    if (-not $Script:DryRun) {
        New-Item -ItemType Directory -Force -Path $Path | Out-Null
    }
}

# =============================================================================
# Markdown section parsing
# =============================================================================

function Get-MarkdownSections {
    # Returns an ordered list of @{ Heading = '...'; Body = '...' }.
    # Pre-H2 content (preface) gets Heading = '__preface__'.
    param([Parameter(Mandatory)][string]$Text)
    $lines = (Format-NormalizedText $Text) -split "`n"
    $sections = New-Object 'System.Collections.Generic.List[hashtable]'
    $preface = New-Object 'System.Collections.Generic.List[string]'
    $currentHeading = $null
    $currentLines = New-Object 'System.Collections.Generic.List[string]'

    foreach ($line in $lines) {
        if ($line -match '^## (.+)$') {
            if ($null -eq $currentHeading) {
                if ($preface.Count -gt 0) {
                    $sections.Add(@{ Heading = '__preface__'; Body = ($preface -join "`n").Trim() + "`n" })
                }
            } else {
                $sections.Add(@{ Heading = $currentHeading; Body = ($currentLines -join "`n").Trim() + "`n" })
            }
            $currentHeading = $matches[1].Trim()
            $currentLines = New-Object 'System.Collections.Generic.List[string]'
            [void]$currentLines.Add($line)
            continue
        }
        if ($null -eq $currentHeading) {
            [void]$preface.Add($line)
        } else {
            [void]$currentLines.Add($line)
        }
    }

    if ($null -eq $currentHeading) {
        if ($preface.Count -gt 0) {
            $sections.Add(@{ Heading = '__preface__'; Body = ($preface -join "`n").Trim() + "`n" })
        }
    } else {
        $sections.Add(@{ Heading = $currentHeading; Body = ($currentLines -join "`n").Trim() + "`n" })
    }

    return $sections
}

function Split-ClaudeSections {
    # Returns @{ Shared = '...'; ClaudeOnly = '...' } based on heading membership.
    param([Parameter(Mandatory)][string]$ClaudeText, [Parameter(Mandatory)][string[]]$ClaudeOnly)
    $shared = New-Object 'System.Collections.Generic.List[string]'
    $only = New-Object 'System.Collections.Generic.List[string]'
    foreach ($s in (Get-MarkdownSections -Text $ClaudeText)) {
        if ($s.Heading -eq '__preface__') { continue }
        if ($ClaudeOnly -contains $s.Heading) {
            [void]$only.Add($s.Body)
        } else {
            [void]$shared.Add($s.Body)
        }
    }
    return @{
        Shared = ($shared -join "`n`n").Trim()
        ClaudeOnly = ($only -join "`n`n").Trim()
    }
}

function Merge-AgentSections {
    # Merge AGENTS.md and shared CLAUDE sections. Records conflicts.
    param(
        [string]$AgentsText,
        [string]$ClaudeShared,
        [string]$Prefer
    )
    $merged = New-Object 'System.Collections.Generic.List[string]'
    [void]$merged.Add($Script:AgentsPreface.Trim())

    $agentSections = @{}
    foreach ($s in (Get-MarkdownSections -Text $AgentsText)) {
        if ($s.Heading -ne '__preface__') { $agentSections[$s.Heading] = $s.Body }
    }
    $claudeSections = @{}
    foreach ($s in (Get-MarkdownSections -Text $ClaudeShared)) {
        if ($s.Heading -ne '__preface__') { $claudeSections[$s.Heading] = $s.Body }
    }

    $orderedHeadings = New-Object 'System.Collections.Generic.List[string]'
    foreach ($h in $agentSections.Keys) { if ($orderedHeadings -notcontains $h) { [void]$orderedHeadings.Add($h) } }
    foreach ($h in $claudeSections.Keys) { if ($orderedHeadings -notcontains $h) { [void]$orderedHeadings.Add($h) } }

    foreach ($h in $orderedHeadings) {
        $a = $agentSections[$h]
        $c = $claudeSections[$h]
        if ($a -and -not $c) { [void]$merged.Add($a.Trim()); continue }
        if ($c -and -not $a) { [void]$merged.Add($c.Trim()); continue }
        $aN = if ($a) { Format-NormalizedText $a } else { '' }
        $cN = if ($c) { Format-NormalizedText $c } else { '' }
        if ($aN -eq $cN) {
            [void]$merged.Add(($a, $c | Where-Object { $_ } | Select-Object -First 1).Trim())
            continue
        }
        $chosen = $a
        $source = 'AGENTS.md'
        if ($Prefer -eq 'claude') { $chosen = $c; $source = 'CLAUDE.md' }
        Add-Conflict ("Instruction conflict for section '{0}': kept {1} in AGENTS.md and preserved both variants in {2}." -f $h, $source, $Script:MergedCandidate)
        [void]$merged.Add($chosen.Trim())
    }

    return Format-NormalizedText (($merged | Where-Object { $_ -and $_.Trim() }) -join "`n`n")
}

function Resolve-NewestPreference {
    param([string]$AgentsPath, [string]$ClaudePath)
    if (-not (Test-Path $AgentsPath)) { return 'claude' }
    if (-not (Test-Path $ClaudePath)) { return 'agents' }
    $a = (Get-Item $AgentsPath).LastWriteTimeUtc
    $c = (Get-Item $ClaudePath).LastWriteTimeUtc
    if ($c -gt $a) { return 'claude' }
    return 'agents'
}

function Detect-ClaudeInversion {
    # Returns a one-line note string if CLAUDE.md looks like the de-facto canonical file.
    param([string]$ClaudeText, [string]$AgentsText)
    if ([string]::IsNullOrWhiteSpace($ClaudeText)) { return $null }
    if ($AgentsText -and $AgentsText.Length -gt 2000) { return $null }
    $sections = Get-MarkdownSections -Text $ClaudeText
    $sectionCount = ($sections | Where-Object { $_.Heading -ne '__preface__' }).Count
    $charCount = $ClaudeText.Length
    if ($sectionCount -ge 5 -or $charCount -ge 4000) {
        $kb = [int]($charCount / 1000)
        return ("CLAUDE.md appears to be the de-facto canonical instructions ({0} sections, ~{1}KB). Inverting to AGENTS.md-canonical per cross-vendor convention." -f $sectionCount, $kb)
    }
    return $null
}

function Build-AgentsContent {
    param(
        [string]$AgentsText,
        [string]$ClaudeText,
        [string]$Prefer,
        [string]$AgentsPath,
        [string]$ClaudePath,
        [string[]]$ClaudeOnly
    )
    $resolvedPrefer = $Prefer
    if ($Prefer -eq 'newest') {
        $resolvedPrefer = Resolve-NewestPreference -AgentsPath $AgentsPath -ClaudePath $ClaudePath
        Add-Note ("Resolved -Prefer=newest to '{0}'." -f $resolvedPrefer)
    }

    $inversion = Detect-ClaudeInversion -ClaudeText $ClaudeText -AgentsText $AgentsText
    if ($inversion) { Add-Note $inversion }

    $claudeOnlyText = ''
    $mergedCandidate = $null
    $claudeShared = ''

    if ($ClaudeText) {
        $split = Split-ClaudeSections -ClaudeText $ClaudeText -ClaudeOnly $ClaudeOnly
        $claudeShared = $split.Shared
        $claudeOnlyText = $split.ClaudeOnly
    }

    if ($AgentsText -and $claudeShared) {
        $canonical = Merge-AgentSections -AgentsText $AgentsText -ClaudeShared $claudeShared -Prefer $resolvedPrefer
        if ($Script:Conflicts.Count -gt 0) {
            $mergedCandidate = Format-NormalizedText (
                @(
                    '# Project Instructions (Merged Candidate)',
                    '## AGENTS.md (existing)',
                    (Format-NormalizedText $AgentsText).Trim(),
                    '## CLAUDE.md Shared Sections (existing)',
                    (Format-NormalizedText $claudeShared).Trim()
                ) -join "`n`n"
            )
        }
        Add-Note 'Merged AGENTS.md with shared content from CLAUDE.md.'
        return @{ Canonical = $canonical; MergedCandidate = $mergedCandidate; ClaudeOnly = $claudeOnlyText }
    }

    if ($AgentsText) {
        Add-Note 'Kept existing AGENTS.md as canonical because it already existed.'
        return @{ Canonical = (Format-NormalizedText $AgentsText); MergedCandidate = $null; ClaudeOnly = $claudeOnlyText }
    }

    if ($claudeShared) {
        Add-Note 'Generated AGENTS.md from shared sections in existing CLAUDE.md.'
        $generated = Format-NormalizedText (@($Script:AgentsPreface.Trim(), $claudeShared.Trim()) -join "`n`n")
        return @{ Canonical = $generated; MergedCandidate = $null; ClaudeOnly = $claudeOnlyText }
    }

    Add-Note 'Created a starter AGENTS.md because neither shared instruction file had usable content.'
    return @{ Canonical = (Format-NormalizedText $Script:AgentsPreface); MergedCandidate = $null; ClaudeOnly = $claudeOnlyText }
}

function Build-ClaudeShim {
    param([string]$ClaudeOnlyText)
    $blocks = @($Script:ClaudeShim.Trim())
    if ($ClaudeOnlyText) { $blocks += $ClaudeOnlyText.Trim() }
    return Format-NormalizedText ($blocks -join "`n`n")
}

function Add-DocPointers {
    param([string]$Content, [string]$DocsDirName)
    $marker = '## Additional Documentation'
    if ($Content -match [regex]::Escape($marker)) { return $Content }
    $additions = @"

## Additional Documentation

- ``$DocsDirName/GETTING-STARTED.md`` for environment setup and common run commands.
- ``$DocsDirName/PROJECT-STRUCTURE.md`` for repo layout and naming conventions.
- ``$DocsDirName/ROADMAP.md`` for current delivery phases and follow-up work.
- ``$DocsDirName/CHANGELOG.md`` for session-by-session delivery notes.
"@
    return Format-NormalizedText ($Content + "`n" + $additions)
}

function Initialize-DocsDir {
    param([string]$RepoRoot)
    $docsDir = Join-Path $RepoRoot $Script:DocsDirName
    $legacy = Join-Path $RepoRoot $Script:LegacyDocsDirName

    if (Test-Path $legacy) {
        if (-not (Test-Path $docsDir)) {
            Add-Action "MOVE: $legacy -> $docsDir"
            Add-Note ("Migrating {0}/ to {1}/ as the canonical agent docs tree." -f $Script:LegacyDocsDirName, $Script:DocsDirName)
            if (-not $Script:DryRun) {
                Move-Item -LiteralPath $legacy -Destination $docsDir -Force
            }
            return $docsDir
        }

        # Both exist - merge contents; preserve collisions in legacy.
        $moved = 0; $skipped = 0
        Get-ChildItem -LiteralPath $legacy | ForEach-Object {
            $target = Join-Path $docsDir $_.Name
            if (Test-Path $target) {
                $skipped++
            } else {
                Add-Action "MOVE: $($_.FullName) -> $target"
                if (-not $Script:DryRun) {
                    Move-Item -LiteralPath $_.FullName -Destination $target -Force
                }
                $moved++
            }
        }
        Add-Note ("Merged {0}/ into {1}/ (moved {2}, skipped {3} due to name collision)." -f $Script:LegacyDocsDirName, $Script:DocsDirName, $moved, $skipped)
        if ($skipped -eq 0 -and -not $Script:DryRun) {
            try { Remove-Item -LiteralPath $legacy -Force -ErrorAction Stop } catch {}
        }
        return $docsDir
    }

    if (Test-Path $docsDir) { return $docsDir }
    New-DirIfMissing $docsDir
    Add-Note ("Created {0}/ as the canonical agent docs tree." -f $Script:DocsDirName)
    return $docsDir
}

# =============================================================================
# Skills tree placement
# =============================================================================

function Get-AgentSkillDirs {
    param([string]$RepoRoot)
    $candidates = @{
        'claude' = (Join-Path $RepoRoot '.claude\skills')
        'codex'  = (Join-Path $RepoRoot '.codex\skills')
        'gemini' = (Join-Path $RepoRoot '.gemini\skills')
    }
    $found = @{}
    foreach ($k in $candidates.Keys) {
        if (Test-Path $candidates[$k] -PathType Container) { $found[$k] = $candidates[$k] }
    }
    return $found
}

function Get-BundleMaxMtime {
    param([string]$Dir)
    $files = Get-ChildItem -LiteralPath $Dir -Recurse -File -ErrorAction SilentlyContinue
    if (-not $files) { return [datetime]'1900-01-01' }
    return ($files | Measure-Object -Property LastWriteTimeUtc -Maximum).Maximum
}

function Set-CanonicalSkillsTree {
    param([string]$RepoRoot, [hashtable]$Detected)

    if ($Detected.ContainsKey('claude')) {
        if ($Detected.Count -gt 1) {
            $others = ($Detected.Keys | Where-Object { $_ -ne 'claude' } | Sort-Object) -join ', '
            Add-Note ("Multiple agent skill dirs detected (claude + {0}). This skill does NOT merge them; run ``/sync-multiagent-skills`` to reconcile via newest-mtime-wins + 5-min conflict detection." -f $others)
        }
        return
    }
    if ($Detected.Count -eq 0) {
        Add-Note 'No agent skills directory detected; nothing to relocate.'
        return
    }

    $promoted = $null; $newest = [datetime]'1900-01-01'
    foreach ($k in $Detected.Keys) {
        $m = Get-BundleMaxMtime $Detected[$k]
        if ($m -gt $newest) { $newest = $m; $promoted = $k }
    }

    $src = $Detected[$promoted]
    $dst = Join-Path $RepoRoot '.claude\skills'
    Move-PathSafe -Source $src -Destination $dst
    Add-Note ("Promoted .{0}/skills/ to .claude/skills/ as the canonical git-tracked tree." -f $promoted)

    $leftover = ($Detected.Keys | Where-Object { $_ -ne $promoted } | Sort-Object) | ForEach-Object { ".$_/skills/" }
    if ($leftover) {
        Add-Note ("Other agent skill dirs remain at: {0}. Run ``/sync-multiagent-skills`` to fan the canonical tree out to them." -f ($leftover -join ', '))
    }
}

function Add-GitignoreMultiagentPatterns {
    param([string]$RepoRoot)
    $gi = Join-Path $RepoRoot '.gitignore'
    $existing = ''
    if (Test-Path $gi) { $existing = Read-FileText $gi }
    $missing = @()
    foreach ($p in $Script:GitignoreMultiagentPatterns) {
        if (-not ($existing.Contains($p))) { $missing += $p }
    }
    if ($missing.Count -eq 0) {
        Add-Note '.gitignore already contains the /sync-multiagent-skills patterns.'
        return
    }
    $block = "`n" + $Script:GitignoreMultiagentHeader + "`n" + ($missing -join "`n") + "`n"
    Add-Action ("APPEND: {0} ({1} pattern(s))" -f $gi, $missing.Count)
    if (-not $Script:DryRun) {
        if ($existing -and -not $existing.EndsWith("`n")) { $existing += "`n" }
        Write-FileText -Path $gi -Content ($existing + $block)
    }
    Add-Note ("Appended {0} /sync-multiagent-skills pattern(s) to .gitignore." -f $missing.Count)
}

# =============================================================================
# Migration report
# =============================================================================

function Write-Report {
    param([string]$RepoRoot, [string]$Mode, [string]$AgentsPath, [string[]]$ClaudeOnly)
    $reportPath = Join-Path $RepoRoot $Script:ReportRel
    $lines = New-Object 'System.Collections.Generic.List[string]'
    [void]$lines.Add('# Agent Repo Migration Report')
    [void]$lines.Add('')
    [void]$lines.Add("- Repo: ``$RepoRoot``")
    [void]$lines.Add(("- When: {0}" -f (Get-Date -Format 'yyyy-MM-ddTHH:mm:ss')))
    [void]$lines.Add("- Mode: $Mode")
    [void]$lines.Add("- Canonical instructions: ``AGENTS.md`` ($AgentsPath)")
    [void]$lines.Add('- Canonical skills tree: `.claude/skills/` (multi-agent fan-out via `/sync-multiagent-skills`)')
    [void]$lines.Add('')
    [void]$lines.Add('## Environment Notes')
    [void]$lines.Add(("- PowerShell version: {0}" -f $PSVersionTable.PSVersion))
    [void]$lines.Add(("- Claude-only headings (kept on shim): {0}" -f (($ClaudeOnly | Sort-Object) -join ', ')))
    [void]$lines.Add('')

    if ($Script:Notes.Count -gt 0) {
        [void]$lines.Add('## Notes')
        foreach ($n in $Script:Notes) { [void]$lines.Add("- $n") }
        [void]$lines.Add('')
    }
    if ($Script:Conflicts.Count -gt 0) {
        [void]$lines.Add('## Conflicts')
        foreach ($c in $Script:Conflicts) { [void]$lines.Add("- $c") }
        [void]$lines.Add('')
    }
    [void]$lines.Add('## Planned / Performed Actions')
    foreach ($a in $Script:Actions) { [void]$lines.Add("- $a") }
    [void]$lines.Add('')
    [void]$lines.Add('## Next Steps')
    [void]$lines.Add('- Review `AGENTS.md`, `CLAUDE.md`, and this report before committing.')
    [void]$lines.Add('- If `AGENTS.merged.candidate.md` exists, reconcile the conflicting sections and remove that file.')
    [void]$lines.Add('- If `.codex/skills/` or `.gemini/skills/` exists, run `/sync-multiagent-skills` to fan the canonical `.claude/skills/` tree out to them.')
    [void]$lines.Add('- Run your usual build and test workflow after applying changes.')

    $reportText = ($lines -join "`n") + "`n"
    if ($Script:DryRun) {
        # Dry-run is read-only: print to stdout instead of writing.
        Write-Output ('--- DRY-RUN report (would be written to ' + $reportPath + ') ---')
        Write-Output $reportText
        return
    }
    Write-FileText -Path $reportPath -Content $reportText
}

# =============================================================================
# Main
# =============================================================================

$repoRoot = Find-GitRoot

$claudeOnly = $Script:DefaultClaudeOnlyHeadings
if ($ClaudeOnlyHeadings) {
    $claudeOnly = ($ClaudeOnlyHeadings -split ',') | ForEach-Object { $_.Trim() } | Where-Object { $_ }
}

$agentsPath = Join-Path $repoRoot 'AGENTS.md'
$claudePath = Join-Path $repoRoot 'CLAUDE.md'

$docsDir = Initialize-DocsDir -RepoRoot $repoRoot

$agentsText = $null
if (Test-FileNonEmpty $agentsPath) { $agentsText = Read-FileText $agentsPath }
$claudeText = $null
if (Test-FileNonEmpty $claudePath) { $claudeText = Read-FileText $claudePath }

$built = Build-AgentsContent `
    -AgentsText $agentsText `
    -ClaudeText $claudeText `
    -Prefer $Prefer `
    -AgentsPath $agentsPath `
    -ClaudePath $claudePath `
    -ClaudeOnly $claudeOnly

$canonical = $built.Canonical
if (Test-Path $docsDir) {
    $canonical = Add-DocPointers -Content $canonical -DocsDirName $Script:DocsDirName
}

if (Test-FileNonEmpty $agentsPath) {
    Backup-FileToDir -Path $agentsPath -DestDir (Join-Path $docsDir 'archive') | Out-Null
}
Add-Action "WRITE: $agentsPath"
if (-not $Script:DryRun) { Write-FileText -Path $agentsPath -Content $canonical }

if ($built.MergedCandidate) {
    $mergedPath = Join-Path $repoRoot $Script:MergedCandidate
    Add-Action "WRITE: $mergedPath"
    if (-not $Script:DryRun) { Write-FileText -Path $mergedPath -Content $built.MergedCandidate }
}

if (Test-FileNonEmpty $claudePath) {
    Backup-FileToDir -Path $claudePath -DestDir (Join-Path $docsDir 'archive') | Out-Null
}
Add-Action "WRITE: $claudePath"
if (-not $Script:DryRun) {
    Write-FileText -Path $claudePath -Content (Build-ClaudeShim $built.ClaudeOnly)
}

$detected = Get-AgentSkillDirs -RepoRoot $repoRoot
Set-CanonicalSkillsTree -RepoRoot $repoRoot -Detected $detected

if ($GitignoreMultiagent) {
    Add-GitignoreMultiagentPatterns -RepoRoot $repoRoot
}

$mode = if ($Script:DryRun) { 'DRY-RUN' } else { 'APPLIED' }
Write-Report -RepoRoot $repoRoot -Mode $mode -AgentsPath $agentsPath -ClaudeOnly $claudeOnly

Write-Output "$mode complete. See $($Script:ReportRel) in repo root."
