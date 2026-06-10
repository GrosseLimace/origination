# Sync skills between .claude/skills/, .codex/skills/, .gemini/skills/.
#
# Design C: newest-mtime-wins propagation with conflict detection.
#
# For each skill name present in any active agent directory:
#   - Compute the bundle's max mtime across all files (recursive).
#   - Compute a content hash (SHA-256 over sorted relpath + bytes).
#   - If only one source has it, propagate to the other active targets.
#   - If multiple sources have it and hashes match, no-op (or fill missing).
#   - If hashes differ and the two newest mtimes are within ConflictWindowSeconds,
#     flag as conflict and skip (unless -Prefer is supplied).
#   - Otherwise, the bundle with the newest mtime wins and propagates.
#
# Deletions are NOT auto-handled - use -Delete <name> to remove a skill from
# all active targets.
#
# .claude/skills/ is the canonical, git-tracked source. .codex/skills/ and
# .gemini/skills/ should be gitignored along with .claude/skills/.sync-log
# (append-only audit log of every sync run).
#
# PSv5.1-compatible.

[CmdletBinding()]
param(
    [string]$RepoRoot = (Get-Location).Path,
    [switch]$DryRun,
    [ValidateSet('claude', 'codex', 'gemini')]
    [string]$Prefer,
    [switch]$Json,
    [string]$Delete
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

# --- Constants ---
$Script:Agents = @('claude', 'codex', 'gemini')
$Script:SkillsSubdir = 'skills'
$Script:ConflictWindowSeconds = 300
$Script:LogPathRel = '.claude/skills/.sync-log'
$Script:SkipNames = @('.DS_Store', 'Thumbs.db', '__pycache__', '.sync-log')

# --- Helpers ---
function Get-AgentRoot {
    param([string]$RepoRoot, [string]$Agent)
    return Join-Path $RepoRoot ".$Agent\$Script:SkillsSubdir"
}

function Get-BundleFiles {
    param([string]$BundleDir)
    if (-not (Test-Path $BundleDir -PathType Container)) { return @() }
    $files = @()
    Get-ChildItem -LiteralPath $BundleDir -Recurse -File -Force -ErrorAction SilentlyContinue | ForEach-Object {
        $skip = $false
        $relParts = $_.FullName.Substring($BundleDir.Length).TrimStart('\', '/').Split([char[]]@('\', '/'))
        foreach ($part in $relParts) {
            if ($Script:SkipNames -contains $part) { $skip = $true; break }
        }
        if (-not $skip) { $files += $_ }
    }
    return $files | Sort-Object FullName
}

function Get-BundleMtime {
    param([string]$BundleDir)
    $files = Get-BundleFiles $BundleDir
    if ($files.Count -eq 0) { return [datetime]::MinValue }
    return ($files | Measure-Object -Property LastWriteTimeUtc -Maximum).Maximum
}

function Get-BundleHash {
    param([string]$BundleDir)
    $files = Get-BundleFiles $BundleDir
    if ($files.Count -eq 0) { return 'empty' }
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $sep = [byte[]]@(0)
        foreach ($f in $files) {
            $rel = $f.FullName.Substring($BundleDir.Length).TrimStart('\', '/') -replace '\\', '/'
            $relBytes = [System.Text.Encoding]::UTF8.GetBytes($rel)
            $null = $sha.TransformBlock($relBytes, 0, $relBytes.Length, $relBytes, 0)
            $null = $sha.TransformBlock($sep, 0, 1, $sep, 0)
            $bytes = [System.IO.File]::ReadAllBytes($f.FullName)
            if ($bytes.Length -gt 0) {
                $null = $sha.TransformBlock($bytes, 0, $bytes.Length, $bytes, 0)
            }
            $null = $sha.TransformBlock($sep, 0, 1, $sep, 0)
        }
        $null = $sha.TransformFinalBlock([byte[]]@(), 0, 0)
        return ($sha.Hash | ForEach-Object { $_.ToString('x2') }) -join ''
    } finally {
        $sha.Dispose()
    }
}

function Get-SkillNames {
    param([string]$RepoRoot)
    $names = New-Object 'System.Collections.Generic.HashSet[string]'
    foreach ($agent in $Script:Agents) {
        $root = Get-AgentRoot -RepoRoot $RepoRoot -Agent $agent
        if (-not (Test-Path $root -PathType Container)) { continue }
        Get-ChildItem -LiteralPath $root -Directory -ErrorAction SilentlyContinue | ForEach-Object {
            if (-not $_.Name.StartsWith('.')) { [void]$names.Add($_.Name) }
        }
    }
    return @($names | Sort-Object)
}

function Get-ActiveTargets {
    param([string]$RepoRoot)
    return @($Script:Agents | Where-Object { Test-Path (Join-Path $RepoRoot ".$_") -PathType Container })
}

function Invoke-Propagate {
    param(
        [string]$RepoRoot, [string]$Name, [string]$Winner,
        [string[]]$Others, [hashtable]$Bundles,
        [switch]$Dry, [string]$Reason
    )
    $src = Get-AgentRoot -RepoRoot $RepoRoot -Agent $Winner
    $src = Join-Path $src $Name
    $propagatedTo = New-Object 'System.Collections.Generic.List[string]'
    foreach ($other in $Others) {
        $dst = Get-AgentRoot -RepoRoot $RepoRoot -Agent $other
        $dst = Join-Path $dst $Name
        if ($Bundles.Contains($other) -and $Bundles[$other].Hash -eq $Bundles[$Winner].Hash) {
            continue
        }
        if (-not $Dry) {
            if (Test-Path $dst) { Remove-Item -LiteralPath $dst -Recurse -Force }
            $dstParent = Split-Path -Parent $dst
            if (-not (Test-Path $dstParent)) { New-Item -ItemType Directory -Force -Path $dstParent | Out-Null }
            Copy-Item -LiteralPath $src -Destination $dst -Recurse -Force
            # Preserve mtimes
            foreach ($srcFile in Get-BundleFiles $src) {
                $rel = $srcFile.FullName.Substring($src.Length).TrimStart('\', '/')
                $dstFile = Join-Path $dst $rel
                if (Test-Path $dstFile) {
                    (Get-Item -LiteralPath $dstFile).LastWriteTimeUtc = $srcFile.LastWriteTimeUtc
                }
            }
        }
        [void]$propagatedTo.Add($other)
    }
    if ($propagatedTo.Count -eq 0) {
        return @{ skill = $Name; action = 'noop'; reason = 'already-matches' }
    }
    return @{
        skill   = $Name
        action  = 'propagated'
        winner  = $Winner
        to      = @($propagatedTo)
        reason  = $Reason
    }
}

function Invoke-SyncSkill {
    param(
        [string]$RepoRoot, [string]$Name,
        [string[]]$Targets, [string]$Prefer, [switch]$Dry
    )
    $bundles = @{}
    foreach ($agent in $Targets) {
        $bd = Get-AgentRoot -RepoRoot $RepoRoot -Agent $agent
        $bd = Join-Path $bd $Name
        if (Test-Path $bd -PathType Container) {
            $bundles[$agent] = @{
                Dir   = $bd
                Mtime = Get-BundleMtime $bd
                Hash  = Get-BundleHash $bd
            }
        }
    }

    if ($bundles.Count -eq 0) {
        return @{ skill = $Name; action = 'noop'; reason = 'no-bundles' }
    }

    if ($bundles.Count -eq 1) {
        $winner = @($bundles.Keys)[0]
        $others = @($Targets | Where-Object { $_ -ne $winner })
        if ($others.Count -eq 0) {
            return @{ skill = $Name; action = 'noop'; reason = 'single-source-no-targets' }
        }
        return Invoke-Propagate -RepoRoot $RepoRoot -Name $Name -Winner $winner `
            -Others $others -Bundles $bundles -Dry:$Dry -Reason 'only-source'
    }

    $hashes = @{}
    foreach ($k in $bundles.Keys) { $hashes[$k] = $bundles[$k].Hash }
    $uniqueHashes = @($hashes.Values | Select-Object -Unique)
    if ($uniqueHashes.Count -eq 1) {
        $missing = @($Targets | Where-Object { -not $bundles.Contains($_) })
        if ($missing.Count -eq 0) {
            return @{ skill = $Name; action = 'noop'; reason = 'identical' }
        }
        $winner = @($bundles.Keys)[0]
        return Invoke-Propagate -RepoRoot $RepoRoot -Name $Name -Winner $winner `
            -Others $missing -Bundles $bundles -Dry:$Dry -Reason 'fill-missing'
    }

    # Sort by mtime descending
    $byMtime = $bundles.GetEnumerator() | Sort-Object -Property { $_.Value.Mtime } -Descending
    $newestEntry = $byMtime[0]
    $runnerEntry = $byMtime[1]
    $gapSeconds = ($newestEntry.Value.Mtime - $runnerEntry.Value.Mtime).TotalSeconds
    $inWindow = $gapSeconds -lt $Script:ConflictWindowSeconds

    if ($inWindow -and $newestEntry.Value.Hash -ne $runnerEntry.Value.Hash) {
        if (-not $Prefer -or -not $bundles.Contains($Prefer)) {
            $candidates = @()
            foreach ($k in $bundles.Keys) {
                $candidates += @{
                    agent = $k
                    mtime = [int64](([datetime]$bundles[$k].Mtime - [datetime]'1970-01-01').TotalSeconds)
                    hash  = $bundles[$k].Hash.Substring(0, 12)
                }
            }
            return @{
                skill      = $Name
                action     = 'conflict'
                reason     = "$($newestEntry.Key) and $($runnerEntry.Key) edited within $($Script:ConflictWindowSeconds)s with differing content"
                candidates = $candidates
            }
        }
        $winner = $Prefer
    } else {
        $winner = $newestEntry.Key
    }

    $others = @($Targets | Where-Object { $_ -ne $winner })
    return Invoke-Propagate -RepoRoot $RepoRoot -Name $Name -Winner $winner `
        -Others $others -Bundles $bundles -Dry:$Dry -Reason 'newest-wins'
}

function Invoke-DeleteSkill {
    param([string]$RepoRoot, [string]$Name, [string[]]$Targets, [switch]$Dry)
    $removed = New-Object 'System.Collections.Generic.List[string]'
    foreach ($agent in $Targets) {
        $d = Get-AgentRoot -RepoRoot $RepoRoot -Agent $agent
        $d = Join-Path $d $Name
        if (Test-Path $d -PathType Container) {
            if (-not $Dry) { Remove-Item -LiteralPath $d -Recurse -Force }
            [void]$removed.Add($agent)
        }
    }
    return @{ skill = $Name; action = 'deleted'; from = @($removed) }
}

function Add-LogEntry {
    param([string]$RepoRoot, [hashtable]$Summary)
    $log = Join-Path $RepoRoot $Script:LogPathRel
    $logParent = Split-Path -Parent $log
    if (-not (Test-Path $logParent)) {
        New-Item -ItemType Directory -Force -Path $logParent | Out-Null
    }
    $record = @{
        ts = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
    }
    foreach ($k in $Summary.Keys) { $record[$k] = $Summary[$k] }
    $line = ConvertTo-Json -InputObject $record -Depth 6 -Compress
    Add-Content -LiteralPath $log -Value $line -Encoding UTF8
}

# --- Main ---
$root = (Resolve-Path $RepoRoot).Path

if (-not (Test-Path (Join-Path $root '.claude') -PathType Container)) {
    [Console]::Error.WriteLine('ERROR: .claude/ not present at repo root; nothing to sync from.')
    exit 1
}

$targets = Get-ActiveTargets -RepoRoot $root
if ($targets.Count -le 1) {
    $msg = 'Only .claude/ is active; nothing to sync to. Create .codex/ or .gemini/ first if you want fan-out.'
    if ($Json) {
        Write-Output (ConvertTo-Json -InputObject @{ status = 'noop'; reason = $msg } -Compress)
    } else {
        Write-Output $msg
    }
    exit 0
}

if ($Delete) {
    $action = Invoke-DeleteSkill -RepoRoot $root -Name $Delete -Targets $targets -Dry:$DryRun
    if (-not $DryRun) {
        Add-LogEntry -RepoRoot $root -Summary @{ targets = $targets; actions = @($action) }
    }
    if ($Json) {
        Write-Output (ConvertTo-Json -InputObject $action -Depth 4)
    } else {
        $verb = if ($DryRun) { 'WOULD DELETE' } else { 'DELETED' }
        $fromList = if ($action.from.Count -gt 0) { ($action.from -join ', ') } else { '(none)' }
        Write-Output "$verb $($action.skill) from $fromList"
    }
    exit 0
}

$skillNames = Get-SkillNames -RepoRoot $root
$actions = @()
foreach ($n in $skillNames) {
    $actions += Invoke-SyncSkill -RepoRoot $root -Name $n -Targets $targets -Prefer $Prefer -Dry:$DryRun
}

$propagated = @($actions | Where-Object { $_.action -eq 'propagated' })
$conflicts  = @($actions | Where-Object { $_.action -eq 'conflict' })
$noops      = @($actions | Where-Object { $_.action -eq 'noop' })

$summary = @{
    targets          = $targets
    skill_count      = $skillNames.Count
    propagated_count = $propagated.Count
    conflict_count   = $conflicts.Count
    noop_count       = $noops.Count
    actions          = $actions
}

if (-not $DryRun) {
    Add-LogEntry -RepoRoot $root -Summary $summary
}

if ($Json) {
    Write-Output (ConvertTo-Json -InputObject $summary -Depth 6)
} else {
    $verb = if ($DryRun) { 'DRY RUN' } else { 'APPLIED' }
    Write-Output "sync-multiagent-skills - $verb"
    Write-Output "  targets:    $($targets -join ', ')"
    Write-Output "  skills:     $($skillNames.Count)"
    Write-Output "  propagated: $($propagated.Count)"
    foreach ($a in $propagated) {
        Write-Output "    $($a.skill): $($a.winner) -> $($a.to -join ',') ($($a.reason))"
    }
    Write-Output "  conflicts:  $($conflicts.Count)"
    foreach ($a in $conflicts) {
        $cands = @()
        foreach ($c in $a.candidates) {
            $cands += "$($c.agent)@mtime=$($c.mtime)"
        }
        Write-Output "    $($a.skill): $($a.reason)"
        Write-Output "      candidates: $($cands -join ', ')"
        Write-Output '      resolve with: -Prefer claude|codex|gemini'
    }
    Write-Output "  noops:      $($noops.Count)"
}

if ($conflicts.Count -gt 0) { exit 2 }
exit 0
