import ExpoModulesCore
import Foundation
import Network
import UIKit

public class ExpoProfileInstallerModule: Module {
    private var server: MobileConfigProfileServer?

    public func definition() -> ModuleDefinition {
        Name("ExpoProfileInstaller")

        AsyncFunction("openMobileConfigAsync") { (base64Content: String, fileName: String, promise: Promise) in
            guard let data = Data(base64Encoded: base64Content) else {
                promise.resolve(false)
                return
            }

            DispatchQueue.main.async {
                self.server?.stop()
                let server = MobileConfigProfileServer(data: data, fileName: fileName)
                self.server = server
                server.open { [weak self, weak server] success in
                    if self?.server === server {
                        self?.server = nil
                    }
                    promise.resolve(success)
                }
            }
        }
    }
}

private final class MobileConfigProfileServer {
    private let data: Data
    private let fileName: String
    private var listener: NWListener?
    private var completion: ((Bool) -> Void)?
    private var didComplete = false
    private var backgroundTask: UIBackgroundTaskIdentifier = .invalid

    init(data: Data, fileName: String) {
        self.data = data
        self.fileName = fileName
    }

    func open(completion: @escaping (Bool) -> Void) {
        self.completion = completion
        beginBackgroundTask()

        do {
            let parameters = NWParameters.tcp
            parameters.allowLocalEndpointReuse = true
            parameters.requiredLocalEndpoint = NWEndpoint.hostPort(
                host: .ipv4(IPv4Address("127.0.0.1")!),
                port: .any
            )
            let listener = try NWListener(using: parameters, on: .any)
            self.listener = listener
            listener.newConnectionHandler = { [weak self] connection in
                self?.serve(connection)
            }
            listener.stateUpdateHandler = { [weak self] state in
                guard let self else { return }
                switch state {
                case .ready:
                    self.openSafari()
                case .failed:
                    self.finish(false)
                case .cancelled:
                    self.endBackgroundTask()
                default:
                    break
                }
            }
            listener.start(queue: .main)
        } catch {
            finish(false)
        }
    }

    func stop() {
        listener?.cancel()
        listener = nil
        endBackgroundTask()
    }

    private func openSafari() {
        guard let port = listener?.port else {
            finish(false)
            return
        }
        let encodedName = fileName.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? "orca-relay-ca.mobileconfig"
        guard let url = URL(string: "http://127.0.0.1:\(port.rawValue)/\(encodedName)") else {
            finish(false)
            return
        }

        UIApplication.shared.open(url, options: [:]) { [weak self] success in
            if !success {
                self?.finish(false)
            }
        }
    }

    private func serve(_ connection: NWConnection) {
        connection.stateUpdateHandler = { [weak self, weak connection] state in
            if case .ready = state {
                self?.receiveRequest(on: connection)
            }
        }
        connection.start(queue: .main)
    }

    private func receiveRequest(on connection: NWConnection?) {
        guard let connection else {
            finish(false)
            return
        }
        connection.receive(minimumIncompleteLength: 1, maximumLength: 4096) { [weak self] _, _, _, error in
            guard let self else { return }
            if error != nil {
                self.finish(false)
                return
            }
            self.sendResponse(on: connection)
        }
    }

    private func sendResponse(on connection: NWConnection) {
        var headers = ""
        headers += "HTTP/1.1 200 OK\r\n"
        headers += "Content-Type: application/x-apple-aspen-config\r\n"
        headers += "Content-Disposition: attachment; filename=\"\(fileName)\"\r\n"
        headers += "Content-Length: \(data.count)\r\n"
        headers += "Cache-Control: no-store\r\n"
        headers += "Connection: close\r\n"
        headers += "\r\n"

        var response = Data(headers.utf8)
        response.append(data)
        connection.send(content: response, completion: .contentProcessed { [weak self, weak connection] error in
            connection?.cancel()
            self?.finish(error == nil)
        })
    }

    private func beginBackgroundTask() {
        backgroundTask = UIApplication.shared.beginBackgroundTask(withName: "OrcaProfileInstall") { [weak self] in
            self?.stop()
        }
    }

    private func endBackgroundTask() {
        if backgroundTask != .invalid {
            UIApplication.shared.endBackgroundTask(backgroundTask)
            backgroundTask = .invalid
        }
    }

    private func finish(_ success: Bool) {
        if didComplete {
            return
        }
        didComplete = true
        listener?.cancel()
        listener = nil
        endBackgroundTask()
        completion?(success)
        completion = nil
    }
}
