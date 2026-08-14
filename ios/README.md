# Rabbit Hole for iPad

The iPad target is a native SwiftUI application that hosts the existing Rabbit Hole interface in a persistent `WKWebView`. It intentionally uses the deployed Next.js app as its UI and backend so the web and iPad versions keep the same layout, branching behavior, model controls, streaming, password gate, themes, and storage format.

## What is included

- iPad-only SwiftUI application target
- Persistent cookies, local storage, session storage, and cache
- Full-screen web layout in portrait, landscape, and iPad multitasking sizes
- External links opened outside the app while Rabbit Hole navigation stays in-app
- Native loading, offline, invalid-deployment, and retry states
- Debug Web Inspector support
- App icon generated from the existing Rabbit Hole icon

## Run in the iPad Simulator

The Debug configuration points to `http://localhost:3000`.

1. Install the full Xcode application. Command Line Tools alone do not include the iPad Simulator or iOS SDK.
2. Start Rabbit Hole from the repository root:

   ```bash
   npm run dev
   ```

   Use `npm run dev:no-auth` if you intentionally want to skip the password gate locally.

3. Open `ios/RabbitHole/RabbitHole.xcodeproj` in Xcode.
4. Select the **RabbitHole** scheme and an iPad simulator, then Run.

The simulator shares the Mac's localhost network, so it can reach the Next development server and the optional desktop ChatGPT relay.

## Point Release builds at Vercel

Set `RABBIT_HOLE_BASE_URL` under **RabbitHole target → Build Settings → User-Defined** to the canonical HTTPS deployment, for example:

```text
https://rabbit-hole-your-team.vercel.app
```

The Release configuration deliberately contains a recognizable placeholder and shows a configuration error until it is replaced. The URL is public configuration, not a secret. Keep `RABBIT_HOLE_PASSWORD`, `RABBIT_HOLE_AUTH_SECRET`, and every provider API key only in Vercel/server environment variables.

For a one-off Xcode run, the scheme can override the build value with a `RABBIT_HOLE_BASE_URL` launch environment variable.

## Physical iPad limitation

All hosted model paths work through the deployed `/api/chat` route. The experimental ChatGPT relay is different: it automates desktop Chrome and binds to `127.0.0.1` by design. A physical iPad's loopback address is the iPad itself, so it cannot run or reach that desktop-only relay. Do not expose the relay directly to a LAN or the internet. A future physical-device relay would need an authenticated, encrypted Mac companion transport.

## Archive

After setting the Release URL and selecting an Apple development team:

1. Choose **Any iOS Device (arm64)**.
2. Choose **Product → Archive**.
3. Distribute with TestFlight or the desired managed deployment method.

The bundle identifier defaults to `com.arvinwu.rabbithole`; change it in the target's Signing & Capabilities tab if that identifier is not available in the selected Apple developer account.
