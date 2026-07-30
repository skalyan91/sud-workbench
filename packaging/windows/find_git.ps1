# Shared Git detection for SUD Workbench's Windows first-launch setup scripts.
# Dot-sourced, like find_py.ps1; defines Find-Git / Enable-Git / Get-GitRequirements / Install-Git.
#
# WHY THIS EXISTS AT ALL, AND WHY IT HAS NO macOS COUNTERPART.
# requirements-core.txt pins wiktra as `wiktra @ git+https://github.com/twardoch/wiktra2`, and the
# full requirements.txt adds spacy-stanza the same way. pip installs a `git+` requirement by SHELLING
# OUT TO git — it has no built-in client. macOS always has one: `git` is a Command Line Tools shim
# that is either already installed or prompts to install itself, so the requirement has never needed
# a thought. Windows ships NO git whatsoever, so on a bare machine the first-launch venv build died
# part-way through a multi-minute pip run with pip's own "Cannot find command 'git'" — a message that
# tells the user nothing they can act on, arriving after they had already waited.
#
# The fix is the same shape as the Python 3.12 ladder in bootstrap.ps1: detect BEFORE the long pip
# run, offer winget, and otherwise say plainly what to install. The requirements file itself is left
# alone — it is shared with the macOS track, where the `git+` form is both correct and free.
#
# Get-GitRequirements derives the need FROM THE FILE rather than hard-coding "wiktra needs git", so
# if those requirements are ever rewritten as plain archive URLs the whole check disables itself and
# nobody has to remember to come back here and delete it.

function Get-GitRequirements {
    <#  The `git+` lines of a requirements file, comments and blanks skipped. Returns an array;
        callers should wrap the call in @(…), because PowerShell unrolls a one-element array and
        turns an empty one into $null. #>
    param([string]$Path)

    $hits = New-Object System.Collections.Generic.List[string]
    if (-not (Test-Path -LiteralPath $Path)) { return $hits.ToArray() }
    foreach ($line in Get-Content -LiteralPath $Path) {
        $t = $line.Trim()
        if ($t -eq '' -or $t.StartsWith('#')) { continue }
        # Match the URL scheme, not a package name: `git+https`, `git+ssh`, `git+file` all shell out.
        if ($t -match 'git\+[a-z]+:') { $hits.Add($t) | Out-Null }
    }
    return $hits.ToArray()
}

function Test-Git {
    param([string]$Path)

    if (-not $Path) { return $false }
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $false }
    try {
        $v = & $Path --version 2>$null
        return ($LASTEXITCODE -eq 0 -and $v -match '^git version')
    } catch {
        return $false
    }
}

function Find-Git {
    $candidates = New-Object System.Collections.Generic.List[string]

    # PATH first — an existing install, or one winget put there for a NEW shell.
    $c = Get-Command git.exe -ErrorAction SilentlyContinue -CommandType Application
    foreach ($hit in @($c)) { if ($hit) { $candidates.Add($hit.Source) } }

    # Then the well-known Git-for-Windows layouts. This list is not belt-and-braces: winget installs
    # git into the CURRENT process's environment not at all — %PATH% is inherited at process start
    # and our copy is already stale — so immediately after Install-Git the ONLY way to find the new
    # binary is by path. Per-user location first, since that is what `--scope user` produces.
    $candidates.Add("$env:LOCALAPPDATA\Programs\Git\cmd\git.exe")
    $candidates.Add("$env:ProgramFiles\Git\cmd\git.exe")
    $candidates.Add("${env:ProgramFiles(x86)}\Git\cmd\git.exe")

    foreach ($p in $candidates) {
        if (Test-Git $p) { return $p }
    }
    return $null
}

function Enable-Git {
    <#  Find git AND make sure pip's child processes can see it. Returning the path is not enough:
        pip runs `git` by NAME, so the directory has to be on this process's %PATH% for the venv
        build to work in the same session it was installed in. #>
    $git = Find-Git
    if (-not $git) { return $null }
    $dir = Split-Path -Parent $git
    if (($env:PATH -split ';') -notcontains $dir) { $env:PATH = "$dir;$env:PATH" }
    return $git
}

function Install-Git {
    <#  Try winget, per-user so there is no UAC prompt — the same posture as the Python step and as
        the installer itself. Returns the git path on success, $null otherwise. Only ever called
        from bootstrap.ps1, the VISIBLE path: an unattended install of a second program is not
        something to do behind a progress bar the user cannot read. #>
    $winget = Get-Command winget.exe -ErrorAction SilentlyContinue
    if (-not $winget) { return $null }

    & $winget.Source install --id Git.Git --source winget --scope user `
        --accept-package-agreements --accept-source-agreements --silent
    return (Enable-Git)
}
