# TODO

## Base Smart Wallet (Coinbase Wallet SDK) — Node.js Blocker

**Flag:** `arc402 wallet deploy --smart-wallet`

**Status:** Stub implemented — not functional until resolved.

### Problem

`@coinbase/wallet-sdk` v4 is a browser-only library. It relies on:

- `localStorage` (no Node.js equivalent)
- `window.open()` / popup windows (browser UI)
- `window.postMessage` (cross-origin browser messaging)
- `window.location` and `window.innerWidth` / `window.screenX`

When `eth_requestAccounts` is called on the provider in Node.js, it immediately throws:

```
ReferenceError: window is not defined
    at openPopup (dist/util/web.js:20)
    at Communicator.waitForPopupLoaded (dist/core/communicator/Communicator.js:74)
```

The SDK's connection flow works by opening a popup to `https://keys.coinbase.com/connect`,
communicating with it via `window.postMessage`, and relaying the approval back. There is no
URL / QR code emitted as a side effect — the URL is the popup destination, not a scannable
pairing URI like WalletConnect's `wc:...` scheme.

### What was attempted

1. **`localStorage` polyfill** — works for SDK init, but `window` is still required for the
   popup communicator and cannot be easily polyfilled.
2. **Intercepting `openPopup`** — the popup URL (`keys.coinbase.com/connect?...`) is constructed
   internally and never exposed as an observable event or return value before `window.open` is
   called.

### Resolution paths

1. **Use the WalletLink (legacy) relay** — older `@coinbase/wallet-sdk` v3 used a WalletLink
   relay that emits a scannable QR URL via an event listener. Downgrading to v3 and using
   `WalletLink.makeWeb3Provider()` with a `CryptoWalletLinkRelay` event approach may work.
   See: `sdk.walletlinkUrl` and the relay's `QRCode` event.

2. **Headless browser bridge** — run a Puppeteer/Playwright headless browser, load the SDK
   there, intercept the `keys.coinbase.com` popup URL before it opens, and expose it to the
   CLI as a QR code. Complex but fully functional.

3. **Custom signing via `@coinbase/coinbase-sdk` / Wallet API** — use Coinbase's Wallet API
   directly with an API key instead of the browser-wallet flow. Suited for server/daemon use
   cases but requires a Coinbase developer account.

4. **Wait for official Node.js support** — track
   `https://github.com/coinbase/coinbase-wallet-sdk` for a `wallet_connect` handshake
   exposed outside the browser context.

### Current state

`src/coinbase-smart-wallet.ts` exports `requestCoinbaseSmartWalletSignature` as a stub.
When called, it prints the limitation clearly and exits with code 1 rather than crashing.
The `--smart-wallet` flag is wired into `arc402 wallet deploy` and is ready to be activated
once one of the above paths is implemented.
