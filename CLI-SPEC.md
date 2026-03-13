# ARC-402 CLI — Visual Design Specification

**Version:** v0.1.0  
**Status:** Ready for Engineering  
**Date:** 2026-03-13

---

## The Protocol Mark

`◈` is the ARC-402 mark. It appears in:
- The startup banner
- Spinner states
- Confirmation prompts
- The `arc watch` live feed header

It is the ownable symbol of the protocol. Every CLI session begins and ends with it.

---

## Startup Banner

Displayed on first run and `arc init`. Not shown on subsequent commands.

```
 ┌─────────────────────────────────────┐
 │  ◈  ARC-402 Protocol CLI v0.1.0    │
 │     Agent Resource Contracts        │
 └─────────────────────────────────────┘

 Network   Base Sepolia
 Wallet    0xa214...620
 Balance   0.024 ETH · 150 USDC

 Type 'arc help' to get started
```

**Rules:**
- Box drawn with `┌ ─ ┐ │ └ ┘`
- `◈` in cyan, title in white, subtitle in dim
- Network line: dim label, white value
- Wallet line: dim label, dim address (truncated `0x1234...abcd`)
- Balance line: dim label, white ETH, dim `·`, white token amounts

---

## Visual Language

### Symbols

| Symbol | Meaning |
|--------|---------|
| `◈` | Protocol mark — spinners, prompts, brand |
| `✓` | Success |
| `✗` | Failure |
| `⚠` | Warning / pending |
| `─` | Dividers |
| `├` `└` `│` | Tree structure for agreement/agent details |
| `···` | Loading / async pending |

### Color System (terminal-safe)

| Color | Use |
|-------|-----|
| Cyan | Protocol mark `◈`, section headings |
| White | Primary content, values |
| Dim/gray | Secondary info — addresses, timestamps, labels |
| Green | Success states, fulfilled agreements |
| Red | Errors, disputes, failures |
| Yellow | Warnings, pending states, unconfirmed |

### Address Formatting

Always truncate: `0x1234...abcd` (first 6 + last 4 chars)  
Full address only in `--json` output and transaction hash lines.

### Value Formatting

- ETH: `0.024 ETH`
- Tokens: `50 USDC`
- Combined: `0.024 ETH · 150 USDC`

---

## Design Principles

1. **Sparse chrome. Rich feedback.** Minimal flags visible at once. Output reads top-to-bottom like a story.
2. **Spinners during async work.** Replaced by `✓` or `✗` when done. Never silent.
3. **Color-coded states.** Dim for secondary info, bright for actions, red for errors, green for success.
4. **Indented tree output.** Box-drawing characters for agreement details. Semantic indentation.
5. **Interactive prompts when ambiguous.** Never silent failures on missing input.

---

## Command Reference

### `arc init`

Connect wallet and set network. Run once.

```
◈ Connecting to Base Sepolia...

 Wallet    0xa214...620
 Balance   0.119 ETH
 Network   Base Sepolia (84532)
 Agent     arc402-test-provider [registered]

 ✓ Ready
```

---

### `arc propose`

Create a new agreement.

```
$ arc propose --to 0x80f... --value 50 --token USDC

 ◈ Drafting agreement...

 Agreement #7
 ├ To       0x80fA...Ef9d
 ├ Value    50 USDC
 ├ Expires  72h from confirmation
 └ You      0xa214...620

 Confirm? (y/n) › y

 ✓ Proposed — tx 0xd87e...f304
```

**Flags:**
- `--to <address>` — provider address
- `--value <amount>` — payment amount
- `--token <symbol>` — token (ETH, USDC, etc.)
- `--deadline <duration>` — e.g. `72h`, `7d`
- `--service-type <type>` — service category

---

### `arc accept <id>`

Accept an incoming proposal.

```
$ arc accept 7

 Agreement #7
 ├ From     0xa214...620
 ├ Value    50 USDC
 └ Expires  71h 59m

 Accept this agreement? (y/n) › y

 ✓ Accepted — tx 0x3356...392e
```

---

### `arc deliver <id>`

Mark work delivered. Commits deliverable hash on-chain.

```
$ arc deliver 7 --output ./report.md

 ◈ Hashing deliverable...

 Agreement #7
 ├ Hash     0x27dd4c...5d5
 └ File     ./report.md (4.2 KB)

 Submit deliverable? (y/n) › y

 ✓ Delivered — tx 0xdbf8...c1d5
 ⚠ Verify window: 24h remaining
```

**Flags:**
- `--output <path>` — file to hash and commit
- `--hash <bytes32>` — provide hash directly (advanced)

---

### `arc verify <id>`

Verify delivery and release escrow.

```
$ arc verify 7

 Agreement #7
 ├ Provider   0x80fA...Ef9d
 ├ Delivered  0x27dd...5d5
 └ Value      50 USDC escrowed

 Verify and release payment? (y/n) › y

 ✓ Verified — tx 0x141e...f9a
 ✓ 50 USDC released to 0x80fA...Ef9d
```

---

### `arc dispute <id>`

Open a dispute on an agreement.

```
$ arc dispute 7

 Agreement #7
 ├ Provider   0x80fA...Ef9d
 ├ Value      50 USDC escrowed
 └ Status     DELIVERED

 Dispute reason:
 › HARD_DEADLINE_BREACH
   INVALID_OR_FRAUDULENT_DELIVERABLE
   QUALITY_BELOW_STANDARD
   OTHER

 ✓ Dispute opened — tx 0x39ec...fb6
```

---

### `arc cancel <id>`

Cancel an agreement (before delivery).

```
$ arc cancel 7

 Agreement #7 — cancellation

 ⚠ This will return 50 USDC to your wallet.
 Cancel? (y/n) › y

 ✓ Cancelled — tx 0xfddb...4e0
```

---

### `arc status <id>`

View full detail on a single agreement.

```
$ arc status 7

 Agreement #7   ACTIVE
 ├ Provider     0x80fA...Ef9d  [delivering]
 ├ Client       0xa214...620   [you]
 ├ Value        50 USDC        (escrowed)
 ├ Service      consulting
 └ Expires in   61h 14m
```

States: `PROPOSED` `ACTIVE` `DELIVERED` `FULFILLED` `DISPUTED` `CANCELLED` `RESOLVED`

---

### `arc list`

List all agreements for connected wallet.

```
$ arc list

 Your Agreements

 #4   FULFILLED   50 USDC   0x80fA...Ef9d   3h ago
 #5   ACTIVE      0.01 ETH  0x3ab1...cc20   12h ago
 #6   DISPUTED    100 USDC  0x9f22...8811   2d ago
 #7   PROPOSED    50 USDC   0x80fA...Ef9d   just now

 4 agreements  ·  2 active  ·  1 disputed
```

**Flags:**
- `--as provider` — view as provider
- `--status <state>` — filter by state

---

### `arc watch`

Live feed of protocol activity for connected wallet.

```
$ arc watch

 ◈  ARC-402  Watching 0xa214...620 ──────────────────────

 [20:25]  Agreement #7 → DELIVERED    (provider: 0x80fA...)
 [20:31]  Agreement #8 → PROPOSED     (incoming from 0x3ab...)
 [20:44]  Agreement #6 → FULFILLED    +50 USDC released

 ···  waiting
```

Streams protocol events in real time via RPC subscription.  
`Ctrl+C` to exit.

---

### `arc agent <address>`

View any agent's on-chain profile.

```
$ arc agent 0x80fA...Ef9d

 Agent  0x80fA...Ef9d
 ├ Name          arc402-test-provider
 ├ Service       compute, research
 ├ Trust score   105  [Established]
 ├ Uptime        98.2%
 ├ Heartbeat     2m ago
 └ Agreements    12 fulfilled · 1 disputed
```

---

### `arc balance`

Wallet and escrow balances.

```
$ arc balance

 Wallet    0xa214...620
 ├ ETH     0.119 ETH
 ├ USDC    340.00 USDC
 └ Escrow  50 USDC locked (agreement #5)
```

---

### `arc history`

Transaction history for connected wallet.

```
$ arc history

 Transaction History  ·  0xa214...620

 0x141e...f9a   FULFILLED   +50 USDC     Agreement #4   3h ago
 0xdbf8...c1d5  DELIVERED   —            Agreement #7   1h ago
 0x3356...392e  ACCEPTED    —            Agreement #7   2h ago
 0xd87e...f304  PROPOSED    -50 USDC     Agreement #7   2h ago

 Showing 4 of 14  ·  arc history --all to see more
```

---

### `arc help`

Command reference.

```
 ◈  ARC-402 Protocol CLI v0.1.0

 Usage: arc <command> [options]

 Commands:
   init               Connect wallet + set network
   propose            Create a new agreement
   accept <id>        Accept an incoming proposal
   deliver <id>       Mark work delivered
   verify <id>        Verify delivery + release payment
   dispute <id>       Open a dispute
   cancel <id>        Cancel an agreement
   status <id>        View agreement detail
   list               List your agreements
   watch              Live protocol feed
   agent <address>    View agent profile
   balance            Wallet + escrow balances
   history            Transaction history
   help               This screen

 Flags:
   --json             Machine-readable output
   --network <name>   Override network (base, base-sepolia)
   --wallet <path>    Override wallet config

 arc <command> --help for command-specific options
```

---

## Machine Mode (`--json`)

Every command supports `--json`. Output is valid JSON, one object per line (NDJSON for streaming).

```bash
$ arc status 7 --json
{"id":7,"status":"ACTIVE","provider":"0x80fA...","client":"0xa214...","value":"50","token":"USDC","expiresAt":1741999200}

$ arc list --json
[{"id":4,"status":"FULFILLED",...},{"id":5,"status":"ACTIVE",...}]
```

### Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | General error |
| 2 | Invalid arguments |
| 3 | Transaction failed / reverted |
| 4 | Network / RPC error |
| 5 | Wallet / auth error |

---

## Error Patterns

```
 ✗ Agreement #7 not found

 ✗ Transaction reverted: "ServiceAgreement: deadline not passed"

 ✗ RPC connection failed — check network config
   arc init --network base-sepolia to reconnect

 ⚠ Agreement #7 is already FULFILLED
```

Rules:
- Short, direct error message on the `✗` line
- Optional context / fix hint on indented line below
- Never silent failures
- `--json` mode: `{"error": "message", "code": 3}`

---

## Spinner Behavior

Async operations (transaction broadcasts, RPC calls) show:

```
 ◈ Submitting transaction...    ← spinning ◈
 ✓ Proposed — tx 0xd87e...      ← replaced on completion
```

The `◈` spins via unicode rotation frames. Replaced in-place by `✓` or `✗`.

---

## Config File Structure

`~/.arc402/config.json`

```json
{
  "network": "base-sepolia",
  "rpcUrl": "https://sepolia.base.org",
  "privateKey": "***",
  "walletContractAddress": "0x...",
  "contracts": {
    "policyEngine": "0x44102e70c2A366632d98Fe40d892a2501fC7fFF2",
    "agentRegistry": "0x07D526f8A8e148570509aFa249EFF295045A0cc9",
    "walletFactory": "0xD560C22aD5372Aa830ee5ffBFa4a5D9f528e7B87",
    "trustRegistry": "0x1D38Cf67686820D970C146ED1CC98fc83613f02B",
    "trustRegistryV2": "0xfCc2CDC42654e05Dad5F6734cE5caFf3dAE0E94F",
    "serviceAgreement": "0xa214d30906a934358f451514da1ba732ad79f158",
    "sessionChannels": "0x21340f81f5ddc9c213ff2ac45f0f34fb2449386d",
    "reputationOracle": "0x410e650113fd163389C956BC7fC51c5642617187",
    "arc402Registry": "0x638C7d106a2B7beC9ef4e0eA7d64ed8ab656A7e6"
  }
}
```

`privateKey` is always masked as `***` in all CLI output. Never logged.

---

## File Structure for Engineering

```
cli/
  src/
    commands/
      init.ts        ← arc init
      propose.ts     ← arc propose
      accept.ts      ← arc accept
      deliver.ts     ← arc deliver
      verify.ts      ← arc verify
      dispute.ts     ← arc dispute
      cancel.ts      ← arc cancel
      status.ts      ← arc status
      list.ts        ← arc list
      watch.ts       ← arc watch
      agent.ts       ← arc agent
      balance.ts     ← arc balance
      history.ts     ← arc history
      help.ts        ← arc help
    ui/
      banner.ts      ← startup banner renderer
      spinner.ts     ← ◈ spinner with replace-in-place
      tree.ts        ← box-drawing tree renderer
      colors.ts      ← color system constants
      format.ts      ← address/value/timestamp formatters
    index.ts         ← CLI entry point
```

---

*Hand this to Engineering as-is. All visual decisions are locked. Build exactly what's shown.*
