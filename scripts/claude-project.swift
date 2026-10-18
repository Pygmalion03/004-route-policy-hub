import AppKit

final class ProjectLauncher: NSObject, NSApplicationDelegate {
    var window: NSWindow!
    let status = NSTextField(wrappingLabelWithString: "选择来源项目，创建或打开 Claude 独立副本。目录内自动编辑；越界申请会弹窗。尚未注册也可先准备工作区。")
    let choose = NSButton(title: "准备 Claude 独立工作区", target: nil, action: nil)
    let start = NSButton(title: "在已准备的工作区启动 Claude", target: nil, action: nil)
    let edge = NSButton(title: "打开专用 Edge / 登录", target: nil, action: nil)

    func applicationDidFinishLaunching(_ notification: Notification) {
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 640, height: 360), styleMask: [.titled, .closable, .miniaturizable], backing: .buffered, defer: false)
        window.title = "Claude 项目启动器"
        let heading = NSTextField(labelWithString: "独立工作区 · 自动编辑 · 越界申请")
        heading.font = .boldSystemFont(ofSize: 20)
        choose.target = self
        choose.action = #selector(prepareProject)
        start.target = self
        start.action = #selector(startProject)
        edge.target = self
        edge.action = #selector(openEdge)
        let stack = NSStackView(views: [heading, status, choose, start, edge])
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 18
        stack.translatesAutoresizingMaskIntoConstraints = false
        window.contentView!.addSubview(stack)
        NSLayoutConstraint.activate([stack.leadingAnchor.constraint(equalTo: window.contentView!.leadingAnchor, constant: 25), stack.trailingAnchor.constraint(equalTo: window.contentView!.trailingAnchor, constant: -25), stack.topAnchor.constraint(equalTo: window.contentView!.topAnchor, constant: 25)])
        window.center()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    func quote(_ text: String) -> String { "'" + text.replacingOccurrences(of: "'", with: "'\\''") + "'" }

    @objc func prepareProject() {
        let panel = NSOpenPanel()
        panel.title = "选择来源 Git 项目（只复制已提交代码）"
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.directoryURL = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Documents/Codex/Projects")
        guard panel.runModal() == .OK, let project = panel.url else { return }
        let namePrompt = NSAlert()
        namePrompt.messageText = "给 Claude 工作区命名"
        namePrompt.informativeText = "每个任务可使用不同名称，避免多个 Agent 修改同一目录。仅使用小写字母、数字和短横线。"
        let name = NSTextField(string: "claude")
        name.frame = NSRect(x: 0, y: 0, width: 320, height: 24)
        namePrompt.accessoryView = name
        namePrompt.addButton(withTitle: "准备工作区")
        namePrompt.addButton(withTitle: "取消")
        guard namePrompt.runModal() == .alertFirstButtonReturn else { return }
        do {
            let data = try Data(contentsOf: Bundle.main.resourceURL!.appendingPathComponent("launcher.json"))
            let config = try JSONSerialization.jsonObject(with: data) as! [String: String]
            let process = Process()
            let output = Pipe()
            process.executableURL = URL(fileURLWithPath: "/usr/bin/python3")
            process.arguments = [config["workspace"]!, project.path, "--name", name.stringValue]
            process.standardOutput = output
            process.standardError = output
            try process.run()
            let result = output.fileHandleForReading.readDataToEndOfFile()
            process.waitUntilExit()
            let message = String(data: result, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "准备失败"
            if process.terminationStatus == 0 { UserDefaults.standard.set(message, forKey: "lastWorkspace") }
            status.stringValue = process.terminationStatus == 0 ? "已准备：\(message)。这是独立仓库和分支；未提交改动与未跟踪文件不复制。注册后点下方启动。" : message
        } catch { status.stringValue = "无法准备工作区，请确认来源项目已有 Git 提交。" }
    }

    @objc func startProject() {
        let panel = NSOpenPanel()
        panel.title = "选择 Claude 独立工作区（.claude-workspaces/任务名称）"
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        let data = try? Data(contentsOf: Bundle.main.resourceURL!.appendingPathComponent("launcher.json"))
        let config = data.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: String] }
        let initial = UserDefaults.standard.string(forKey: "lastWorkspace") ?? config?["defaultWorkspace"] ?? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Documents/Codex/Projects").path
        panel.directoryURL = URL(fileURLWithPath: initial)
        panel.showsHiddenFiles = true
        guard panel.runModal() == .OK, let project = panel.url?.resolvingSymlinksInPath() else { return }
        let home = FileManager.default.homeDirectoryForCurrentUser
        guard project != home && project.path != "/" else {
            status.stringValue = "请选择具体项目，不要选择个人主目录或磁盘根目录。"
            return
        }
        guard project.pathComponents.contains(".claude-workspaces"), FileManager.default.fileExists(atPath: project.appendingPathComponent(".git").path) else {
            status.stringValue = "请先准备独立工作区，再选择来源项目下 .claude-workspaces 中的任务文件夹。"
            return
        }
        do {
            let data = try Data(contentsOf: Bundle.main.resourceURL!.appendingPathComponent("launcher.json"))
            let config = try JSONSerialization.jsonObject(with: data) as! [String: String]
            let folder = home.appendingPathComponent("Library/Application Support/Route Policy Hub/launchers")
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
            let command = folder.appendingPathComponent("claude-project.command")
            let text = "#!/bin/zsh\ncd -- " + quote(project.path) + " || exit 1\n" + quote(config["script"]!) + " --project " + quote(project.path) + "\nresult=$?\nif (( result != 0 )); then printf '\\n启动或会话已退出（%s）。按回车关闭。' $result; read; fi\n"
            try text.write(to: command, atomically: true, encoding: .utf8)
            try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: command.path)
            guard NSWorkspace.shared.open(command) else { throw CocoaError(.executableLoad) }
            status.stringValue = "已请求在 Terminal 启动：\(project.lastPathComponent)。终端会先检查固定出口；登录时请点下方专用 Edge。"
        } catch {
            status.stringValue = "无法启动，请检查应用安装和 Terminal 的 .command 文件关联。"
        }
    }

    @objc func openEdge() {
        let app = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Applications/Claude 专用 Edge.app")
        NSWorkspace.shared.openApplication(at: app, configuration: NSWorkspace.OpenConfiguration())
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}

let app = NSApplication.shared
if CommandLine.arguments.count == 5 && CommandLine.arguments[1] == "--approve-path" {
    app.setActivationPolicy(.regular)
    app.finishLaunching()
    app.activate(ignoringOtherApps: true)
    let path = CommandLine.arguments[2]
    let writing = CommandLine.arguments[4] == "write"
    let alert = NSAlert()
    alert.messageText = writing ? "Claude 申请项目外读写" : "Claude 申请项目外读取"
    alert.informativeText = "请求范围：\n\(path)\n\n允许后仅对本次会话生效，启动器会重启并恢复会话。读写文件时需要包含临时文件的父目录。不会改变固定出口。"
    alert.addButton(withTitle: "拒绝")
    alert.addButton(withTitle: writing ? "允许本次会话读写并恢复" : "允许本次会话读取并恢复")
    let result = alert.runModal()
    print(result == .alertSecondButtonReturn ? "allow" : "deny")
    exit(0)
}
let launcher = ProjectLauncher()
app.delegate = launcher
app.setActivationPolicy(.regular)
app.run()
