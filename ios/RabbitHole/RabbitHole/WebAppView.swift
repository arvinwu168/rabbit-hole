import Combine
import SwiftUI
import UIKit
import WebKit

private let branchSelectionMessageName = "rabbitHoleBranchSelection"
private let promptCopyMessageName = "rabbitHolePromptCopy"
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

struct NativePromptCopy: Equatable {
    let text: String
    let rect: CGRect
}

@MainActor
final class RabbitHoleWebView: WKWebView {
    var branchActionProvider: (() -> UIAction?)?

    override func buildMenu(with builder: any UIMenuBuilder) {
        super.buildMenu(with: builder)
        guard builder.system == UIMenuSystem.context,
              let branchAction = branchActionProvider?(),
              builder.action(for: branchSelectionActionIdentifier) == nil else { return }

        if #available(iOS 26.0, *) {
            let copyAction = #selector(UIResponderStandardEditActions.copy(_:))
            if builder.command(for: copyAction, propertyList: nil) != nil {
                builder.insertElements([branchAction], beforeCommand: copyAction, propertyList: nil)
            } else if builder.menu(for: .standardEdit) != nil {
                builder.insertElements([branchAction], atStartOfMenu: .standardEdit)
            } else if builder.menu(for: .edit) != nil {
                builder.insertElements([branchAction], atStartOfMenu: .edit)
            }
        } else {
            let branchMenu = UIMenu(
                title: "",
                options: .displayInline,
                children: [branchAction]
            )
            if builder.menu(for: .standardEdit) != nil {
                builder.insertChild(branchMenu, atStartOfMenu: .standardEdit)
            } else if builder.menu(for: .edit) != nil {
                builder.insertChild(branchMenu, atStartOfMenu: .edit)
            }
        }
    }
}

@MainActor
final class RabbitHoleWebViewController: UIViewController, @preconcurrency UIEditMenuInteractionDelegate {
    let webView: RabbitHoleWebView
    var onBranchFromSelection: ((NativeBranchSelection) -> Void)?
    private var branchSelection: NativeBranchSelection?
    private var promptCopy: NativePromptCopy?
    private var promptCopyMenuIsPresented = false
    private lazy var promptCopyEditMenuInteraction = UIEditMenuInteraction(delegate: self)

    init(webView: RabbitHoleWebView) {
        self.webView = webView
        super.init(nibName: nil, bundle: nil)
        webView.branchActionProvider = { [weak self] in
            self?.makeBranchAction()
        }
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func loadView() {
        view = webView
    }

    private func makeBranchAction() -> UIAction? {
        guard branchSelection != nil else { return nil }
        return UIAction(
            title: "Branch from Selection",
            image: UIImage(systemName: "arrow.triangle.branch"),
            identifier: branchSelectionActionIdentifier
        ) { [weak self] _ in
            self?.branchFromCurrentSelection()
        }
    }

    func updateBranchSelection(_ selection: NativeBranchSelection?) {
        guard branchSelection != selection else { return }
        branchSelection = selection
        UIMenuSystem.context.setNeedsRebuild()
    }

    func systemEditMenuDidDismiss() {
        branchSelection = nil
    }

    func presentPromptCopyMenu(_ promptCopy: NativePromptCopy) {
        guard !promptCopyMenuIsPresented else { return }

        self.promptCopy = promptCopy
        promptCopyMenuIsPresented = true
        if promptCopyEditMenuInteraction.view == nil {
            webView.addInteraction(promptCopyEditMenuInteraction)
        }
        promptCopyEditMenuInteraction.presentEditMenu(
            with: UIEditMenuConfiguration(
                identifier: nil,
                sourcePoint: CGPoint(x: promptCopy.rect.midX, y: promptCopy.rect.midY)
            )
        )
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

    func editMenuInteraction(
        _ interaction: UIEditMenuInteraction,
        menuFor configuration: UIEditMenuConfiguration,
        suggestedActions: [UIMenuElement]
    ) -> UIMenu? {
        if interaction === promptCopyEditMenuInteraction {
            guard let promptCopy else { return nil }
            let copyAction = UIAction(
                title: "Copy",
                image: UIImage(systemName: "doc.on.doc")
            ) { _ in
                UIPasteboard.general.string = promptCopy.text
            }
            return UIMenu(title: "", options: .displayInline, children: [copyAction])
        }

        return nil
    }

    func editMenuInteraction(
        _ interaction: UIEditMenuInteraction,
        targetRectFor configuration: UIEditMenuConfiguration
    ) -> CGRect {
        if interaction === promptCopyEditMenuInteraction {
            guard let rect = promptCopy?.rect else { return .null }
            return rect.insetBy(dx: -2, dy: -2).intersection(webView.bounds)
        }

        return .null
    }

    func editMenuInteraction(
        _ interaction: UIEditMenuInteraction,
        willPresentMenuFor configuration: UIEditMenuConfiguration,
        animator: any UIEditMenuInteractionAnimating
    ) {
        if interaction === promptCopyEditMenuInteraction { promptCopyMenuIsPresented = true }
    }

    func editMenuInteraction(
        _ interaction: UIEditMenuInteraction,
        willDismissMenuFor configuration: UIEditMenuConfiguration,
        animator: any UIEditMenuInteractionAnimating
    ) {
        animator.addCompletion { [weak self] in
            guard let self else { return }
            if interaction === self.promptCopyEditMenuInteraction {
                self.promptCopyMenuIsPresented = false
                self.promptCopy = nil
                if self.promptCopyEditMenuInteraction.view != nil {
                    self.webView.removeInteraction(self.promptCopyEditMenuInteraction)
                }
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
                  let promptCopyTimer = 0;
                  let promptTouchOrigin = null;

                  const publishSelection = () => {
                    pendingFrame = 0;
                    const activeElement = document.activeElement;
                    if (activeElement instanceof HTMLTextAreaElement
                        || activeElement instanceof HTMLInputElement
                        || activeElement?.isContentEditable) {
                      return;
                    }

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
                  document.addEventListener('focusin', (event) => {
                    const target = event.target;
                    if (!(target instanceof HTMLTextAreaElement)
                        && !(target instanceof HTMLInputElement)
                        && !target?.isContentEditable) {
                      return;
                    }

                    if (pendingFrame) cancelAnimationFrame(pendingFrame);
                    pendingFrame = 0;
                    window.webkit.messageHandlers.rabbitHoleBranchSelection.postMessage({});
                  }, true);
                  document.addEventListener('touchend', (event) => {
                    const target = event.target;
                    if (target instanceof HTMLTextAreaElement
                        || target instanceof HTMLInputElement
                        || target?.isContentEditable) {
                      return;
                    }
                    setTimeout(publishSelection, 0);
                  }, true);

                  const cancelPromptCopy = () => {
                    if (promptCopyTimer) window.clearTimeout(promptCopyTimer);
                    promptCopyTimer = 0;
                    promptTouchOrigin = null;
                  };

                  document.addEventListener('touchstart', (event) => {
                    cancelPromptCopy();
                    if (event.touches.length !== 1) return;

                    const target = event.target instanceof Element
                      ? event.target.closest('.user-prompt-viewport')
                      : null;
                    if (!target) return;

                    const touch = event.touches[0];
                    promptTouchOrigin = { x: touch.clientX, y: touch.clientY };
                    promptCopyTimer = window.setTimeout(() => {
                      promptCopyTimer = 0;
                      const copyText = target.textContent || '';
                      const rect = target.closest('.user-bubble')?.getBoundingClientRect()
                        || target.getBoundingClientRect();
                      if (!copyText.trim()) return;

                      window.webkit.messageHandlers.rabbitHolePromptCopy.postMessage({
                        copyText: copyText.slice(0, 20000),
                        rect: {
                          x: rect.x,
                          y: rect.y,
                          width: rect.width,
                          height: rect.height,
                        },
                      });
                    }, 520);
                  }, { capture: true, passive: true });

                  document.addEventListener('touchmove', (event) => {
                    if (!promptTouchOrigin || event.touches.length !== 1) return;
                    const touch = event.touches[0];
                    if (Math.hypot(
                      touch.clientX - promptTouchOrigin.x,
                      touch.clientY - promptTouchOrigin.y
                    ) > 10) {
                      cancelPromptCopy();
                    }
                  }, { capture: true, passive: true });

                  document.addEventListener('touchend', cancelPromptCopy, true);
                  document.addEventListener('touchcancel', cancelPromptCopy, true);
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
        configuration.userContentController.add(
            context.coordinator,
            name: promptCopyMessageName
        )

        let webView = RabbitHoleWebView(frame: .zero, configuration: configuration)
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
        webView.configuration.userContentController.removeScriptMessageHandler(
            forName: promptCopyMessageName
        )
        viewController.onBranchFromSelection = nil
        webView.branchActionProvider = nil
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
            guard message.frameInfo.isMainFrame else { return }

            if message.name == promptCopyMessageName {
                guard let payload = message.body as? [String: Any],
                      let rawCopyText = payload["copyText"] as? String,
                      let rawRect = payload["rect"] as? [String: Any],
                      let rectX = rawRect["x"] as? NSNumber,
                      let rectY = rawRect["y"] as? NSNumber,
                      let rectWidth = rawRect["width"] as? NSNumber,
                      let rectHeight = rawRect["height"] as? NSNumber else { return }

                let copyText = rawCopyText.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !copyText.isEmpty else { return }
                webViewController?.presentPromptCopyMenu(
                    NativePromptCopy(
                        text: String(rawCopyText.prefix(20_000)),
                        rect: CGRect(
                            x: rectX.doubleValue,
                            y: rectY.doubleValue,
                            width: rectWidth.doubleValue,
                            height: rectHeight.doubleValue
                        )
                    )
                )
                return
            }

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
