// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title P256VerifierLib
/// @notice Library for P256 (secp256r1) signature verification via the Base RIP-7212 precompile.
///         Extracted from ARC402Wallet to keep the main contract under the EIP-170 24,576-byte limit.
library P256VerifierLib {
    address internal constant VERIFIER    = 0x0000000000000000000000000000000000000100;
    uint256 internal constant SIG_VALID   = 0;
    uint256 internal constant SIG_INVALID = 1;

    /// @notice Verify a compact P256 signature against a message hash and public key.
    /// @param hash      The 32-byte message hash that was signed.
    /// @param signature 64-byte compact signature: r (32 bytes) || s (32 bytes).
    /// @param pubKeyX   P256 public key x coordinate.
    /// @param pubKeyY   P256 public key y coordinate.
    /// @return SIG_VALID (0) on success, SIG_INVALID (1) on failure or precompile absent.
    function validateP256Signature(
        bytes32 hash,
        bytes memory signature,
        bytes32 pubKeyX,
        bytes32 pubKeyY
    ) internal view returns (uint256) {
        if (signature.length != 64) return SIG_INVALID;
        bytes32 r;
        bytes32 s;
        // solhint-disable-next-line no-inline-assembly
        assembly {
            r := mload(add(signature, 32))
            s := mload(add(signature, 64))
        }
        // RIP-7212 input: hash (32) || r (32) || s (32) || x (32) || y (32) = 160 bytes
        bytes memory input = abi.encodePacked(hash, r, s, pubKeyX, pubKeyY);
        (bool success, bytes memory result) = VERIFIER.staticcall(input);
        if (!success || result.length < 32) return SIG_INVALID;
        return abi.decode(result, (uint256)) == 1 ? SIG_VALID : SIG_INVALID;
    }
}
