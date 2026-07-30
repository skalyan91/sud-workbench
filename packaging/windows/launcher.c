/* SUD Workbench — Windows stage-0 launcher.
 *
 * Compiled for the GUI subsystem (-mwindows / /SUBSYSTEM:WINDOWS), so the process is created with
 * NO console attached and none can flash. That is the entire reason this exists as a C file rather
 * than a .cmd: cmd.exe and powershell.exe are console-subsystem hosts, and even `-WindowStyle
 * Hidden` creates the console before hiding it, which flickers on every launch.
 *
 * It is the exact analogue of the `Contents/MacOS/SUD Workbench` bash launcher, with the same three
 * ordered cases:
 *
 *   1. venv already built (pythonw.exe present AND the .sud-core-ready sentinel present)
 *        → run the app.  The sentinel, not just the interpreter, is what is tested: a venv left
 *          half-built by an interrupted install must never be mistaken for a ready one.
 *   2. otherwise → FAST PATH: setup_venv.ps1 -Gui, run hidden and waited on. That script exits
 *        non-zero when it cannot find a Python 3.12, which is how we fall through to (3) without
 *        this launcher needing to know anything about Python discovery.
 *   3. otherwise → SLOW PATH: bootstrap.ps1 in a VISIBLE console, where winget / the python.org
 *        installer can print and prompt (the analogue of the macOS Terminal path).
 *
 * Build (cross-compiles cleanly from macOS — see make_win_app.py):
 *   x86_64-w64-mingw32-gcc launcher.c -o "SUD Workbench.exe" -mwindows -Os -municode -lshell32
 *   zig cc -target x86_64-windows-gnu launcher.c -o "SUD Workbench.exe" -mwindows -Os -municode -lshell32
 *
 * No icon resource is embedded: doing so needs windres/`zig rc`, which is one more toolchain
 * dependency for a build box that may have none. The shortcuts get their icon from Inno's
 * [Icons] IconFilename and documents from the ProgID's DefaultIcon, both pointing at
 * icon\appicon.ico, so the icon is correct everywhere the user actually sees it. Add a .rc here if
 * the bare Explorer listing of the install directory ever matters.
 */
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <shlobj.h>
#include <shellapi.h>
#include <stdio.h>
#include <wchar.h>

/* Formatting goes through _snwprintf, NOT the tempting wsprintfW: wsprintfW's output buffer is
 * capped at 1024 characters by the API contract, and %LOCALAPPDATA% + a deep install path can get
 * uncomfortably close to that once a document path is appended. _snwprintf is bounded by the buffer
 * we hand it and is present in both the mingw-w64 and MSVC CRTs. */
#define FMT(buf, ...) do { _snwprintf((buf), BUFSZ - 1, __VA_ARGS__); (buf)[BUFSZ - 1] = L'\0'; } while (0)

#define APP_DIRNAME L"SUD Workbench"
#define BUFSZ 4096

static void die(const wchar_t *msg)
{
    /* GUI subsystem: there is nowhere to print, so a message box IS the error channel. */
    MessageBoxW(NULL, msg, L"SUD Workbench", MB_ICONERROR | MB_OK);
}

static BOOL exists(const wchar_t *path)
{
    return GetFileAttributesW(path) != INVALID_FILE_ATTRIBUTES;
}

/* Spawn `cmdline` (a full, already-quoted command line) and optionally wait for it.
 * `show` is SW_HIDE or SW_SHOWNORMAL; `flags` carries CREATE_NEW_CONSOLE where a visible console is
 * wanted. Returns the child's exit code, or -1 if it could not be started. */
static int spawn(const wchar_t *cmdline, const wchar_t *cwd, WORD show, DWORD flags, BOOL wait)
{
    STARTUPINFOW si;
    PROCESS_INFORMATION pi;
    wchar_t mutable_cmd[BUFSZ];
    DWORD code = 0;

    /* CreateProcessW may WRITE to lpCommandLine, so it must not be a string literal. */
    lstrcpynW(mutable_cmd, cmdline, BUFSZ);

    ZeroMemory(&si, sizeof(si));
    si.cb = sizeof(si);
    si.dwFlags = STARTF_USESHOWWINDOW;
    si.wShowWindow = show;
    ZeroMemory(&pi, sizeof(pi));

    if (!CreateProcessW(NULL, mutable_cmd, NULL, NULL, FALSE, flags, NULL, cwd, &si, &pi))
        return -1;
    if (wait) {
        WaitForSingleObject(pi.hProcess, INFINITE);
        GetExitCodeProcess(pi.hProcess, &code);
    }
    CloseHandle(pi.hThread);
    CloseHandle(pi.hProcess);
    return wait ? (int)code : 0;
}

/* Re-quote argv[1..] into a single string, so a path with spaces ("C:\My Docs\a.conllu") survives
 * being handed on to Python. argv[0] is dropped: we are replacing this process, not nesting it. */
static void collect_args(wchar_t *out, size_t cap)
{
    int argc = 0, i;
    LPWSTR *argv = CommandLineToArgvW(GetCommandLineW(), &argc);
    out[0] = L'\0';
    if (!argv)
        return;
    for (i = 1; i < argc; i++) {
        if (wcslen(out) + wcslen(argv[i]) + 4 >= cap)
            break;
        lstrcatW(out, L" \"");
        lstrcatW(out, argv[i]);
        lstrcatW(out, L"\"");
    }
    LocalFree(argv);
}

/* wWinMain, not wmain: with -mwindows (or /SUBSYSTEM:WINDOWS) the CRT entry point becomes
 * wWinMainCRTStartup, which calls wWinMain — declaring wmain instead links only by accident and
 * fails outright under MSVC. Arguments come from GetCommandLineW() in collect_args() rather than
 * from lpCmdLine, because lpCmdLine is already argv[0]-stripped in a way that differs between CRTs
 * and we need identical quoting on both. */
int WINAPI wWinMain(HINSTANCE hInst, HINSTANCE hPrev, PWSTR lpCmdLine, int nShow)
{
    wchar_t self[BUFSZ], install[BUFSZ], localapp[BUFSZ];
    wchar_t venv[BUFSZ], pythonw[BUFSZ], sentinel[BUFSZ], appsrc[BUFSZ];
    wchar_t args[BUFSZ], cmd[BUFSZ];
    wchar_t *slash;

    /* All four wWinMain parameters are unused — see the note above on why arguments come from
     * GetCommandLineW instead. Named and discarded rather than omitted, because the signature is
     * fixed by the CRT. */
    (void)hInst; (void)hPrev; (void)lpCmdLine; (void)nShow;

    /* Install directory = the directory this executable sits in. */
    if (!GetModuleFileNameW(NULL, self, BUFSZ)) {
        die(L"Could not determine the SUD Workbench install location.");
        return 1;
    }
    lstrcpynW(install, self, BUFSZ);
    slash = wcsrchr(install, L'\\');
    if (!slash) {
        die(L"Could not determine the SUD Workbench install location.");
        return 1;
    }
    *slash = L'\0';

    /* Per-user data root. SHGetFolderPathW/CSIDL is used rather than SHGetKnownFolderPath because it
     * needs no KNOWNFOLDERID symbol from a separate import library — one less thing for a
     * cross-compiler to have to supply. It resolves to exactly the same %LOCALAPPDATA%. */
    if (SHGetFolderPathW(NULL, CSIDL_LOCAL_APPDATA, NULL, SHGFP_TYPE_CURRENT, localapp) != S_OK) {
        die(L"Could not locate your Local AppData folder.");
        return 1;
    }

    FMT(venv, L"%s\\%s\\venv", localapp, APP_DIRNAME);
    FMT(pythonw, L"%s\\Scripts\\pythonw.exe", venv);
    FMT(sentinel, L"%s\\.sud-core-ready", venv);
    FMT(appsrc, L"%s\\appsrc", install);
    collect_args(args, BUFSZ);

    /* ── 1. ready venv → run the app ─────────────────────────────────────────────────────────── */
    /* pythonw.exe, not python.exe: pythonw is itself a GUI-subsystem build of the interpreter, so
     * the app runs for the rest of the session with no console of its own. PYTHONPATH + the working
     * directory are set exactly as the macOS launcher's run_app() sets them. */
    if (exists(pythonw) && exists(sentinel)) {
        SetEnvironmentVariableW(L"PYTHONPATH", appsrc);
        FMT(cmd, L"\"%s\" -m app%s", pythonw, args);
        if (spawn(cmd, appsrc, SW_SHOWNORMAL, 0, FALSE) == 0)
            return 0;
        /* Fell through: the venv looked ready but would not start. Let setup repair it. */
    }

    /* ── 2. fast path: quiet setup behind a WinForms progress window ─────────────────────────── */
    /* -ExecutionPolicy Bypass because a shipped .ps1 is otherwise refused under the default
     * RemoteSigned/Restricted policy, and -NoProfile so a user's $PROFILE cannot break setup.
     * CREATE_NO_WINDOW keeps powershell.exe's own console from ever materialising; the progress
     * window the script raises is WinForms, drawn by the script itself. */
    FMT(cmd, L"powershell.exe -NoProfile -ExecutionPolicy Bypass -File \"%s\\setup\\setup_venv.ps1\" -Gui",
              install);
    spawn(cmd, install, SW_HIDE, CREATE_NO_WINDOW, TRUE);

    if (exists(pythonw) && exists(sentinel)) {
        SetEnvironmentVariableW(L"PYTHONPATH", appsrc);
        FMT(cmd, L"\"%s\" -m app%s", pythonw, args);
        if (spawn(cmd, appsrc, SW_SHOWNORMAL, 0, FALSE) == 0)
            return 0;
    }

    /* ── 3. slow path: visible console, where Python itself may have to be installed ──────────── */
    FMT(cmd, L"powershell.exe -NoProfile -ExecutionPolicy Bypass -File \"%s\\setup\\bootstrap.ps1\"%s",
              install, args);
    if (spawn(cmd, install, SW_SHOWNORMAL, CREATE_NEW_CONSOLE, FALSE) < 0) {
        die(L"SUD Workbench could not start its first-run setup.\n\n"
            L"Windows PowerShell was not found. Reinstall SUD Workbench, or install "
            L"Python 3.12 from python.org and try again.");
        return 1;
    }
    return 0;
}
