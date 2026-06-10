# Install the repo-normalizer skill into the user's Claude Code skills directory.
#
# Default: copies the skill to ~/.claude/skills/<name>.
#
# Multi-agent fan-out (~/.codex/skills/, ~/.gemini/skills/) is delegated to
# /sync-multiagent-skills per the Agent Skills Open Standard. Pass -AlsoCodex
# or -AlsoGemini if you want this script to copy directly without going through
# the sync skill.
#
# PSv5.1-compatible.

[CmdletBinding()]
param(
    [string]$Source = (Split-Path -Parent (Split-Path -Parent $PSCommandPath)),
    [string]$Name = '',
    [string]$Home = $HOME,
    [switch]$AlsoCodex,
    [switch]$AlsoGemini
)

$ErrorActionPreference = 'Stop'

function Remove-PathIfExists {
    param([Parameter(Mandatory)][string]$Path)
    if (-not (Test-Path $Path)) { return }
    Remove-Item -LiteralPath $Path -Recurse -Force
}

function Copy-Skill {
    param([Parameter(Mandatory)][string]$Src, [Parameter(Mandatory)][string]$Dest)
    Remove-PathIfExists $Dest
    $parent = Split-Path -Parent $Dest
    if ($parent -and -not (Test-Path $parent)) {
        New-Item -ItemType Directory -Force -Path $parent | Out-Null
    }
    Copy-Item -LiteralPath $Src -Destination $Dest -Recurse -Force
}

function Install-To {
    # Copy source into ~/.<agent>/skills/<name>. Returns the destination path,
    # or $null if ~/.<agent> doesn't exist (the agent isn't installed for this user).
    param(
        [Parameter(Mandatory)][string]$HomeRoot,
        [Parameter(Mandatory)][string]$Agent,
        [Parameter(Mandatory)][string]$SourcePath,
        [Parameter(Mandatory)][string]$SkillName
    )
    $agentRoot = Join-Path $HomeRoot ".$Agent"
    if (-not (Test-Path $agentRoot)) { return $null }
    $skillsParent = Join-Path $agentRoot 'skills'
    $dest = Join-Path $skillsParent $SkillName
    Copy-Skill -Src $SourcePath -Dest $dest
    return $dest
}

# --- Validate source ---
$sourcePath = (Resolve-Path -LiteralPath $Source).Path
if (-not (Test-Path -LiteralPath (Join-Path $sourcePath 'SKILL.md'))) {
    Write-Error "Source '$sourcePath' is not a skill directory (missing SKILL.md)."
    exit 1
}
if (-not $Name) { $Name = Split-Path -Leaf $sourcePath }

# --- Install to Claude (required) ---
$claudeDest = Install-To -HomeRoot $Home -Agent 'claude' -SourcePath $sourcePath -SkillName $Name
if ($null -eq $claudeDest) {
    Write-Error "~/.claude/ does not exist; cannot install Claude Code skills."
    exit 1
}
Write-Output "Installed to $claudeDest"

# --- Optional Codex ---
if ($AlsoCodex) {
    $d = Install-To -HomeRoot $Home -Agent 'codex' -SourcePath $sourcePath -SkillName $Name
    if ($null -eq $d) {
        Write-Output 'Skipped Codex copy: ~/.codex/ does not exist.'
    } else {
        Write-Output "Also installed to $d"
    }
}

# --- Optional Gemini ---
if ($AlsoGemini) {
    $d = Install-To -HomeRoot $Home -Agent 'gemini' -SourcePath $sourcePath -SkillName $Name
    if ($null -eq $d) {
        Write-Output 'Skipped Gemini copy: ~/.gemini/ does not exist.'
    } else {
        Write-Output "Also installed to $d"
    }
}

# --- Tip about /sync-multiagent-skills ---
if (-not $AlsoCodex -and (Test-Path (Join-Path $Home '.codex\skills'))) {
    Write-Output 'Tip: ~/.codex/skills/ exists. Run /sync-multiagent-skills against your home directory (or rerun with -AlsoCodex) to fan this skill out to Codex.'
}
if (-not $AlsoGemini -and (Test-Path (Join-Path $Home '.gemini\skills'))) {
    Write-Output 'Tip: ~/.gemini/skills/ exists. Run /sync-multiagent-skills against your home directory (or rerun with -AlsoGemini) to fan this skill out to Gemini.'
}
