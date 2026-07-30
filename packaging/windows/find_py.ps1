# Shared Python 3.12 detection for SUD Workbench's Windows launcher and first-launch setup scripts.
# The direct analogue of packaging/find_py.sh: this file is DOT-SOURCED, not executed, and only
# defines Find-Py, which returns the path of a suitable python.exe or $null.
#
# Why 3.12 specifically and not "any 3.x": spaCy/thinc and (in the heavy tier) torch wheels are
# unreliable outside 3.12 — the same pin the macOS side keeps and the reason requirements.txt says so.

function Test-Py312 {
    param([string]$Path)

    if (-not $Path) { return $false }
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $false }

    # NEVER probe the Microsoft Store execution aliases in %LOCALAPPDATA%\Microsoft\WindowsApps:
    # when the Store package is not installed those are zero-length reparse points whose only
    # behaviour is to OPEN THE STORE. Running one to ask its version would pop the Store app in the
    # user's face mid-launch. Rejected by path, before anything is executed.
    if ($Path -like "*\Microsoft\WindowsApps\*") { return $false }

    try {
        # Ask the interpreter itself rather than trusting the directory name — a Python312 folder can
        # hold anything, and `py -3.12` can be satisfied by a store/venv redirect.
        $v = & $Path -c "import sys; print('%d.%d' % sys.version_info[:2])" 2>$null
        return ($LASTEXITCODE -eq 0 -and $v -and $v.Trim() -eq '3.12')
    } catch {
        return $false
    }
}

function Find-Py {
    $candidates = New-Object System.Collections.Generic.List[string]

    # 1) The Windows Python launcher (py.exe). This is the closest thing Windows has to "ask the
    #    package manager where python is": it reads the registry entries every python.org installer
    #    writes, so it finds per-user AND all-users installs without us enumerating paths.
    $py = Get-Command py.exe -ErrorAction SilentlyContinue
    if ($py) {
        try {
            $p = & $py.Source -3.12 -c "import sys; print(sys.executable)" 2>$null
            if ($LASTEXITCODE -eq 0 -and $p) { $candidates.Add($p.Trim()) }
        } catch { }
    }

    # 2) The default locations of the python.org installer — per-user first, because that is what
    #    bootstrap.ps1 installs (InstallAllUsers=0, no admin prompt) and what most users already have.
    $candidates.Add("$env:LOCALAPPDATA\Programs\Python\Python312\python.exe")
    $candidates.Add("$env:ProgramFiles\Python312\python.exe")
    $candidates.Add("${env:ProgramFiles(x86)}\Python312\python.exe")
    $candidates.Add("C:\Python312\python.exe")

    # 3) Whatever is on PATH, last: it is the least predictable (it may be a venv, a conda shim, or
    #    a Store alias) and is only worth trying once the well-known layouts have missed.
    foreach ($n in @('python3.12.exe', 'python.exe')) {
        $c = Get-Command $n -ErrorAction SilentlyContinue -CommandType Application
        foreach ($hit in @($c)) { if ($hit) { $candidates.Add($hit.Source) } }
    }

    foreach ($c in $candidates) {
        if (Test-Py312 $c) { return $c }
    }
    return $null
}
