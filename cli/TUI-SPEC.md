# ARC-402 TUI Specification — Ink-based Terminal UI

**Date:** 2026-03-22
**Status:** Ready for implementation
**Pattern:** Fixed header/footer with scrollable viewport (split-pane TUI)
**Library:** Ink (React for CLIs) — same architecture as Claude Code

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│  HEADER (fixed, 8-10 rows)                      │
│  ┌─────────────────────────────────────────────┐ │
│  │ ██████╗ ██████╗  ██████╗    ...            │ │
│  │ agent-to-agent arcing · v0.7.3             │ │
│  │ ◈ ──────────────────────────────────────── │ │
│  │ Network  Base Mainnet   Wallet  0xA34B..   │ │
│  └─────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────┤
│  VIEWPORT (scrollable, fills remaining space)    │
│                                                  │
│  ◈ arc402 > wallet status                        │
│   ├ Address  0xA34B...a5dc                       │
│   ├ ETH      0.002 ETH                           │
│   └ Trust    100 Restricted                      │
│                                                  │
│  ◈ arc402 > shake send --to 0xa9e0...            │
│   ◈ Submitting handshake...                      │
│   ✓ Handshake sent — tx 0xabc1...                │
│                                                  │
│  ◈ arc402 > doctor                               │
│   ├ Config     ✓                                 │
│   ├ RPC        ✓ Base Mainnet                    │
│   └ Daemon     ✗ Not running                     │
│                                                  │
├─────────────────────────────────────────────────┤
│  FOOTER (fixed, 1-2 rows)                        │
│  ◈ arc402 > _                                    │
└─────────────────────────────────────────────────┘
```

---

## Component Tree (Ink/React)

```tsx
<App>
  <Box flexDirection="column" height="100%">
    
    {/* HEADER — fixed height, never scrolls */}
    <Header
      version={version}
      network={config.network}
      wallet={config.walletContractAddress}
      balance={balance}
    />
    
    <Box borderStyle="single" borderTop borderBottom={false} borderLeft={false} borderRight={false}>
      <Text dimColor>─</Text>
    </Box>
    
    {/* VIEWPORT — flexGrow, scrollable */}
    <Viewport
      lines={outputBuffer}
      scrollOffset={scrollOffset}
    />
    
    {/* FOOTER — fixed height, input pinned */}
    <Footer>
      <InputLine
        value={inputValue}
        onChange={setInputValue}
        onSubmit={handleCommand}
        history={history}
      />
    </Footer>
    
  </Box>
</App>
```

---

## Components

### `<Header />`
- Renders the ASCII art banner (cyan)
- Version from package.json
- Network, wallet (truncated), balance
- Fixed height: exactly `bannerLines.length + 3` rows
- Never re-renders unless config changes

### `<Viewport />`
- `flexGrow: 1` — fills all remaining terminal rows
- Maintains an internal `outputBuffer: string[]`
- Renders a window slice: `buffer.slice(scrollOffset, scrollOffset + viewportHeight)`
- Scroll up/down with Page Up/Page Down or mouse wheel
- Auto-scrolls to bottom when new output arrives (unless user scrolled up)
- Supports ANSI colors in output lines (chalk passes through)

### `<Footer />`
- Fixed height: 1 row (or 2 with status bar)
- Contains `<InputLine />`
- Prompt: `◈ arc402 > ` (◈ cyan, arc402 dim, > white)

### `<InputLine />`
- Uses `ink-text-input` for text input with cursor
- Up/down arrow: command history navigation
- Tab: command completion
- Enter: dispatch command
- Ctrl+C: graceful exit

---

## Behavior

### Command Dispatch
1. User types command + Enter
2. Command + output appended to `outputBuffer` as: `◈ arc402 > {command}` then output lines
3. Commander parses and executes (stdout/stderr captured and routed to viewport)
4. Viewport auto-scrolls to bottom
5. Input line clears, cursor returns

### Stdout/Stderr Capture
- During command execution, monkey-patch `process.stdout.write` and `process.stderr.write`
- Route all output to `outputBuffer` instead of raw terminal
- Restore after command completes
- This ensures spinners, tree output, console.log all render in the viewport

### Scroll Behavior
- **Auto-scroll:** viewport stays at bottom as new lines arrive
- **Manual scroll:** Page Up / Page Down moves viewport
- **Scroll indicator:** if not at bottom, show `↓ more` in bottom-right
- **Return to bottom:** any new command output snaps back to bottom

### Chat Integration
- Non-command input detected → POST to OpenClaw gateway
- Response streamed line-by-line into viewport
- Prefixed with `◈ ` in dim

### Resize Handling
- Listen for `SIGWINCH`
- Recalculate viewport height
- Re-render (Ink handles this natively)

---

## Dependencies

```json
{
  "ink": "^4.0.0",
  "ink-text-input": "^5.0.0",
  "react": "^18.0.0"
}
```

~150KB total. Well-maintained. Same stack as Claude Code.

---

## File Structure

```
cli/src/
  tui/
    App.tsx          — root component
    Header.tsx       — banner + status
    Viewport.tsx     — scrollable output area
    Footer.tsx       — input line wrapper
    InputLine.tsx    — text input with history + completion
    useCommand.ts    — hook: dispatch to commander, capture output
    useChat.ts       — hook: OpenClaw gateway chat
    useScroll.ts     — hook: scroll state management
    index.tsx        — render <App /> with Ink
  repl.ts            — KEEP as fallback for --print mode and non-TTY
  index.ts           — route: TTY → tui/, non-TTY/--print → repl.ts
```

---

## Migration Plan

1. Keep existing `repl.ts` as fallback (--print mode, piped input)
2. New `tui/` directory with Ink components
3. `index.ts` checks: if TTY and no --print → launch Ink TUI, else → use simple REPL
4. All existing commands unchanged — only the rendering layer changes
5. `repl.ts` simplified back to basic readline (no ANSI tricks)

---

## Exit Behavior

- Ctrl+C → `\x1b[?1049l` (leave alternate screen) → show goodbye → exit
- All terminal state restored on exit (cursor visible, normal scroll, etc.)
- Alternate screen means the TUI disappears on exit, revealing the original terminal — clean

---

## What This Does NOT Change

- Command implementations (wallet.ts, agent.ts, etc.) — untouched
- Config system — untouched
- Daemon — untouched
- SDKs — untouched
- One-shot mode (`arc402 wallet deploy` without REPL) — untouched

Only the interactive shell rendering layer changes.

---

*Build this exactly as specified. The spec is the contract.*
