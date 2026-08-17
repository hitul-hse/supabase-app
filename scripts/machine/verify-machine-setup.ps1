# Verifies a NEW machine is actually ready to work on this repo.
#
# Run after restoring an export and `npm ci`. Checks the things that fail
# silently or confusingly hours later -- a missing env key, memory that did not
# re-attach, skills the loader cannot see -- rather than the things that fail
# loudly on their own.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\machine\verify-machine-setup.ps1
#
# Exit code 0 = ready, 1 = at least one FAIL. WARN never fails the run.

$ErrorActionPreference = 'Continue'

$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$fails = 0
$warns = 0

function Check($label, $ok, $detail) {
    if ($ok) {
        Write-Output ("  PASS  {0,-34} {1}" -f $label, $detail)
    } else {
        Write-Output ("  FAIL  {0,-34} {1}" -f $label, $detail)
        $script:fails++
    }
}
function Warn($label, $detail) {
    Write-Output ("  WARN  {0,-34} {1}" -f $label, $detail)
    $script:warns++
}

Write-Output "`n-- toolchain"
$node = (node --version 2>$null)
# PGlite gates have broken on other Node majors before; match the major, do not
# demand the exact patch.
Check 'node major 24' ($node -match '^v24\.') "$node (expected v24.x)"
Check 'npm present'   ((npm --version 2>$null) -ne $null) (npm --version 2>$null)
$ghAuth = (gh auth status 2>&1 | Out-String)
if ($ghAuth -match 'Logged in') {
    Check 'gh authenticated' $true 'logged in'
} else {
    Warn 'gh authenticated' 'run `gh auth login` -- keyring token does not transfer'
}

Write-Output "`n-- repo state"
Check 'node_modules installed' (Test-Path (Join-Path $repo 'node_modules')) 'npm ci'
$wsidPath = Join-Path $repo '.v3code\workspace-id'
Check 'workspace-id present' (Test-Path $wsidPath) 'tracked in git; keys V3Code memory to this workspace'

Write-Output "`n-- secrets (not in git)"
$envPath = Join-Path $repo '.env.local'
if (Test-Path $envPath) {
    $envText = Get-Content $envPath -Raw
    # VERCEL_OIDC_TOKEN is deliberately absent: short-lived and self-refreshing.
    $required = @(
        'NEXT_PUBLIC_SUPABASE_URL',
        'NEXT_PUBLIC_SUPABASE_ANON_KEY',
        'SUPABASE_SERVICE_ROLE_KEY',
        'NEXT_PUBLIC_SITE_URL',
        'TRACKINGTIME_AUTH',
        'TRACKINGTIME_ACCOUNT_ID'
    )
    foreach ($k in $required) {
        # A key present but empty is worse than absent: guards pass, clients fail.
        $has = $envText -match ("(?m)^\s*" + [regex]::Escape($k) + "\s*=\s*\S+")
        Check "env $k" $has $(if ($has) { 'set' } else { 'missing or empty' })
    }
    if ($envText -match '(?m)^\s*NEXT_PUBLIC_SITE_URL\s*=\s*http://localhost') {
        Warn 'NEXT_PUBLIC_SITE_URL' 'still localhost -- fine locally, wrong for a deployed origin'
    }
} else {
    Check 'env.local present' $false $envPath
}
Check '.secrets/ present' (Test-Path (Join-Path $repo '.secrets')) 'GCS service account'

Write-Output "`n-- V3Code state"
$memRoot = Join-Path $env:APPDATA 'V3Code\User\v3code-memory'
$wsid = (Get-Content $wsidPath -ErrorAction SilentlyContinue | Select-Object -First 1)
if ($wsid) { $wsid = $wsid.Trim() }
$wsDb = Join-Path $memRoot ("profiles\default\workspace\{0}\memory.db" -f $wsid)
# The memory db is keyed by workspace id, so this is the check that proves memory
# actually re-attached instead of starting empty under a new id.
Check 'memory.db for this workspace' (Test-Path $wsDb) $(if (Test-Path $wsDb) { "{0:N0} MB" -f ((Get-Item $wsDb).Length / 1MB) } else { $wsDb })
Check 'settings.json' (Test-Path (Join-Path $env:APPDATA 'V3Code\User\settings.json')) 'editor + agent locations'
$agentDir = Join-Path $env:USERPROFILE '.v3code\agents'
if (Test-Path $agentDir) {
    Check 'user agents' $true ("{0} file(s)" -f (Get-ChildItem $agentDir -File -Recurse).Count)
} else {
    Warn 'user agents' 'no ~\.v3code\agents -- project agents in .claude/agents still work'
}

Write-Output "`n-- skills"
$claudeSkills = Join-Path $repo '.claude\skills'
$mirror = Join-Path $repo '.v3code\skills'
$claudeCount = if (Test-Path $claudeSkills) { (Get-ChildItem $claudeSkills -Directory -Force).Count } else { 0 }
$mirrorCount = if (Test-Path $mirror) { (Get-ChildItem $mirror -Directory -Force).Count } else { 0 }
Check '.claude/skills from clone' ($claudeCount -gt 0) "$claudeCount skill(s)"
# The mirror is what V3Code's loader actually scans; the clone alone is not enough.
Check '.v3code/skills mirror' ($mirrorCount -ge $claudeCount -and $mirrorCount -gt 0) `
    "$mirrorCount mirrored$(if ($mirrorCount -lt $claudeCount) { ' -- run scripts\machine\sync-claude-skills.ps1' })"

Write-Output "`n-- project agents"
$projAgents = Join-Path $repo '.claude\agents'
Check 'project agents' (Test-Path $projAgents) $(if (Test-Path $projAgents) { "{0} agent(s)" -f (Get-ChildItem $projAgents -File).Count } else { 'missing' })

Write-Output ""
Write-Output ("fails={0} warns={1}" -f $fails, $warns)
if ($fails -gt 0) {
    Write-Output 'NOT READY -- resolve FAIL lines above.'
    exit 1
}
Write-Output 'Ready. Next: npm run lint && npm run test:db && npm run build'
exit 0
