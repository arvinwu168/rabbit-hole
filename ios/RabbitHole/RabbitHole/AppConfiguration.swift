import Foundation

struct AppConfiguration: Equatable {
    let webAppURL: URL?
    let errorMessage: String?

    static let current = load()

    private static func load(
        environment: [String: String] = ProcessInfo.processInfo.environment,
        bundle: Bundle = .main
    ) -> AppConfiguration {
        let environmentValue = environment["RABBIT_HOLE_BASE_URL"]
        let bundleValue = bundle.object(forInfoDictionaryKey: "RabbitHoleBaseURL") as? String
        let rawValue = (environmentValue ?? bundleValue ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)

        guard !rawValue.isEmpty,
              !rawValue.contains("$("),
              !rawValue.contains("your-rabbit-hole") else {
            return AppConfiguration(
                webAppURL: nil,
                errorMessage: "Set RABBIT_HOLE_BASE_URL to the deployed Rabbit Hole URL in the app target's Build Settings."
            )
        }

        guard let url = URL(string: rawValue),
              let scheme = url.scheme?.lowercased(),
              ["http", "https"].contains(scheme),
              url.host != nil else {
            return AppConfiguration(
                webAppURL: nil,
                errorMessage: "RABBIT_HOLE_BASE_URL must be a complete http or https URL."
            )
        }

        return AppConfiguration(webAppURL: url, errorMessage: nil)
    }

    func permitsNavigation(to url: URL) -> Bool {
        guard let webAppURL else { return false }
        guard let scheme = url.scheme?.lowercased() else { return false }

        if scheme == "about" || scheme == "blob" {
            return true
        }

        return scheme == webAppURL.scheme?.lowercased()
            && url.host?.lowercased() == webAppURL.host?.lowercased()
            && effectivePort(for: url) == effectivePort(for: webAppURL)
    }

    private func effectivePort(for url: URL) -> Int? {
        if let port = url.port { return port }
        switch url.scheme?.lowercased() {
        case "http": return 80
        case "https": return 443
        default: return nil
        }
    }
}
