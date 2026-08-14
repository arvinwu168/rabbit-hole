import Combine
import SwiftUI
import UIKit
import WebKit

@MainActor
final class WebAppSession: ObservableObject {
    enum State: Equatable {
        case loading
        case ready
        case failed(String)
    }

    @Published private(set) var state: State
    let configuration: AppConfiguration
    private weak var webView: WKWebView?

    init(configuration: AppConfiguration) {
        self.configuration = configuration
        if let errorMessage = configuration.errorMessage {
            state = .failed(errorMessage)
        } else {
            state = .loading
        }
    }

    func attach(_ webView: WKWebView) {
        self.webView = webView
        loadHome()
    }

    func detach(_ webView: WKWebView) {
        if self.webView === webView {
            self.webView = nil
        }
    }

    func retry() {
        loadHome(cachePolicy: .reloadRevalidatingCacheData)
    }

    func beganNavigation() {
        state = .loading
    }

    func finishedNavigation() {
        state = .ready
    }

    func failedNavigation(_ message: String) {
        state = .failed(message)
    }

    private func loadHome(cachePolicy: URLRequest.CachePolicy = .useProtocolCachePolicy) {
        guard let webView else { return }
        guard let url = configuration.webAppURL else {
            state = .failed(configuration.errorMessage ?? "The Rabbit Hole URL is not configured.")
            return
        }

        state = .loading
        webView.load(URLRequest(url: url, cachePolicy: cachePolicy, timeoutInterval: 30))
    }
}

struct WebAppView: UIViewRepresentable {
    @ObservedObject var session: WebAppSession

    func makeCoordinator() -> Coordinator {
        Coordinator(session: session)
    }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = true
        configuration.userContentController.addUserScript(
            WKUserScript(
                source: #"document.documentElement.dataset.rabbitHolePlatform = "ipad";"#,
                injectionTime: .atDocumentStart,
                forMainFrameOnly: true
            )
        )

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        webView.allowsBackForwardNavigationGestures = false
        webView.allowsLinkPreview = true
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.keyboardDismissMode = .interactive
        webView.scrollView.bounces = false
        webView.scrollView.alwaysBounceHorizontal = false
        webView.scrollView.alwaysBounceVertical = false
        webView.scrollView.isDirectionalLockEnabled = true
        webView.backgroundColor = .systemBackground
        webView.isOpaque = true

        #if DEBUG
        if #available(iOS 16.4, *) {
            webView.isInspectable = true
        }
        #endif

        session.attach(webView)
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {}

    static func dismantleUIView(_ webView: WKWebView, coordinator: Coordinator) {
        webView.stopLoading()
        webView.navigationDelegate = nil
        webView.uiDelegate = nil
        coordinator.session.detach(webView)
    }

    @MainActor
    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
        let session: WebAppSession

        init(session: WebAppSession) {
            self.session = session
        }

        func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation?) {
            session.beganNavigation()
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation?) {
            session.finishedNavigation()
        }

        func webView(
            _ webView: WKWebView,
            didFailProvisionalNavigation navigation: WKNavigation?,
            withError error: Error
        ) {
            handleNavigationFailure(error)
        }

        func webView(
            _ webView: WKWebView,
            didFail navigation: WKNavigation?,
            withError error: Error
        ) {
            handleNavigationFailure(error)
        }

        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
            session.failedNavigation("The web view stopped unexpectedly. Your saved chats are still on this iPad.")
        }

        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
        ) {
            guard let url = navigationAction.request.url else {
                decisionHandler(.cancel)
                return
            }

            if session.configuration.permitsNavigation(to: url) {
                decisionHandler(.allow)
                return
            }

            if navigationAction.navigationType == .linkActivated || navigationAction.targetFrame == nil {
                UIApplication.shared.open(url)
            } else if navigationAction.targetFrame?.isMainFrame == true {
                session.failedNavigation("Rabbit Hole blocked a redirect outside its configured server.")
            }

            decisionHandler(.cancel)
        }

        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationResponse: WKNavigationResponse,
            decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void
        ) {
            guard navigationResponse.isForMainFrame,
                  let response = navigationResponse.response as? HTTPURLResponse,
                  response.statusCode >= 400 else {
                decisionHandler(.allow)
                return
            }

            session.failedNavigation("Rabbit Hole returned HTTP \(response.statusCode). Check the deployment and try again.")
            decisionHandler(.cancel)
        }

        func webView(
            _ webView: WKWebView,
            createWebViewWith configuration: WKWebViewConfiguration,
            for navigationAction: WKNavigationAction,
            windowFeatures: WKWindowFeatures
        ) -> WKWebView? {
            guard navigationAction.targetFrame == nil,
                  let url = navigationAction.request.url else { return nil }

            if session.configuration.permitsNavigation(to: url) {
                webView.load(URLRequest(url: url))
            } else {
                UIApplication.shared.open(url)
            }
            return nil
        }

        func webView(
            _ webView: WKWebView,
            runJavaScriptConfirmPanelWithMessage message: String,
            initiatedByFrame frame: WKFrameInfo,
            completionHandler: @escaping (Bool) -> Void
        ) {
            guard var presenter = webView.window?.rootViewController else {
                completionHandler(false)
                return
            }

            while let presentedViewController = presenter.presentedViewController {
                presenter = presentedViewController
            }

            let alert = UIAlertController(title: "Start fresh?", message: message, preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in
                completionHandler(false)
            })
            alert.addAction(UIAlertAction(title: "Start Fresh", style: .destructive) { _ in
                completionHandler(true)
            })
            presenter.present(alert, animated: true)
        }

        private func handleNavigationFailure(_ error: Error) {
            let nsError = error as NSError
            if nsError.domain == NSURLErrorDomain && nsError.code == NSURLErrorCancelled {
                return
            }

            let message: String
            if nsError.domain == NSURLErrorDomain && nsError.code == NSURLErrorNotConnectedToInternet {
                message = "This iPad is offline. Reconnect and try again."
            } else if nsError.domain == NSURLErrorDomain && nsError.code == NSURLErrorCannotConnectToHost {
                message = "Rabbit Hole could not reach its server. Confirm the app URL and that the server is running."
            } else {
                message = "Rabbit Hole could not load: \(nsError.localizedDescription)"
            }
            session.failedNavigation(message)
        }
    }
}
