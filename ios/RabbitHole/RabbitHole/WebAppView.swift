import Combine
import SwiftUI
import UIKit
import WebKit

private let branchSelectionMessageName = "rabbitHoleBranchSelection"
private let nativeBranchEventName = "rabbit-hole:native-branch-from-selection"
private let branchSelectionActionIdentifier = UIAction.Identifier(
    "com.rabbit-hole.branch-from-selection"
)

struct NativeBranchSelection: Equatable {
    let nodeId: String
    let quote: String
    let copyText: String
    let rect: CGRect
}

@MainActor
final class RabbitHoleWebViewController: UIViewController, @preconcurrency UIEditMenuInteractionDelegate {
    let webView: WKWebView
    var onBranchFromSelection: ((NativeBranchSelection) -> Void)?
    private var branchSelection: NativeBranchSelection?
    private var branchMenuRequested = false
    private var branchMenuIsPresented = false
    private lazy var branchEditMenuInteraction = UIEditMenuInteraction(delegate: self)

    init(webView: WKWebView) {
        self.webView = webView
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func loadView() {
        view = webView
    }

    func updateBranchSelection(_ selection: NativeBranchSelection?) {
        if selection == nil && branchMenuIsPresented { return }
        guard branchSelection != selection else { return }
        branchSelection = selection
        if branchMenuRequested { presentBranchMenuIfPossible() }
    }

    func requestBranchMenu() {
        branchMenuRequested = true
        presentBranchMenuIfPossible()
    }

    func systemEditMenuDidDismiss() {
        guard !branchMenuIsPresented else { return }
        branchMenuRequested = false
        branchSelection = nil
    }

    private func branchFromCurrentSelection() {
        if let branchSelection {
            onBranchFromSelection?(branchSelection)
            return
        }

        webView.evaluateJavaScript(
            #"""
            (() => {
              const selected = window.getSelection();
              if (!selected || selected.isCollapsed || selected.rangeCount === 0) return false;

              const anchorElement = selected.anchorNode instanceof Element
                ? selected.anchorNode
                : selected.anchorNode?.parentElement;
              const focusElement = selected.focusNode instanceof Element
                ? selected.focusNode
                : selected.focusNode?.parentElement;
              const anchorResponse = anchorElement?.closest('.markdown-body[data-node-id]');
              const focusResponse = focusElement?.closest('.markdown-body[data-node-id]');
              const quote = selected.toString().trim().replace(/\s+/g, ' ');

              if (!anchorResponse || anchorResponse !== focusResponse || !quote) return false;

              window.dispatchEvent(new CustomEvent('rabbit-hole:native-branch-from-selection', {
                detail: {
                  nodeId: anchorResponse.dataset.nodeId || '',
                  quote: quote.slice(0, 480),
                },
              }));
              return true;
            })();
            """#
        )
    }

    private func presentBranchMenuIfPossible() {
        guard branchMenuRequested,
              let selection = branchSelection,
              !branchMenuIsPresented else { return }

        branchMenuRequested = false
        branchMenuIsPresented = true
        if branchEditMenuInteraction.view == nil {
            webView.addInteraction(branchEditMenuInteraction)
        }

        dismissWebKitEditMenus(in: webView)
        let sourcePoint = CGPoint(x: selection.rect.midX, y: selection.rect.minY)
        branchEditMenuInteraction.presentEditMenu(
            with: UIEditMenuConfiguration(identifier: nil, sourcePoint: sourcePoint)
        )
    }

    private func dismissWebKitEditMenus(in view: UIView) {
        for interaction in view.interactions.compactMap({ $0 as? UIEditMenuInteraction })
        where interaction !== branchEditMenuInteraction {
            interaction.dismissMenu()
        }
        for subview in view.subviews {
            dismissWebKitEditMenus(in: subview)
        }
    }

    func editMenuInteraction(
        _ interaction: UIEditMenuInteraction,
        menuFor configuration: UIEditMenuConfiguration,
        suggestedActions: [UIMenuElement]
    ) -> UIMenu? {
        guard let selection = branchSelection else { return nil }

        let copyAction = UIAction(
            title: "Copy",
            image: UIImage(systemName: "doc.on.doc")
        ) { _ in
            UIPasteboard.general.string = selection.copyText
        }
        let branchAction = UIAction(
            title: "Branch from Selection",
            image: UIImage(systemName: "arrow.triangle.branch"),
            identifier: branchSelectionActionIdentifier
        ) { [weak self] _ in
            self?.branchFromCurrentSelection()
        }

        return UIMenu(
            title: "",
            options: .displayInline,
            children: [branchAction, copyAction]
        )
    }

    func editMenuInteraction(
        _ interaction: UIEditMenuInteraction,
        targetRectFor configuration: UIEditMenuConfiguration
    ) -> CGRect {
        guard let rect = branchSelection?.rect else { return .null }
        return rect.insetBy(dx: -2, dy: -2).intersection(webView.bounds)
    }

    func editMenuInteraction(
        _ interaction: UIEditMenuInteraction,
        willPresentMenuFor configuration: UIEditMenuConfiguration,
        animator: any UIEditMenuInteractionAnimating
    ) {
        branchMenuIsPresented = true
    }

    func editMenuInteraction(
        _ interaction: UIEditMenuInteraction,
        willDismissMenuFor configuration: UIEditMenuConfiguration,
        animator: any UIEditMenuInteractionAnimating
    ) {
        animator.addCompletion { [weak self] in
            guard let self else { return }
            self.branchMenuIsPresented = false
            self.branchMenuRequested = false
            self.branchSelection = nil
            if self.branchEditMenuInteraction.view != nil {
                self.webView.removeInteraction(self.branchEditMenuInteraction)
            }
        }
    }

}

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

struct WebAppView: UIViewControllerRepresentable {
    @ObservedObject var session: WebAppSession

    func makeCoordinator() -> Coordinator {
        Coordinator(session: session)
    }

    func makeUIViewController(context: Context) -> RabbitHoleWebViewController {
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
        configuration.userContentController.addUserScript(
            WKUserScript(
                source: #"""
                (() => {
                  let pendingFrame = 0;

                  const publishSelection = () => {
                    pendingFrame = 0;
                    const selected = window.getSelection();
                    let payload = {};

                    if (selected && !selected.isCollapsed && selected.rangeCount > 0) {
                      const anchorElement = selected.anchorNode instanceof Element
                        ? selected.anchorNode
                        : selected.anchorNode?.parentElement;
                      const focusElement = selected.focusNode instanceof Element
                        ? selected.focusNode
                        : selected.focusNode?.parentElement;
                      const anchorResponse = anchorElement?.closest('.markdown-body[data-node-id]');
                      const focusResponse = focusElement?.closest('.markdown-body[data-node-id]');
                      const copyText = selected.toString();
                      const quote = copyText.trim().replace(/\s+/g, ' ');

                      if (anchorResponse && anchorResponse === focusResponse && quote) {
                        const rect = selected.getRangeAt(0).getBoundingClientRect();
                        payload = {
                          nodeId: anchorResponse.dataset.nodeId || '',
                          quote: quote.slice(0, 480),
                          copyText: copyText.slice(0, 20000),
                          rect: {
                            x: rect.x,
                            y: rect.y,
                            width: rect.width,
                            height: rect.height,
                          },
                        };
                      }
                    }

                    window.webkit.messageHandlers.rabbitHoleBranchSelection.postMessage(payload);
                  };

                  const scheduleSelectionUpdate = () => {
                    if (pendingFrame) cancelAnimationFrame(pendingFrame);
                    pendingFrame = requestAnimationFrame(publishSelection);
                  };

                  document.addEventListener('selectionchange', scheduleSelectionUpdate, true);
                  document.addEventListener('touchend', () => setTimeout(publishSelection, 0), true);
                })();
                """#,
                injectionTime: .atDocumentStart,
                forMainFrameOnly: true
            )
        )
        configuration.userContentController.add(
            context.coordinator,
            name: branchSelectionMessageName
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

        let viewController = RabbitHoleWebViewController(webView: webView)
        context.coordinator.webViewController = viewController
        viewController.onBranchFromSelection = { [weak webView] selection in
            guard let webView else { return }
            let payload: [String: String] = [
                "nodeId": selection.nodeId,
                "quote": selection.quote,
            ]
            guard let data = try? JSONSerialization.data(withJSONObject: payload),
                  let json = String(data: data, encoding: .utf8) else { return }
            webView.evaluateJavaScript(
                "window.dispatchEvent(new CustomEvent('\(nativeBranchEventName)', { detail: \(json) }));"
            )
        }

        session.attach(webView)
        return viewController
    }

    func updateUIViewController(_ viewController: RabbitHoleWebViewController, context: Context) {}

    static func dismantleUIViewController(
        _ viewController: RabbitHoleWebViewController,
        coordinator: Coordinator
    ) {
        let webView = viewController.webView
        webView.stopLoading()
        webView.navigationDelegate = nil
        webView.uiDelegate = nil
        webView.configuration.userContentController.removeScriptMessageHandler(
            forName: branchSelectionMessageName
        )
        viewController.onBranchFromSelection = nil
        coordinator.session.detach(webView)
    }

    @MainActor
    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
        let session: WebAppSession
        weak var webViewController: RabbitHoleWebViewController?
        private var editMenuIsPresented = false

        init(session: WebAppSession) {
            self.session = session
        }

        func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation?) {
            session.beganNavigation()
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation?) {
            session.finishedNavigation()
        }

        func userContentController(
            _ userContentController: WKUserContentController,
            didReceive message: WKScriptMessage
        ) {
            guard message.name == branchSelectionMessageName,
                  message.frameInfo.isMainFrame else { return }

            guard let payload = message.body as? [String: Any],
                  let rawNodeId = payload["nodeId"] as? String,
                  let rawQuote = payload["quote"] as? String,
                  let rawCopyText = payload["copyText"] as? String,
                  let rawRect = payload["rect"] as? [String: Any],
                  let rectX = rawRect["x"] as? NSNumber,
                  let rectY = rawRect["y"] as? NSNumber,
                  let rectWidth = rawRect["width"] as? NSNumber,
                  let rectHeight = rawRect["height"] as? NSNumber else {
                if !editMenuIsPresented {
                    webViewController?.updateBranchSelection(nil)
                }
                return
            }

            let nodeId = rawNodeId.trimmingCharacters(in: .whitespacesAndNewlines)
            let quote = rawQuote.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !nodeId.isEmpty, !quote.isEmpty else {
                if !editMenuIsPresented {
                    webViewController?.updateBranchSelection(nil)
                }
                return
            }

            webViewController?.updateBranchSelection(
                NativeBranchSelection(
                    nodeId: nodeId,
                    quote: String(quote.prefix(480)),
                    copyText: String(rawCopyText.prefix(20_000)),
                    rect: CGRect(
                        x: rectX.doubleValue,
                        y: rectY.doubleValue,
                        width: rectWidth.doubleValue,
                        height: rectHeight.doubleValue
                    )
                )
            )
        }

        func webView(
            _ webView: WKWebView,
            willPresentEditMenuWithAnimator animator: any UIEditMenuInteractionAnimating
        ) {
            editMenuIsPresented = true
            webViewController?.requestBranchMenu()
        }

        func webView(
            _ webView: WKWebView,
            willDismissEditMenuWithAnimator animator: any UIEditMenuInteractionAnimating
        ) {
            editMenuIsPresented = false
            webViewController?.systemEditMenuDidDismiss()
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
