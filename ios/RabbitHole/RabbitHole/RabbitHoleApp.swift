import SwiftUI

@main
struct RabbitHoleApp: App {
    @StateObject private var session = WebAppSession(configuration: .current)

    var body: some Scene {
        WindowGroup {
            RabbitHoleRootView(session: session)
                .statusBarHidden(true)
        }
    }
}

private struct RabbitHoleRootView: View {
    @ObservedObject var session: WebAppSession

    var body: some View {
        ZStack {
            WebAppView(session: session)

            switch session.state {
            case .loading:
                LoadingView()
            case .ready:
                EmptyView()
            case .failed(let message):
                FailureView(message: message, retry: session.retry)
            }
        }
        .background(Color(uiColor: .systemBackground))
        .ignoresSafeArea()
    }
}

private struct LoadingView: View {
    var body: some View {
        ZStack {
            Color(uiColor: .systemBackground)
            ProgressView()
                .controlSize(.regular)
                .tint(Color(uiColor: .secondaryLabel))
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Opening Rabbit Hole")
    }
}

private struct FailureView: View {
    let message: String
    let retry: () -> Void

    var body: some View {
        ZStack {
            Color(uiColor: .systemBackground)

            VStack(spacing: 16) {
                Image("RabbitHoleMark")
                    .resizable()
                    .interpolation(.high)
                    .frame(width: 52, height: 52)
                    .clipShape(RoundedRectangle(cornerRadius: 15, style: .continuous))

                VStack(spacing: 7) {
                    Text("Rabbit Hole is unavailable")
                        .font(.system(size: 22, weight: .semibold, design: .rounded))
                    Text(message)
                        .font(.system(size: 14))
                        .foregroundStyle(Color(uiColor: .secondaryLabel))
                        .multilineTextAlignment(.center)
                        .lineSpacing(2)
                }

                Button("Try again", action: retry)
                    .buttonStyle(.borderedProminent)
                    .tint(Color(uiColor: .label))
            }
            .frame(maxWidth: 390)
            .padding(28)
        }
    }
}
