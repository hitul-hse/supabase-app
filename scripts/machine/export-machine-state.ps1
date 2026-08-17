# Packages everything a new PC needs that git does NOT carry, into one folder.
#
# Run this on the OLD machine. It collects secrets, V3Code memory, editor
# settings and user-level agents, then writes a manifest. Pair with
# scripts\machine\verify-machine-setup.ps1 on the NEW machine.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\machine\export-machine-state.ps1 -Destination E:\hse-transfer
#   ... add -WhatIf to see what would be copied without writing anything.
#
# IMPORTANT: the output contains SUPABASE_SERVICE_ROLE_KEY, TRACKINGTIME_AUTH and
# a GCS service-account key in clear text. Put it on encrypted removable media,
# never in email/chat/cloud sync, and delete it once the new machine is verified.

[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [Parameter(Mandatory = $true)]
    [string]$Destination,

    # docs/discovery holds unredacted colleague names, emails and salary data.
    # Off by default: it is re-derivable with `npm run discovery`, so most moves
    # should leave the PII behind rather than copy it onto another disk.
    [switch]$IncludeDiscovery
)

$ErrorActionPreference = 'Stop'

$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$memRoot = Join-Path $env:APPDATA 'V3Code\User\v3code-memory'
$results = @()

function Add-Result($name, $status, $detail) {
    $script:results += [pscustomobject]@{ Item = $name; Status = $status; Detail = $detail }
}

function Copy-Tree($label, $source, $targetName) {
    if (-not (Test-Path $source)) {
        Add-Result $label 'MISSING' $source
        return
    }
    $target = Join-Path $Destination $targetName
    if ($PSCmdlet.ShouldProcess($source, "copy to $target")) {
        if (Test-Path $target) { Remove-Item $target -Recurse -Force }
        Copy-Item $source $target -Recurse -Force
        $bytes = (Get-ChildItem $target -Recurse -File | Measure-Object -Property Length -Sum).Sum
        Add-Result $label 'COPIED' ("{0:N1} MB" -f ($bytes / 1MB))
    } else {
        Add-Result $label 'WOULD COPY' $source
    }
}

function Copy-One($label, $source, $targetName) {
    if (-not (Test-Path $source)) {
        Add-Result $label 'MISSING' $source
        return
    }
    $target = Join-Path $Destination $targetName
    if ($PSCmdlet.ShouldProcess($source, "copy to $target")) {
        New-Item -ItemType Directory -Force -Path (Split-Path $target) | Out-Null
        Copy-Item $source $target -Force
        Add-Result $label 'COPIED' ("{0:N0} bytes" -f (Get-Item $target).Length)
    } else {
        Add-Result $label 'WOULD COPY' $source
    }
}

if ($PSCmdlet.ShouldProcess($Destination, 'create export folder')) {
    New-Item -ItemType Directory -Force -Path $Destination | Out-Null
}

# --- The hard blocker: uncommitted work would simply not exist on the new PC.
Push-Location $repo
$dirty = @(git status --porcelain 2>$null | Where-Object { $_ -notmatch '^\s*\S+\s+\.v3code/|^\s*\S+\s+\.context-bridge/' })
$unpushed = (git rev-list --count '@{u}..HEAD' 2>$null)
Pop-Location

if ($dirty.Count -gt 0) {
    Add-Result 'UNCOMMITTED WORK' 'WARN' ("{0} file(s) -- these do NOT travel; commit and push first" -f $dirty.Count)
}
if ($unpushed -and $unpushed -ne '0') {
    Add-Result 'UNPUSHED COMMITS' 'WARN' ("{0} commit(s) ahead of origin" -f $unpushed)
}

# --- Secrets (not in git, unrecoverable if lost).
Copy-One  'env.local'       (Join-Path $repo '.env.local')  'repo\.env.local'
Copy-Tree 'secrets'         (Join-Path $repo '.secrets')    'repo\.secrets'

# --- V3Code cross-session memory. Copy the WHOLE folder: memory.db has a
# multi-MB -wal sidecar, and taking the .db alone silently drops recent memory.
# Close V3Code first or the copy can be torn.
Copy-Tree 'v3code-memory'   $memRoot                        'v3code\v3code-memory'
Copy-One  'settings.json'   (Join-Path $env:APPDATA 'V3Code\User\settings.json') 'v3code\settings.json'
Copy-Tree 'user agents'     (Join-Path $env:USERPROFILE '.v3code\agents')        'v3code\agents'

if ($IncludeDiscovery) {
    Copy-Tree 'docs/discovery (PII)' (Join-Path $repo 'docs\discovery') 'repo\docs-discovery'
} else {
    Add-Result 'docs/discovery (PII)' 'SKIPPED' 'pass -IncludeDiscovery to copy; otherwise re-run npm run discovery'
}

# --- Manifest: what the new machine should expect, and what it must NOT rely on.
$wsid = Get-Content (Join-Path $repo '.v3code\workspace-id') -ErrorAction SilentlyContinue
$origin = (git -C $repo remote get-url origin 2>$null)
$head = (git -C $repo rev-parse --short HEAD 2>$null)

$manifest = @"
HSE platform - machine transfer export
Created : $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
From    : $env:COMPUTERNAME ($env:USERNAME)
Node    : $(node --version 2>$null)   npm $(npm --version 2>$null)
Repo    : $origin @ $head
WS id   : $wsid

Restore on the new PC:
  1. git clone $origin
  2. copy repo\.env.local        -> <repo>\.env.local
     copy repo\.secrets\         -> <repo>\.secrets\
  3. copy v3code\v3code-memory\  -> %APPDATA%\V3Code\User\v3code-memory\   (V3Code CLOSED)
     copy v3code\settings.json   -> %APPDATA%\V3Code\User\settings.json
     copy v3code\agents\         -> %USERPROFILE%\.v3code\agents\
  4. npm ci
  5. powershell -File scripts\machine\sync-claude-skills.ps1
  6. gh auth login          (token lives in the Windows keyring, does not travel)
  7. powershell -File scripts\machine\verify-machine-setup.ps1

Deliberately NOT exported (regenerated, or server-side):
  node_modules, .next*, tsconfig.tsbuildinfo   -> npm ci / next build
  ~\.v3code\beastdb                            -> re-indexes; a stale copy gives wrong search hits
  ~\.v3code\extensions, ~\.v3code\models       -> ~1.6 GB, reinstalled by V3Code
  GitHub Actions secrets, Supabase config      -> server-side, unaffected by the move

CONTAINS LIVE CREDENTIALS. Encrypted media only. Delete after verifying.
"@

if ($PSCmdlet.ShouldProcess((Join-Path $Destination 'MANIFEST.txt'), 'write manifest')) {
    $manifest | Set-Content (Join-Path $Destination 'MANIFEST.txt') -Encoding UTF8
}

$results | Format-Table -AutoSize | Out-String | Write-Output

if ($results | Where-Object { $_.Status -eq 'MISSING' }) {
    Write-Output 'Some items were MISSING -- review before wiping the old machine.'
}
if ($results | Where-Object { $_.Status -eq 'WARN' }) {
    Write-Output 'WARNINGS above: uncommitted or unpushed work does not travel in this export.'
}
Write-Output ("Export destination: {0}" -f $Destination)
