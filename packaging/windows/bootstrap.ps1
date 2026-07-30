# First-launch setup for the Windows build of SUD Workbench — the VISIBLE path.
# The direct analogue of packaging/bootstrap.sh.
#
# Run in a real console window by the launcher when the quiet path (setup_venv.ps1) could not
# finish, so that every install step, prompt and error is in front of the user. Its extra job over
# setup_venv.ps1 is the one setup_venv.ps1 refuses to do silently: INSTALL THE MISSING
# PREREQUISITES — Python 3.12 (step 1) and Git (step 2, needed because some requirements install
# from `git+` URLs and pip shells out to git for them).
#
# Windows has no Homebrew, so bootstrap.sh's `brew install python@3.12` becomes a two-step ladder:
#
#   1. winget — the closest equivalent, and preinstalled as part of App Installer on Windows 11 and
#      on Windows 10 1809+. `--scope user` keeps it out of Program Files, so there is NO UAC prompt
#      and no admin account is needed, which matches the per-user install the .iss performs.
#   2. the official python.org installer, downloaded and run with InstallAllUsers=0 /passive — for
#      machines where winget is absent (LTSC, stripped images, an old 10) or blocked by policy.
#      Also per-user, also no UAC.
#   3. if both fail: an actionable message with the exact URL, and a non-zero exit. Never a silent
#      failure — this is the one place a Windows user can be left with a dead Start Menu entry.
#
# On success it launches the app; subsequent launches skip this entirely.
[CmdletBinding()]
param([Parameter(ValueFromRemainingArguments = $true)] [string[]]$AppArgs)

$ErrorActionPreference = 'Stop'

$Res    = Split-Path -Parent $MyInvocation.MyCommand.Path        # …\SUD Workbench\setup
$Root   = Split-Path -Parent $Res                                # …\SUD Workbench
$AppSrc = Join-Path $Root 'appsrc'
$AppSup = Join-Path $env:LOCALAPPDATA 'SUD Workbench'
$Venv   = Join-Path $AppSup 'venv'
New-Item -ItemType Directory -Force -Path $AppSup | Out-Null

. (Join-Path $Res 'find_py.ps1')
. (Join-Path $Res 'find_git.ps1')

$Req = Join-Path $Res 'requirements-core.txt'

# 3.12 is in security-only maintenance, so 3.12.10 is the LAST release with binary installers —
# there will never be a newer python-3.12.*.exe to bump this to. winget's Python.Python.3.12 tracks
# the same thing and is tried first regardless.
$PyVersion = '3.12.10'

function Write-Rule { Write-Host ('─' * 62) }

Write-Rule
Write-Host '  SUD Workbench — first-launch setup'
Write-Rule

# ── 1. find, or install, a Python 3.12 ───────────────────────────────────────────────────────────
$Py = Find-Py

if (-not $Py) {
    Write-Host '• No Python 3.12 found.'

    $winget = Get-Command winget.exe -ErrorAction SilentlyContinue
    if ($winget) {
        Write-Host '• Installing it with winget (per-user — no administrator prompt)…'
        # --scope user: a machine-wide install would trigger UAC, and this app is installed per-user.
        # The accept-* flags are required for a non-interactive run; --silent keeps python's own
        # installer UI out of the way while winget itself reports progress in this window.
        & $winget.Source install --id Python.Python.3.12 --source winget --scope user `
            --accept-package-agreements --accept-source-agreements --silent
        # winget writes the new install into the registry that py.exe reads, but this process's PATH
        # is a stale copy — Find-Py goes through py.exe and the well-known paths, so it still finds it.
        $Py = Find-Py
    } else {
        Write-Host '• winget is not available on this system.'
    }
}

if (-not $Py) {
    # PROCESSOR_ARCHITECTURE is the *process* architecture; on an ARM64 machine running a 64-bit
    # PowerShell it reads ARM64, which is what we want. Note the amd64 build is the one that matters
    # in practice: pythonnet (pywebview's Windows backend) publishes no win_arm64 wheel, so an ARM64
    # machine must run the x64 Python under emulation — see the note in requirements-core.txt.
    $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'amd64' }
    $url  = "https://www.python.org/ftp/python/$PyVersion/python-$PyVersion-$arch.exe"
    $dst  = Join-Path $env:TEMP "python-$PyVersion-$arch.exe"

    Write-Host "• Downloading the official Python $PyVersion installer…"
    Write-Host "  $url"
    try {
        # -UseBasicParsing: the IE-engine parser is absent on Server Core / fresh images and its
        # absence is a hard error rather than a degradation.
        Invoke-WebRequest -Uri $url -OutFile $dst -UseBasicParsing
        Write-Host '• Running it (per-user install, no administrator prompt)…'
        # InstallAllUsers=0 → %LOCALAPPDATA%\Programs\Python\Python312, no UAC.
        # PrependPath=1     → python on PATH for the user's own shells.
        # Include_launcher=1→ installs py.exe, which is the first thing Find-Py asks.
        # /passive          → a progress window, no questions.
        Start-Process -FilePath $dst -Wait -ArgumentList @(
            '/passive', 'InstallAllUsers=0', 'PrependPath=1', 'Include_launcher=1',
            'Include_test=0', 'Include_doc=0'
        )
        $Py = Find-Py
    } catch {
        Write-Host "• The download or install failed: $_"
    } finally {
        Remove-Item -LiteralPath $dst -ErrorAction SilentlyContinue
    }
}

if (-not $Py) {
    Write-Host ''
    Write-Host 'SUD Workbench needs Python 3.12 and could not install it automatically.'
    Write-Host ''
    Write-Host 'Install it yourself, then reopen SUD Workbench:'
    Write-Host '  • winget install Python.Python.3.12          (in a terminal), or'
    Write-Host "  • https://www.python.org/downloads/release/python-$($PyVersion -replace '\.','')/"
    Write-Host '    — tick "Add python.exe to PATH" in the installer.'
    Write-Host ''
    Write-Host 'Do NOT use the "python" shortcut from the Microsoft Store page: SUD Workbench needs'
    Write-Host 'version 3.12 exactly, and the Store ships whatever the current release is.'
    Write-Host ''
    Read-Host 'Press Enter to close'
    exit 1
}
Write-Host "• Using Python: $Py  ($(& $Py --version 2>&1))"

# ── 2. find, or install, Git ─────────────────────────────────────────────────────────────────────
# Some requirements install from a `git+` URL (wiktra in the core set; the full requirements.txt adds
# spacy-stanza), and pip has no built-in git client — it shells out. On macOS that is invisible
# because `git` is always there as a Command Line Tools shim; Windows ships none at all, so a bare
# machine used to get several minutes into pip and then fail on "Cannot find command 'git'".
# Checked BEFORE the venv is built, and read off the requirements file rather than hard-coded, so
# rewriting those lines as plain archive URLs would disable this whole step by itself.
$NeedGit = @(Get-GitRequirements $Req)
if ($NeedGit.Count -gt 0) {
    $Git = Enable-Git
    if (-not $Git) {
        Write-Host "• $($NeedGit.Count) dependency/dependencies install from a Git URL, and Git is not installed:"
        foreach ($r in $NeedGit) { Write-Host "    $r" }
        Write-Host '• Installing Git (per-user — no administrator prompt)…'
        # Same ladder, same posture as the Python step above: winget with --scope user first.
        $Git = Install-Git
    }
    if (-not $Git) {
        Write-Host ''
        Write-Host 'SUD Workbench needs Git to finish installing its dependencies, and could not'
        Write-Host 'install it automatically.'
        Write-Host ''
        Write-Host 'Install it yourself, then reopen SUD Workbench:'
        Write-Host '  • winget install Git.Git                     (in a terminal), or'
        Write-Host '  • https://git-scm.com/download/win'
        Write-Host '    — the default options are fine; Git only has to be on your PATH.'
        Write-Host ''
        Read-Host 'Press Enter to close'
        exit 1
    }
    # Enable-Git has already put its directory on this process's PATH, which is what matters: pip
    # runs `git` by name from a child process, and winget's change to the machine PATH does not
    # reach a process that started before it.
    Write-Host "• Using Git: $Git  ($(& $Git --version 2>&1))"
}

# ── 3. create the venv and install the core deps ─────────────────────────────────────────────────
$VenvPy  = Join-Path $Venv 'Scripts\python.exe'
$VenvPyW = Join-Path $Venv 'Scripts\pythonw.exe'
if (-not (Test-Path -LiteralPath $VenvPy)) {
    Write-Host "• Creating the environment at: $Venv"
    & $Py -m venv $Venv
    if ($LASTEXITCODE -ne 0) { Write-Host '! Could not create the environment.'; Read-Host 'Press Enter to close'; exit 1 }
}
Write-Host '• Installing core dependencies (this can take a few minutes on first run)…'
& $VenvPy -m pip install --upgrade pip
& $VenvPy -m pip install -r $Req
if ($LASTEXITCODE -ne 0) {
    Write-Host ''
    Write-Host '! The dependency install failed. The output above says why; the most common causes'
    Write-Host '  are no network access and a corporate proxy that blocks pypi.org.'
    Read-Host 'Press Enter to close'
    exit 1
}

# Sentinel: a completed core install. The launcher checks this (not just the interpreter) so a
# half-built venv from an interrupted run is never mistaken for a ready one. Kept in step with the
# quiet path (setup_venv.ps1), which writes the same marker.
New-Item -ItemType File -Force -Path (Join-Path $Venv '.sud-core-ready') | Out-Null

Write-Host '• Setup complete.'
Write-Rule

# ── 4. launch the app (this window can be closed once the app window appears) ────────────────────
$env:PYTHONPATH = $AppSrc
Set-Location -LiteralPath $AppSrc
# pythonw.exe so the app does not inherit or need a console of its own; Start-Process (not &) so
# this console is free immediately rather than staying tied to the app's lifetime.
Start-Process -FilePath $VenvPyW -ArgumentList (@('-m', 'app') + $AppArgs) -WorkingDirectory $AppSrc
