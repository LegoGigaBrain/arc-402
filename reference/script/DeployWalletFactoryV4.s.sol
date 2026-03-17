// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../contracts/WalletFactoryV4.sol";

/**
 * @title DeployWalletFactoryV4
 * @notice Deploys WalletFactory v4 using the code-oracle pattern.
 *         v4 adds passkey P256 (secp256r1 / WebAuthn) support via Spec-33.
 *
 * Two transactions are broadcast:
 *   1. Oracle — a contract whose runtime code = ARC402Wallet creation code (passkey-enabled)
 *   2. WalletFactoryV4 — lean factory that references the oracle (~4 KB ✓)
 *
 * Required env vars:
 *   DEPLOYER_PRIVATE_KEY   — deployer private key
 *   ARC402_REGISTRY_V2     — ARC402RegistryV2 address on the target chain
 */
contract DeployWalletFactoryV4 is Script {

    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address registry    = vm.envAddress("ARC402_REGISTRY_V2");

        console.log("Deployer:         ", vm.addr(deployerKey));
        console.log("ARC402RegistryV2: ", registry);

        bytes memory walletCode = vm.getCode("ARC402Wallet.sol:ARC402Wallet");
        console.log("Wallet code len:  ", walletCode.length);

        vm.startBroadcast(deployerKey);
        (address oracle, address factory) = _deploy(registry, walletCode);
        vm.stopBroadcast();

        console.log("");
        console.log("=== WalletFactory v4 DEPLOYED (passkey P256 support) ===");
        console.log("WalletFactoryV4:  ", factory);
        console.log("WalletCodeOracle: ", oracle);
        console.log("Registry:         ", WalletFactoryV4(factory).registry());
        console.log("EntryPoint:       ", WalletFactoryV4(factory).DEFAULT_ENTRY_POINT());
    }

    function _deploy(address registry, bytes memory walletCode)
        internal returns (address oracle, address factory)
    {
        oracle  = _deployCodeOracle(walletCode);
        factory = address(new WalletFactoryV4(registry, oracle));
        console.log("WalletCodeOracle: ", oracle);
        console.log("WalletFactoryV4:  ", factory);
    }

    /**
     * @dev Deploy a contract whose RUNTIME CODE equals `creationCode`.
     *      Init code (12 bytes): PUSH2 len  DUP1  PUSH1 12  PUSH1 0  CODECOPY  PUSH1 0  RETURN
     *      followed by the creation code payload.
     */
    function _deployCodeOracle(bytes memory creationCode) internal returns (address oracle) {
        uint256 codeLen = creationCode.length;
        require(codeLen > 0 && codeLen < 65536, "oracle: bad len");

        // Build 12-byte EVM init-code prefix
        bytes memory prefix = new bytes(12);
        prefix[0]  = 0x61;                       // PUSH2
        prefix[1]  = bytes1(uint8(codeLen >> 8)); // len high
        prefix[2]  = bytes1(uint8(codeLen));      // len low
        prefix[3]  = 0x80;                        // DUP1
        prefix[4]  = 0x60;                        // PUSH1
        prefix[5]  = 0x0c;                        // 12 (payload offset)
        prefix[6]  = 0x60;                        // PUSH1
        prefix[7]  = 0x00;                        // 0 (mem dest)
        prefix[8]  = 0x39;                        // CODECOPY
        prefix[9]  = 0x60;                        // PUSH1
        prefix[10] = 0x00;                        // 0
        prefix[11] = 0xf3;                        // RETURN

        bytes memory initCode = abi.encodePacked(prefix, creationCode);
        assembly { oracle := create(0, add(initCode, 0x20), mload(initCode)) }
        require(oracle != address(0), "oracle: deploy failed");
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// POST-DEPLOY REQUIRED:
//   cast send <TrustRegistryV3> "addUpdater(address)" <WalletFactoryV4>
//   Without this, createWallet() reverts: "TrustRegistryV3: not authorized updater"
// ──────────────────────────────────────────────────────────────────────────────
