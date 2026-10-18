import AppKit

final class Launcher: NSObject, NSApplicationDelegate {
    var window: NSWindow!
    let status = NSTextField(wrappingLabelWithString: "正在检查固定出口与 LuLu…")
    let button = NSButton(title: "打开专用 Edge", target: nil, action: nil)
    let checkButton = NSButton(title: "检查网络", target: nil, action: nil)
    var busy = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 620, height: 320), styleMask: [.titled, .closable, .miniaturizable], backing: .buffered, defer: false)
        window.title = "Claude 专用 Edge"
        let heading = NSTextField(labelWithString: "固定出口 · 与日常上网分开")
        heading.font = .boldSystemFont(ofSize: 19)
        let note = NSTextField(wrappingLabelWithString: "请保持 Clash 和 LuLu 运行。代理不可用或出口不符时，启动器会停止打开浏览器。")
        status.textColor = .secondaryLabelColor
        button.target = self
        button.action = #selector(openBrowser)
        button.bezelStyle = .rounded
        checkButton.target = self
        checkButton.action = #selector(checkNetwork)
        checkButton.bezelStyle = .rounded
        let actions = NSStackView(views: [button, checkButton])
        actions.spacing = 12
        let stack = NSStackView(views: [heading, note, actions, status])
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 14
        stack.translatesAutoresizingMaskIntoConstraints = false
        window.contentView!.addSubview(stack)
        NSLayoutConstraint.activate([stack.leadingAnchor.constraint(equalTo: window.contentView!.leadingAnchor, constant: 25), stack.trailingAnchor.constraint(equalTo: window.contentView!.trailingAnchor, constant: -25), stack.topAnchor.constraint(equalTo: window.contentView!.topAnchor, constant: 25)])
        window.center()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        openBrowser()
    }

    @objc func openBrowser() {
        run("browser")
    }

    @objc func checkNetwork() {
        run("check")
    }

    func run(_ mode: String) {
        if busy { return }
        busy = true
        button.isEnabled = false
        checkButton.isEnabled = false
        status.stringValue = "正在检查固定出口与 LuLu…"
        DispatchQueue.global().async {
            var message = "启动失败，请检查本机安装。"
            var succeeded = false
            do {
                let data = try Data(contentsOf: Bundle.main.resourceURL!.appendingPathComponent("launcher.json"))
                let config = try JSONSerialization.jsonObject(with: data) as! [String: String]
                let process = Process()
                let output = Pipe()
                process.executableURL = URL(fileURLWithPath: "/usr/bin/arch")
                process.arguments = ["-arm64", "/usr/bin/python3", config["script"]!, mode]
                process.standardOutput = output
                process.standardError = output
                try process.run()
                let result = output.fileHandleForReading.readDataToEndOfFile()
                process.waitUntilExit()
                succeeded = process.terminationStatus == 0
                message = String(data: result, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? message
            } catch { }
            let result = message
            let success = succeeded
            DispatchQueue.main.async {
                self.status.stringValue = result
                self.status.textColor = success ? .secondaryLabelColor : .systemRed
                self.busy = false
                self.button.isEnabled = true
                self.checkButton.isEnabled = true
            }
        }
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}

let app = NSApplication.shared
let launcher = Launcher()
app.delegate = launcher
app.setActivationPolicy(.regular)
app.run()
