' SUD Workbench — Windows stage-0 launcher, FALLBACK shape.
'
' Used when the build box has no Windows C toolchain (see make_win_app.py's launcher section);
' launcher.c is the preferred shape and this file mirrors its logic line for line.
'
' Why a .vbs and not a .cmd/.ps1: the app must never flash a console window — that is the classic
' tell of a Python program in Windows clothing. wscript.exe is a GUI-subsystem host, so a script it
' runs has no console at all, and WshShell.Run's intWindowStyle lets us start the *setup* helpers
' hidden too. cmd.exe and powershell.exe are console-subsystem hosts and cannot offer that: even
' `-WindowStyle Hidden` creates the console first and hides it afterwards, which flickers.
'
' Cost of this shape, spelled out because it is a stopgap: the shortcut target is wscript.exe with
' this script as an argument, so the icon comes from the .lnk (Inno's IconFilename) rather than from
' a binary, taskbar grouping is less clean, and Microsoft has deprecated VBScript — Windows 11 24H2
' demoted it to a Feature-on-Demand (still installed by default) and has announced removal in a
' future release. Install mingw-w64 or zig on the build box and rebuild to get the real .exe.
Option Explicit

Dim fso, sh, InstallDir, LocalApp, Venv, PythonW, Sentinel, AppSrc, ArgStr, i

Set fso = CreateObject("Scripting.FileSystemObject")
Set sh  = CreateObject("WScript.Shell")

InstallDir = fso.GetParentFolderName(WScript.ScriptFullName)
LocalApp   = sh.ExpandEnvironmentStrings("%LOCALAPPDATA%")
Venv       = LocalApp & "\SUD Workbench\venv"
PythonW    = Venv & "\Scripts\pythonw.exe"
Sentinel   = Venv & "\.sud-core-ready"
AppSrc     = InstallDir & "\appsrc"

' Re-quote the arguments we were handed (the .conllu path, when launched by double-click) so a path
' with spaces survives the hand-off to Python.
ArgStr = ""
For i = 0 To WScript.Arguments.Count - 1
  ArgStr = ArgStr & " """ & WScript.Arguments(i) & """"
Next

' ── 1. ready venv → run the app ────────────────────────────────────────────────────────────────
' Both the interpreter AND the .sud-core-ready sentinel are required: a venv left half-built by an
' interrupted install must never be mistaken for a ready one.
If fso.FileExists(PythonW) And fso.FileExists(Sentinel) Then RunApp

' ── 2. fast path: quiet setup behind a WinForms progress window ────────────────────────────────
' Window style 0 = hidden, bWaitOnReturn = True. setup_venv.ps1 exits non-zero when it cannot find
' a Python 3.12, which is how we fall through to (3) without this script knowing anything about
' Python discovery. -ExecutionPolicy Bypass because a shipped .ps1 is otherwise refused under the
' default policy; -NoProfile so a user's $PROFILE cannot break setup.
sh.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & _
       InstallDir & "\setup\setup_venv.ps1"" -Gui", 0, True

If fso.FileExists(PythonW) And fso.FileExists(Sentinel) Then RunApp

' ── 3. slow path: VISIBLE console, where Python itself may have to be installed ────────────────
' The analogue of the macOS launcher's Terminal path: winget / the python.org installer print and
' prompt here, and bootstrap.ps1 launches the app itself when it finishes.
sh.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & _
       InstallDir & "\setup\bootstrap.ps1""" & ArgStr, 1, False
WScript.Quit 0


Sub RunApp()
  ' pythonw.exe, not python.exe: pythonw is a GUI-subsystem build of the interpreter, so the app
  ' runs with no console of its own. PYTHONPATH + the working directory are set exactly as the
  ' macOS launcher's run_app() sets them; WshShell's "PROCESS" environment is inherited by children.
  sh.Environment("PROCESS")("PYTHONPATH") = AppSrc
  sh.CurrentDirectory = AppSrc
  sh.Run """" & PythonW & """ -m app" & ArgStr, 1, False
  WScript.Quit 0
End Sub
