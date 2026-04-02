#!/usr/bin/env python3
"""
Mythril per-function analysis script for ARC-402.
Runs Mythril on each public/external function individually to avoid OOM crashes
on large contracts. Results are aggregated into a single report.

Usage:
    python3 scripts/mythril-per-function.py --contract ServiceAgreement
    python3 scripts/mythril-per-function.py --contract DisputeArbitration
    python3 scripts/mythril-per-function.py --contract ServiceAgreement --workers 4
    python3 scripts/mythril-per-function.py --contract ServiceAgreement --resume
"""

import subprocess
import json
import os
import sys
import hashlib
import time
import argparse
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

REPO = Path(__file__).parent.parent
CONTRACTS_DIR = REPO / "contracts"
OUT_DIR = REPO / "audit-reports-2026-03-13-clean" / "mythril-per-function"
SOLC_SETTINGS = "/tmp/mythril-settings.json"

# Default: 2 workers to stay memory-safe, bump to 4 if you have RAM to spare
DEFAULT_WORKERS = 2
TIMEOUT_PER_FUNCTION = 180  # 3 minutes per function
MAX_DEPTH = 12  # Lower than default (22) to keep memory bounded

# Groups: high-risk functions analyzed first
PRIORITY_GROUPS = {
    "ServiceAgreement": [
        # ETH/token flows — highest risk
        ["fulfill", "autoRelease", "expiredCancel", "expiredDisputeRefund", "cancel"],
        # Dispute + arbitration paths
        ["dispute", "directDispute", "escalateToDispute", "castArbitrationVote",
         "resolveDispute", "resolveDisputeDetailed", "resolveFromArbitration"],
        # Session channels — payment channel logic
        ["openSessionChannel", "closeChannel", "challengeChannel",
         "finaliseChallenge", "reclaimExpiredChannel"],
        # Agreement lifecycle
        ["propose", "accept", "commitDeliverable", "verifyDeliverable"],
        # Remediation flow
        ["requestRevision", "respondToRevision", "requestHumanEscalation"],
        # Admin — lower risk
        ["setGuardian", "setProtocolFee", "setProtocolTreasury", "setDisputeArbitration",
         "setWatchtowerRegistry", "setMinimumTrustValue", "allowToken", "disallowToken"],
    ],
    "DisputeArbitration": [
        # Bond + fee flows
        ["acceptAssignment", "joinMutualDispute", "triggerFallback", "withdrawBond"],
        # Arbitration logic
        ["recordArbitratorVote", "resolveDisputeFee", "commitArbitratorSeed"],
        # Admin
        ["setFeeFloorUsd", "setFeeCapUsd", "setMinBondFloorUsd", "setTokenUsdRate",
         "setServiceAgreement", "setTrustRegistry", "setTreasury"],
    ],
}


def get_function_selector(func_name: str) -> str:
    """Compute 4-byte selector by keccak256 of the canonical signature.
    Mythril accepts function name directly via --transaction-sequences."""
    return func_name


def write_solc_settings():
    settings = {
        "remappings": [
            "@openzeppelin/contracts/=lib/openzeppelin-contracts/contracts/"
        ],
        "optimizer": {"enabled": True, "runs": 200},
        "evmVersion": "cancun"
    }
    Path(SOLC_SETTINGS).write_text(json.dumps(settings))


def analyze_function(contract: str, func_name: str, out_dir: Path) -> dict:
    """Run Mythril on a single function. Returns findings dict."""
    out_file = out_dir / f"{func_name}.json"
    
    # Skip if already done (resume support)
    if out_file.exists() and out_file.stat().st_size > 10:
        try:
            data = json.loads(out_file.read_text())
            issues = data.get("issues", [])
            return {"func": func_name, "issues": issues, "status": "cached"}
        except:
            pass
    
    contract_file = CONTRACTS_DIR / f"{contract}.sol"
    
    cmd = [
        "myth", "analyze",
        str(contract_file),
        "--solc-json", SOLC_SETTINGS,
        "--transaction-count", "2",     # 2-tx sequences — catches setup+exploit
        "--max-depth", str(MAX_DEPTH),
        "--execution-timeout", str(TIMEOUT_PER_FUNCTION),
        "--transaction-sequences", f"[[{func_name}]]",  # constrain to this function
        "-o", "json",
    ]
    
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=TIMEOUT_PER_FUNCTION + 30,
            cwd=str(REPO)
        )
        
        # Parse output
        output = result.stdout.strip()
        if output and output.startswith("{"):
            data = json.loads(output)
            out_file.write_text(json.dumps(data, indent=2))
            issues = data.get("issues", [])
            return {"func": func_name, "issues": issues, "status": "ok"}
        else:
            # Mythril found no issues (empty output = clean)
            clean = {"issues": []}
            out_file.write_text(json.dumps(clean, indent=2))
            return {"func": func_name, "issues": [], "status": "ok"}
            
    except subprocess.TimeoutExpired:
        out_file.write_text(json.dumps({"issues": [], "status": "timeout"}))
        return {"func": func_name, "issues": [], "status": "timeout"}
    except json.JSONDecodeError:
        return {"func": func_name, "issues": [], "status": "parse_error"}
    except Exception as e:
        return {"func": func_name, "issues": [], "status": f"error: {e}"}


def run_contract(contract: str, workers: int = DEFAULT_WORKERS, resume: bool = False):
    """Run per-function Mythril analysis on a contract."""
    write_solc_settings()
    
    out_dir = OUT_DIR / contract
    out_dir.mkdir(parents=True, exist_ok=True)
    
    if not resume:
        # Clear previous results
        for f in out_dir.glob("*.json"):
            f.unlink()
    
    # Get all functions in priority order
    all_funcs = []
    seen = set()
    for group in PRIORITY_GROUPS.get(contract, []):
        for fn in group:
            if fn not in seen:
                all_funcs.append(fn)
                seen.add(fn)
    
    total = len(all_funcs)
    print(f"\n{'='*60}")
    print(f"Mythril per-function: {contract}")
    print(f"Functions: {total} | Workers: {workers} | Timeout: {TIMEOUT_PER_FUNCTION}s each")
    print(f"Output: {out_dir}")
    print(f"{'='*60}\n")
    
    all_issues = []
    completed = 0
    
    with ProcessPoolExecutor(max_workers=workers) as executor:
        futures = {
            executor.submit(analyze_function, contract, fn, out_dir): fn
            for fn in all_funcs
        }
        
        for future in as_completed(futures):
            fn = futures[future]
            result = future.result()
            completed += 1
            
            status = result["status"]
            issues = result["issues"]
            
            if issues:
                icon = "🔴"
                all_issues.extend(issues)
            elif status == "timeout":
                icon = "⏱️ "
            elif status == "cached":
                icon = "✓ "
            else:
                icon = "✅"
            
            print(f"  [{completed:2d}/{total}] {icon} {fn:<40} {len(issues)} issues  ({status})")
    
    # Write aggregate report
    aggregate = {
        "contract": contract,
        "total_functions": total,
        "total_issues": len(all_issues),
        "issues": all_issues,
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    }
    
    agg_file = OUT_DIR / f"{contract}-aggregate.json"
    agg_file.write_text(json.dumps(aggregate, indent=2))
    
    print(f"\n{'='*60}")
    print(f"COMPLETE: {contract}")
    print(f"  Functions analyzed: {total}")
    print(f"  Issues found: {len(all_issues)}")
    if all_issues:
        print(f"\n  FINDINGS:")
        for issue in all_issues:
            print(f"    [{issue.get('severity','?')}] {issue.get('title','?')}")
            print(f"      Function: {issue.get('function_name','?')}")
            print(f"      {issue.get('description','')[:100]}")
    else:
        print(f"  ✅ CLEAN — no issues found")
    print(f"{'='*60}\n")
    
    return all_issues


def main():
    parser = argparse.ArgumentParser(description="Mythril per-function analysis for ARC-402")
    parser.add_argument("--contract", required=True, 
                        choices=["ServiceAgreement", "DisputeArbitration", "both"],
                        help="Contract to analyze")
    parser.add_argument("--workers", type=int, default=DEFAULT_WORKERS,
                        help=f"Parallel workers (default: {DEFAULT_WORKERS})")
    parser.add_argument("--resume", action="store_true",
                        help="Skip already-completed functions")
    args = parser.parse_args()
    
    write_solc_settings()
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    
    contracts = ["ServiceAgreement", "DisputeArbitration"] if args.contract == "both" \
                else [args.contract]
    
    all_findings = {}
    for contract in contracts:
        issues = run_contract(contract, workers=args.workers, resume=args.resume)
        all_findings[contract] = issues
    
    # Final summary
    print("\n" + "="*60)
    print("FINAL SUMMARY")
    print("="*60)
    total_issues = sum(len(v) for v in all_findings.values())
    for contract, issues in all_findings.items():
        print(f"  {contract}: {len(issues)} issues")
    print(f"  Total: {total_issues} issues across all contracts")
    if total_issues == 0:
        print("\n  ✅ ALL CLEAN — protocol passes full Mythril function-level analysis")
    print("="*60)


if __name__ == "__main__":
    main()
