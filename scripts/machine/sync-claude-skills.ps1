# Mirrors .claude/skills into .v3code/skills so V3Code's skill loader finds them.
#
# Why this exists: V3Code's loader scans .v3code/skills and does NOT follow the
# .claude/skills entries. On this machine those entries are Windows junctions
# into .agents/skills; git stores them as ordinary files (mode 100644), so a
# fresh clone writes real content in both places and no junction/Developer Mode
# handling is needed here.
#
# Why it lives in scripts/machine and not .v3code: .gitignore excludes .v3code/
# entirely, so a copy kept there would never reach a new PC -- the one machine
# where you actually need it. Run after `claude skills` installs or updates, and
# once as part of new-machine bootstrap.
#
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File scripts\machine\sync-claude-skills.ps1

$ErrorActionPreference = 'Stop'

$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$src  = Join-Path $repo '.claude\skills'
$dst  = Join-Path $repo '.v3code\skills'

if (-not (Test-Path $src)) {
    Write-Error "No .claude\skills at $src -- is this the repo root?"
}

if (Test-Path $dst) { Remove-Item $dst -Recurse -Force }
New-Item -ItemType Directory -Path $dst -Force | Out-Null

$copied = 0
$skipped = @()

foreach ($skill in Get-ChildItem $src -Force -Directory) {
    if (-not (Test-Path (Join-Path $skill.FullName 'SKILL.md'))) {
        $skipped += $skill.Name
        continue
    }
    Copy-Item -Path $skill.FullName -Destination (Join-Path $dst $skill.Name) -Recurse -Force
    $copied++
}

Write-Output ("copied={0}" -f $copied)
if ($skipped.Count -gt 0) {
    Write-Output ("skipped (no SKILL.md)={0}" -f ($skipped -join ', '))
}
if ($copied -eq 0) {
    Write-Error "Copied 0 skills -- the loader will find nothing."
}
