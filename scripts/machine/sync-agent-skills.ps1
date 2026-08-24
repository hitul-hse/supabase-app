# Mirrors every agent skill this machine can see into .v3code/skills, which is the
# ONLY directory V3Code's skill loader scans. Without this, a skill can sit on disk
# in .claude/skills with perfect frontmatter and still be unloadable: read_skill
# reports "no skill named X" while the file is right there.
#
# Two sources, deliberately:
#
#   1. .claude/skills  -- skills vendored INTO this repo (committed, travel with a
#      clone). Small, self-contained markdown: the emilkowalski/Leonxlnx sets,
#      impeccable, graphify, and the everything-claude-code set.
#
#   2. ~/.claude/skills -- skills installed USER-LEVEL by their own installers.
#      gstack lives here and must stay here: its SKILL.md preamble shells out to
#      ~/.claude/skills/gstack/bin/* on every single invocation, so the user-level
#      copy is the one that actually executes. Vendoring a second copy into the
#      repo costs ~25 MB and guarantees the two drift apart -- gstack's own docs
#      call vendoring deprecated for exactly this reason.
#
# Repo copies WIN on a name collision, so this project can deliberately override a
# user-level skill. Skips any directory without a SKILL.md (the loader ignores
# those anyway) and reports what it skipped rather than failing silently.
#
# Run after any skill install/update, and once during new-machine bootstrap.
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File scripts\machine\sync-agent-skills.ps1

$ErrorActionPreference = 'Stop'

$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$repoSrc = Join-Path $repo '.claude\skills'
$userSrc = Join-Path $HOME '.claude\skills'
$dst = Join-Path $repo '.v3code\skills'

if (-not (Test-Path $repoSrc)) {
    Write-Error "No .claude\skills at $repoSrc -- is this the repo root?"
}

if (Test-Path $dst) { Remove-Item $dst -Recurse -Force }
New-Item -ItemType Directory -Path $dst -Force | Out-Null

$skippedNoSkillMd = @()
$fromUser = 0
$fromRepo = 0
$overridden = @()

# Build artefacts to never mirror. The user-level gstack install is a full dev
# checkout, not a packaged skill: node_modules alone is 680 MB / 11,877 files, and
# browse/ (191 MB) plus make-pdf/ and design/ (~95 MB each) carry vendored browser
# and PDF binaries. Copying those made the mirror 1,234 MB / 14,545 files for
# ~13 MB of actual skill text -- slow to sync, and none of it is ever read by the
# loader, which only wants SKILL.md and its sibling references.
$excludeDirs = @('node_modules', '.git', 'dist', 'build', '.next', 'coverage', '.venv', '__pycache__')

function Copy-SkillDir {
    param([string] $From, [string] $To)

    New-Item -ItemType Directory -Path $To -Force | Out-Null
    Get-ChildItem $From -Force | ForEach-Object {
        if ($_.PSIsContainer) {
            if ($excludeDirs -contains $_.Name) { return }
            Copy-SkillDir -From $_.FullName -To (Join-Path $To $_.Name)
        }
        else {
            # Skip vendored binaries: they are never read as skill text.
            if ($_.Extension -in @('.exe', '.dll', '.node', '.zip', '.7z', '.dmg', '.pdb')) { return }
            Copy-Item -Path $_.FullName -Destination (Join-Path $To $_.Name) -Force
        }
    }
}

# User-level first so repo copies overwrite them on a name collision.
if (Test-Path $userSrc) {
    foreach ($skill in Get-ChildItem $userSrc -Force -Directory) {
        if (-not (Test-Path (Join-Path $skill.FullName 'SKILL.md'))) {
            $skippedNoSkillMd += "$($skill.Name) (user)"
            continue
        }
        Copy-SkillDir -From $skill.FullName -To (Join-Path $dst $skill.Name)
        $fromUser++
    }
}

foreach ($skill in Get-ChildItem $repoSrc -Force -Directory) {
    if (-not (Test-Path (Join-Path $skill.FullName 'SKILL.md'))) {
        $skippedNoSkillMd += "$($skill.Name) (repo)"
        continue
    }
    $target = Join-Path $dst $skill.Name
    if (Test-Path $target) {
        $overridden += $skill.Name
        Remove-Item $target -Recurse -Force
    }
    Copy-SkillDir -From $skill.FullName -To $target
    $fromRepo++
}

$total = (Get-ChildItem $dst -Force -Directory).Count
$mirrorMb = [math]::Round(((Get-ChildItem $dst -Recurse -File -Force | Measure-Object -Property Length -Sum).Sum / 1MB), 1)

Write-Output ("total={0} fromUser={1} fromRepo={2} sizeMB={3}" -f $total, $fromUser, $fromRepo, $mirrorMb)
if ($overridden.Count -gt 0) {
    Write-Output ("repo overrode user-level={0}" -f (($overridden | Sort-Object) -join ', '))
}
if ($skippedNoSkillMd.Count -gt 0) {
    Write-Output ("skipped (no SKILL.md)={0}" -f (($skippedNoSkillMd | Sort-Object) -join ', '))
}
if ($total -eq 0) {
    Write-Error "Mirrored 0 skills -- the loader will find nothing."
}
