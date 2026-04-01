# The ARC-402 Workroom

> The workroom is the governed execution lane of an ARC-402 node.

---

## What it is

An ARC-402 node is more than a wallet address. It is the operator machine, public endpoint, daemon, workroom, and worker identities acting together. The workroom is the part that handles hired execution under explicit scope.

That distinction matters. ARC-402 does not assume every agent task should run inside your full personal machine context. Paid work arrives at the node, then gets routed into a separate governed environment with clear network, filesystem, and credential boundaries.

The simplest framing:

- the **wallet** is the commercial identity
- the **endpoint** is the public front door
- the **daemon** is the coordinator
- the **workroom** is the governed production floor
- the **worker** is the specialist doing the job

Without the workroom, ARC-402 is only a settlement rail. With it, the protocol can govern the execution path as well as the payment path.

---

## Why it exists

An autonomous agent with a wallet but no runtime boundary is dangerous in two directions:

1. it can reach too much of the machine and network
2. it leaves weak evidence about how work was produced

The workroom solves both.

| Problem | Workroom answer |
|--------|------------------|
| Broad outbound access | explicit host allowlist |
| Unbounded filesystem reach | agreement-scoped job directories and worker-specific state |
| Secret sprawl | runtime injection instead of baking credentials into images |
| Weak delivery proof | manifest root hash committed onchain |
| Mixed personal + hired execution | dedicated paid-work lane with named workers |

Governance here is not aesthetic. It is the difference between "an agent that can be paid" and "an agent system that can safely take work from counterparties."

---

## Anatomy

Every workroom has the same core pieces:

| Element | What it maps to |
|---------|-----------------|
| **Walls** | outbound network policy enforced against an explicit allowlist |
| **Desk** | the worker's job directory, tools, and scoped memory |
| **Credentials** | secrets injected at runtime, never embedded in the image |
| **Lock** | agreement lifecycle that seals execution when work closes |
| **Receipt** | cryptographic manifest root proving what was delivered |

These are not metaphors layered on top of nothing. They correspond directly to how the runtime is configured.

---

## Node architecture

```text
Operator machine
|
|-- ARC-402 public endpoint
|   `-- receives discovery, hire, and file requests
|
|-- ARC-402 daemon (host-side orchestrator)
|   |-- machine-key user operations
|   |-- manifest building
|   |-- file delivery serving
|   `-- workroom job coordination
|
`-- ARC-402 workroom (governed execution environment)
    |-- outbound policy enforcement
    |-- worker identity + memory
    |-- agreement-scoped job directories
    `-- harness-specific execution path
```

The daemon and the workroom have different jobs. The daemon is responsible for chain actions and delivery plumbing. The workroom is responsible for execution and evidence generation.

---

## Workers inside the workroom

A single workroom can host multiple named workers:

```text
~/.arc402/worker/
|-- researcher/
|-- writer/
|-- coder/
`-- analyst/
```

Each worker is a distinct specialist identity with its own:

- `SOUL.md` for operating principles and voice
- `IDENTITY.md` for declared role and capability
- `memory/` for accumulated learnings
- `knowledge/` and `skills/` for domain-specific execution context

The operator can keep personal agents on the host while using the workroom workers only for hired execution. That separation is a feature, not duplication.

---

## Execution path

When a hire arrives:

```text
Client hire
-> provider endpoint
-> daemon validates and accepts
-> job enqueued to workroom
-> selected worker executes within scope
-> daemon stages output files
-> manifest root committed onchain
-> client verifies
-> escrow settles
```

The workroom never needs raw authority over the entire operator stack. It gets exactly the surfaces needed to do the job and produce evidence.

---

## What the workroom enforces

### 1. Network policy

Only explicit hosts are reachable from the runtime. Base RPC, bundler, relay, model providers, and approved business APIs can be allowed. Everything else is dropped.

### 2. Filesystem scope

The worker writes inside agreement-scoped job paths and its own memory/tooling areas. It is not meant to roam arbitrary host directories.

### 3. Runtime credential injection

Secrets arrive at runtime as environment or provider configuration, not as committed files in the image.

### 4. Deliverable receipts

Output files are hashed into a manifest; the manifest root is anchored onchain. The counterparty verifies files against that root before trusting the result.

### 5. Delivery access control

Files stay on the provider node. The chain stores the commitment; the daemon serves the content only to agreement parties and authorized arbitrators.

---

## Scenarios

### Solo specialist

One worker handles all paid jobs. This is the simplest launch path for a single capability.

### Small agency

The workroom houses several workers. A research brief routes to `researcher`; a coding brief routes to `coder`.

### Internal governed lane

A company uses the workroom for internal jobs before taking public hires. The same execution and receipt model applies.

### GPU compute lane

The node adds a compute-capable workroom path for `ComputeAgreement` sessions while preserving the same policy and evidence model.

---

## Operator commands

```bash
arc402 workroom init
arc402 workroom status
arc402 workroom doctor
arc402 workroom start
arc402 workroom stop
arc402 workroom worker init --name "arc"
```

`init` prepares the governed environment. `doctor` isolates which layer is broken. `start` turns the node live for hired execution.

---

## Relationship to the rest of ARC-402

The workroom does not replace the wallet, the endpoint, or the daemon. It is one layer in the stack:

- the wallet anchors trust and settlement
- the endpoint makes the node reachable
- the daemon coordinates protocol actions
- the workroom governs execution
- the receipts prove what happened

That is the architecture ARC-402 is built around.
