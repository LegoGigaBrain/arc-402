#!/bin/bash
# ARC-402 ZK Circuit Build Script
# Compiles Circom circuits → generates R1CS → generates proving/verification keys → generates Solidity verifiers
set -e

CIRCUITS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTRACTS_DIR="$CIRCUITS_DIR/../contracts"
BUILD_DIR="$CIRCUITS_DIR/build"
PTAU_DIR="$CIRCUITS_DIR/ptau"

mkdir -p "$BUILD_DIR" "$PTAU_DIR"

echo "=== ARC-402 ZK Build Pipeline ==="

# ─── 1. Install circomlib ──────────────────────────────────────────────────────
if [ ! -d "$CIRCUITS_DIR/node_modules/circomlib" ]; then
    echo "[1/6] Installing circomlib..."
    cd "$CIRCUITS_DIR" && npm install circomlib
else
    echo "[1/6] circomlib already installed"
fi

# ─── 2. Download Powers of Tau (phase 1, pre-computed, trusted) ───────────────
PTAU_FILE="$PTAU_DIR/pot12_final.ptau"
if [ ! -f "$PTAU_FILE" ]; then
    echo "[2/6] Downloading Powers of Tau (pot12, 2^12 = 4096 constraints max)..."
    curl -L -o "$PTAU_FILE" \
      "https://storage.googleapis.com/zkevm/ptau/powersOfTau28_hez_final_12.ptau"
else
    echo "[2/6] Powers of Tau already present"
fi

# ─── 3. Compile circuits ──────────────────────────────────────────────────────
echo "[3/6] Compiling circuits..."

compile_circuit() {
    local NAME=$1
    local CIRCOM_FILE="$CIRCUITS_DIR/${NAME}.circom"
    local OUT_DIR="$BUILD_DIR/$NAME"
    mkdir -p "$OUT_DIR"

    echo "  Compiling $NAME..."
    circom "$CIRCOM_FILE" \
        --r1cs --wasm --sym \
        --output "$OUT_DIR" \
        --prime bn128

    echo "  ✓ $NAME compiled ($(du -sh $OUT_DIR/${NAME}.r1cs | cut -f1) R1CS)"
}

compile_circuit "TrustThreshold"
compile_circuit "SolvencyProof"
compile_circuit "CapabilityProof"

# ─── 4. Phase 2 trusted setup (circuit-specific) ─────────────────────────────
echo "[4/6] Running phase 2 setup..."

setup_circuit() {
    local NAME=$1
    local OUT_DIR="$BUILD_DIR/$NAME"

    snarkjs groth16 setup \
        "$OUT_DIR/${NAME}.r1cs" \
        "$PTAU_FILE" \
        "$OUT_DIR/${NAME}_0000.zkey"

    # Contribute randomness (deterministic for dev — use real randomness for production)
    echo "dev-entropy-$NAME" | snarkjs zkey contribute \
        "$OUT_DIR/${NAME}_0000.zkey" \
        "$OUT_DIR/${NAME}_final.zkey" \
        --name="ARC-402 Dev Setup" -v 2>/dev/null

    echo "  ✓ $NAME phase 2 complete"
}

setup_circuit "TrustThreshold"
setup_circuit "SolvencyProof"
setup_circuit "CapabilityProof"

# ─── 5. Export verification keys ──────────────────────────────────────────────
echo "[5/6] Exporting verification keys..."

for NAME in TrustThreshold SolvencyProof CapabilityProof; do
    OUT_DIR="$BUILD_DIR/$NAME"
    snarkjs zkey export verificationkey \
        "$OUT_DIR/${NAME}_final.zkey" \
        "$OUT_DIR/verification_key.json"
    echo "  ✓ $NAME verification key exported"
done

# ─── 6. Generate Solidity verifier contracts ──────────────────────────────────
echo "[6/6] Generating Solidity verifiers..."

for NAME in TrustThreshold SolvencyProof CapabilityProof; do
    OUT_DIR="$BUILD_DIR/$NAME"
    snarkjs zkey export solidityverifier \
        "$OUT_DIR/${NAME}_final.zkey" \
        "$CONTRACTS_DIR/${NAME}Verifier.sol"
    echo "  ✓ ${NAME}Verifier.sol generated"
done

echo ""
echo "=== ZK Build Complete ==="
echo "Verifier contracts written to: $CONTRACTS_DIR/"
echo ""
echo "Next steps:"
echo "  1. Review generated verifier contracts"
echo "  2. Write wrapper contracts (ZKTrustGate.sol, ZKSolvencyGate.sol, ZKCapabilityGate.sol)"
echo "  3. Run forge build && forge test"
echo ""
echo "IMPORTANT: These keys use dev-entropy. For mainnet, run a proper"
echo "           multi-party trusted setup ceremony before deployment."
