# ARC-402 Audit Exclusions (freeze baseline)

For freeze baseline commit `7c79ae7129e222da6391bb198ab93770589507ea`, excluded from audited target unless explicitly versioned:

- local install dirs:
  - `cli/node_modules/`
  - `reference/node_modules/`
  - `reference/circuits/node_modules/`
- local Python virtual envs and caches:
  - `python-sdk/.venv*/`
  - `python-sdk/**/__pycache__/`
- generated local build outputs:
  - `reference/cache/`
  - `reference/out/`
  - `reference/broadcast/`
  - `reference/typechain-types/`
- machine-local env/config values not intentionally committed
- post-freeze arbitration implementation line (separate branch/scope)
- DeFi insurance / pooled financialization features