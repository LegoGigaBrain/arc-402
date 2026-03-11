// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./ARC402Wallet.sol";
import "./ARC402Registry.sol";
import "./ITrustRegistry.sol";

/**
 * @title ARC402WalletFactory
 * @notice Deploys ARC402Wallets pre-wired to the canonical infrastructure via a registry.
 *         Users call createWallet() instead of deploying manually.
 */
contract WalletFactory {
    address public immutable registry;

    mapping(address => address[]) public ownerWallets;
    address[] public allWallets;

    event WalletCreated(address indexed owner, address indexed walletAddress);

    constructor(address _registry) {
        require(_registry != address(0), "WalletFactory: zero registry");
        registry = _registry;
    }

    function createWallet() external returns (address) {
        ARC402Wallet wallet = new ARC402Wallet(registry);
        // ARC402Wallet constructor already calls initWallet; this is idempotent
        ARC402Registry reg = ARC402Registry(registry);
        ITrustRegistry(reg.trustRegistry()).initWallet(address(wallet));

        ownerWallets[msg.sender].push(address(wallet));
        allWallets.push(address(wallet));

        emit WalletCreated(msg.sender, address(wallet));
        return address(wallet);
    }

    function getWallets(address owner) external view returns (address[] memory) {
        return ownerWallets[owner];
    }

    function totalWallets() external view returns (uint256) {
        return allWallets.length;
    }
}
