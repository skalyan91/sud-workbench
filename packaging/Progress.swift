// Progress.swift — a tiny, dependency-free AppKit progress window for SUD Workbench's first-launch
// venv setup. Instead of a scary Terminal, the user sees a friendly native window: the app icon, a
// status line and a determinate progress bar.
//
// It reads a simple line-based marker protocol on stdin (written by setup_venv.sh):
//     PROGRESS <0..1>   → set the bar fraction
//     MSG <text>        → set the status label
//     DONE              → close the window and terminate
// On stdin EOF (the setup script exited) it also terminates. Only Foundation/AppKit/Cocoa are used,
// and no colour scheme is forced — the window inherits the system light/dark appearance for a native
// Tahoe look. Compiled to a universal binary at build time and bundled at Contents/Resources/progress.
//
// Australian English throughout.

import Cocoa

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var window: NSWindow!
    private var statusLabel: NSTextField!
    private var progressBar: NSProgressIndicator!

    func applicationDidFinishLaunching(_ note: Notification) {
        buildWindow()
        // Read stdin on a background thread; every UI touch is hopped back onto the main thread.
        Thread.detachNewThread { [weak self] in self?.readLoop() }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ app: NSApplication) -> Bool { true }

    // MARK: - UI

    private func buildWindow() {
        let width: CGFloat = 440, height: CGFloat = 168
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: width, height: height),
                          styleMask: [.titled],
                          backing: .buffered, defer: false)
        window.title = "SUD Workbench"
        window.isMovableByWindowBackground = true
        window.center()
        // Deliberately no window.appearance override — inherit the system theme.

        let content = window.contentView!

        // App icon. Path comes from argv[1] (the launcher passes AppIcon.icns), then the SUDWB_ICON
        // env var, then the generic application icon as a last resort.
        let iconSize: CGFloat = 72
        let iconView = NSImageView(frame: NSRect(x: 24, y: height - iconSize - 26,
                                                 width: iconSize, height: iconSize))
        iconView.imageScaling = .scaleProportionallyUpOrDown
        if let img = loadIcon() { iconView.image = img }
        content.addSubview(iconView)

        let textX: CGFloat = 24 + iconSize + 18
        let textW: CGFloat = width - textX - 24

        let title = NSTextField(labelWithString: "Setting up SUD Workbench")
        title.font = NSFont.systemFont(ofSize: 15, weight: .semibold)
        title.frame = NSRect(x: textX, y: height - 56, width: textW, height: 22)
        content.addSubview(title)

        statusLabel = NSTextField(labelWithString: "Preparing…")
        statusLabel.font = NSFont.systemFont(ofSize: 12)
        statusLabel.textColor = .secondaryLabelColor
        statusLabel.lineBreakMode = .byTruncatingTail
        statusLabel.frame = NSRect(x: textX, y: height - 80, width: textW, height: 18)
        content.addSubview(statusLabel)

        progressBar = NSProgressIndicator(frame: NSRect(x: textX, y: height - 112,
                                                        width: textW, height: 16))
        progressBar.style = .bar
        progressBar.isIndeterminate = false
        progressBar.minValue = 0
        progressBar.maxValue = 1
        progressBar.doubleValue = 0
        content.addSubview(progressBar)

        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    private func loadIcon() -> NSImage? {
        var path: String? = nil
        let args = CommandLine.arguments
        if args.count > 1, !args[1].isEmpty { path = args[1] }
        if path == nil { path = ProcessInfo.processInfo.environment["SUDWB_ICON"] }
        if let p = path, !p.isEmpty, let img = NSImage(contentsOfFile: p) { return img }
        return NSImage(named: NSImage.applicationIconName)
    }

    // MARK: - stdin marker loop

    private func readLoop() {
        // readLine() blocks on stdin and returns nil at EOF — perfect for a background reader thread.
        while let raw = readLine(strippingNewline: true) {
            handle(line: raw.trimmingCharacters(in: .whitespaces))
        }
        // stdin closed → the setup script has exited; tear down.
        DispatchQueue.main.async { NSApp.terminate(nil) }
    }

    private func handle(line: String) {
        if line.isEmpty { return }
        if line == "DONE" {
            DispatchQueue.main.async {
                self.progressBar.doubleValue = 1
                NSApp.terminate(nil)
            }
            return
        }
        if line.hasPrefix("PROGRESS ") {
            let tail = line.dropFirst("PROGRESS ".count).trimmingCharacters(in: .whitespaces)
            let v = max(0, min(1, Double(tail) ?? 0))
            DispatchQueue.main.async { self.progressBar.doubleValue = v }
            return
        }
        if line.hasPrefix("MSG ") {
            let msg = String(line.dropFirst("MSG ".count))
            DispatchQueue.main.async { self.statusLabel.stringValue = msg }
            return
        }
        // Unknown lines are ignored, keeping the protocol forgiving.
    }
}

let app = NSApplication.shared
app.setActivationPolicy(.regular)
let delegate = AppDelegate()
app.delegate = delegate
app.run()
