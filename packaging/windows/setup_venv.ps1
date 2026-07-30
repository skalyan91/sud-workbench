# Quiet, no-prompt first-launch setup for the Windows build of SUD Workbench.
# The direct analogue of packaging/setup_venv.sh.
#
# ONLY creates the per-user venv and pip-installs the CORE deps. It assumes a suitable Python 3.12
# already exists and EXITS 1 if it does not, which is the signal the launcher uses to fall through
# to bootstrap.ps1 (the visible path that can install Python). The heavy Stanza/Japanese/Arabic
# tiers still download on demand at runtime through app/extras.py.
#
# It speaks the same tiny marker vocabulary as the macOS script, on stdout:
#     MSG <text>        → status label
#     PROGRESS <0..1>   → determinate bar fraction
#     DONE              → success
# …with all real pip output going to the log instead of the user's face.
#
# ONE DELIBERATE DIFFERENCE FROM macOS. There, the launcher pipes this script into a separate Swift
# progress binary (`setup_venv.sh 2>setup.log | progress`). Here the window is raised IN THIS SAME
# PROCESS under -Gui, because the pipe version would need a second console-free host process to draw
# it, and every console-free host on Windows (wscript, a compiled shim) is a poor place to sit
# reading a pipe. WinForms costs nothing extra: it ships with Windows, and it is the same toolkit
# pywebview's own Windows backend runs on. The markers are still emitted, so a headless run
# (the installer's [Run] pre-warm step) behaves exactly like the macOS script.
[CmdletBinding()]
param(
    # Raise the WinForms progress window. Off for the installer's pre-warm, where Inno draws its own
    # progress and a second window would be noise.
    [switch]$Gui
)

$ErrorActionPreference = 'Stop'

$Res    = Split-Path -Parent $MyInvocation.MyCommand.Path        # …\SUD Workbench\setup
$AppSup = Join-Path $env:LOCALAPPDATA 'SUD Workbench'
$Venv   = Join-Path $AppSup 'venv'
$Log    = Join-Path $AppSup 'setup.log'
New-Item -ItemType Directory -Force -Path $AppSup | Out-Null

. (Join-Path $Res 'find_py.ps1')
. (Join-Path $Res 'find_git.ps1')

$Req = Join-Path $Res 'requirements-core.txt'

# ── the marker channel + (optionally) the window that reads it ───────────────────────────────────
$script:Form = $null; $script:Bar = $null; $script:Label = $null

function Start-Gui {
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    [System.Windows.Forms.Application]::EnableVisualStyles()

    $f = New-Object System.Windows.Forms.Form
    $f.Text = 'SUD Workbench'
    $f.FormBorderStyle = 'FixedDialog'          # not resizable: it is a progress sheet, not a window
    $f.MaximizeBox = $false; $f.MinimizeBox = $false
    $f.StartPosition = 'CenterScreen'
    $f.ClientSize = New-Object System.Drawing.Size(420, 120)
    $f.TopMost = $true                          # first launch: nothing else of ours is on screen yet

    $ico = Join-Path (Split-Path -Parent $Res) 'icon\appicon.ico'
    if (Test-Path -LiteralPath $ico) { $f.Icon = New-Object System.Drawing.Icon($ico) }

    $title = New-Object System.Windows.Forms.Label
    $title.Text = 'Setting up SUD Workbench'
    $title.Font = New-Object System.Drawing.Font($f.Font.FontFamily, 11, [System.Drawing.FontStyle]::Bold)
    $title.SetBounds(20, 18, 380, 22)

    $lbl = New-Object System.Windows.Forms.Label
    $lbl.Text = 'Starting…'
    $lbl.SetBounds(20, 44, 380, 20)

    $bar = New-Object System.Windows.Forms.ProgressBar
    $bar.Style = 'Continuous'; $bar.Minimum = 0; $bar.Maximum = 1000
    $bar.SetBounds(20, 72, 380, 18)

    $f.Controls.AddRange(@($title, $lbl, $bar))
    $f.Show()
    [System.Windows.Forms.Application]::DoEvents()

    $script:Form = $f; $script:Bar = $bar; $script:Label = $lbl
}

function Say([string]$text) {
    Write-Output "MSG $text"
    if ($script:Label) {
        $script:Label.Text = $text
        # DoEvents is what keeps the window painting: this script is a single thread that spends
        # most of its life blocked in pip, so nothing else will pump the message queue for us.
        [System.Windows.Forms.Application]::DoEvents()
    }
}

function Bar([double]$frac) {
    Write-Output ("PROGRESS {0:N3}" -f $frac)
    if ($script:Bar) {
        $script:Bar.Value = [int][Math]::Round([Math]::Max(0, [Math]::Min(1, $frac)) * 1000)
        [System.Windows.Forms.Application]::DoEvents()
    }
}

function Log([string]$line) { Add-Content -LiteralPath $Log -Value $line -Encoding UTF8 }

if ($Gui) { Start-Gui }

try {
    Set-Content -LiteralPath $Log -Value "SUD Workbench setup — $(Get-Date -Format o)" -Encoding UTF8

    Bar 0.05
    Say 'Locating Python 3.12…'
    $Py = Find-Py
    if (-not $Py) {
        # The launcher should not have taken this path without a Python 3.12; bail so it can fall
        # through to bootstrap.ps1, which is allowed to install one.
        Log 'setup_venv: no python 3.12 found'
        if ($script:Form) { $script:Form.Close() }
        exit 1
    }
    Log "Using Python: $Py ($(& $Py --version 2>&1))"

    # ── git, BEFORE the venv is built and long before pip runs ──────────────────────────────────
    # requirements-core.txt installs wiktra from a `git+` URL, and pip shells out to git to do it.
    # Windows ships no git, so without this the first launch on a bare machine spent several minutes
    # in pip and then died on "Cannot find command 'git'" with the venv half-built. Checked here so
    # the failure is instant and legible, and reported through the same marker channel as everything
    # else, so the progress window says what is wrong instead of vanishing. The need is read off the
    # requirements file itself, so switching those lines to archive URLs disarms the check for free.
    Bar 0.10
    Say 'Checking prerequisites…'
    $needGit = @(Get-GitRequirements $Req)
    if ($needGit.Count -gt 0 -and -not (Enable-Git)) {
        Log "setup_venv: $($needGit.Count) requirement(s) install from a git+ URL and Git is not installed:"
        foreach ($r in $needGit) { Log "  $r" }
        Say 'Git is required — opening setup…'
        # Exit 1 to fall through to bootstrap.ps1, which is allowed to INSTALL git (a second program
        # installed silently behind a progress bar nobody can read is not a thing to do). Same
        # division of labour as the Python 3.12 case immediately above. The brief hold is so the
        # message is actually readable before the window closes and the console one opens.
        if ($script:Form) { Start-Sleep -Milliseconds 1200 }
        if ($script:Form) { $script:Form.Close() }
        exit 1
    }

    Bar 0.15
    Say 'Creating the environment…'
    $VenvPy = Join-Path $Venv 'Scripts\python.exe'
    if (-not (Test-Path -LiteralPath $VenvPy)) {
        & $Py -m venv $Venv 2>&1 | ForEach-Object { Log $_ }
        if ($LASTEXITCODE -ne 0) { throw "python -m venv failed (exit $LASTEXITCODE)" }
    }

    Bar 0.35
    Say 'Upgrading pip…'
    & $VenvPy -m pip install --upgrade pip 2>&1 | ForEach-Object { Log $_ }

    Bar 0.55
    Say 'Installing dependencies (this can take a few minutes)…'
    # Coarse progress, same trick as the macOS script: nudge the bar on each "Collecting"/
    # "Downloading" line pip prints, capped short of the final phase so it never sits at 100 %
    # through a long install step. All pip chatter goes to the log, never to the marker channel.
    $frac = 0.55
    & $VenvPy -m pip install -r $Req 2>&1 | ForEach-Object {
        Log $_
        if ($_ -match '^\s*(Collecting|Downloading|Building|Installing)') {
            $frac = [Math]::Min(0.9, $frac + 0.03)
            Bar $frac
        } elseif ($script:Form) {
            # Pump the message queue on every line even when the bar doesn't move — pip can spend a
            # minute on one wheel, and a WinForms window that stops painting reads as a hang.
            [System.Windows.Forms.Application]::DoEvents()
        }
    }
    if ($LASTEXITCODE -ne 0) { throw "pip install failed (exit $LASTEXITCODE) — see $Log" }

    Bar 0.97
    Say 'Finishing up…'
    # Sentinel: a COMPLETED core install. The launcher checks this, not just the interpreter, so a
    # half-built venv from an interrupted run is never mistaken for a ready one. Same filename as
    # the macOS side so the two bootstraps stay legible against each other.
    New-Item -ItemType File -Force -Path (Join-Path $Venv '.sud-core-ready') | Out-Null

    Bar 1.0
    Write-Output 'DONE'
    if ($script:Form) { $script:Form.Close() }
    exit 0
}
catch {
    Log "ERROR: $_"
    if ($script:Form) { $script:Form.Close() }
    # Non-zero, no dialog: the launcher's next step is bootstrap.ps1, which re-runs the same work in
    # a visible console where the user can actually read what went wrong.
    exit 2
}
