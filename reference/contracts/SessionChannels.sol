// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./ChannelTypes.sol";
import "./ISessionChannels.sol";
import "./ITrustRegistry.sol";
import "./IWatchtowerRegistry.sol";
import "./IArc402Guardian.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @dev Minimal interface to read protocol config from ServiceAgreement.
interface ISAConfig {
    function allowedTokens(address token) external view returns (bool);
    function protocolFeeBps() external view returns (uint256);
    function protocolTreasury() external view returns (address);
    function trustRegistry() external view returns (address);
    function watchtowerRegistry() external view returns (address);
    function guardian() external view returns (address);
}

/// @title SessionChannels
/// @notice Session payment channel contract for ARC-402.
///         Called via ServiceAgreement as a trusted forwarder.
///         SA validates inputs and transfers tokens before calling this contract.
contract SessionChannels is ISessionChannels, ReentrancyGuard {
    using SafeERC20 for IERC20;

    address public immutable serviceAgreement;
    uint256 public constant CHALLENGE_WINDOW = 24 hours;

    mapping(bytes32 => ChannelTypes.Channel) public channels;
    mapping(address => bytes32[]) private _channelsByClient;
    mapping(address => bytes32[]) private _channelsByProvider;
    uint256 private _channelNonce;

    // ─── Events ──────────────────────────────────────────────────────────────

    event ChannelOpened(bytes32 indexed channelId, address indexed client, address indexed provider, address token, uint256 depositAmount, uint256 deadline);
    event ChannelClosing(bytes32 indexed channelId, uint256 sequenceNumber, uint256 settledAmount, uint256 challengeExpiry);
    event ChannelChallenged(bytes32 indexed channelId, address indexed challenger, uint256 newSequenceNumber, uint256 newSettledAmount);
    event ChannelSettled(bytes32 indexed channelId, address indexed provider, uint256 settledAmount, uint256 refundAmount);
    event ChannelExpiredReclaimed(bytes32 indexed channelId, address indexed client, uint256 reclaimedAmount);
    event ChallengeFinalised(bytes32 indexed channelId, address indexed finaliser, uint256 settledAmount);
    event TrustUpdateFailed(address indexed wallet, string context);

    // ─── Modifiers ───────────────────────────────────────────────────────────

    modifier whenNotPaused() {
        address g = ISAConfig(serviceAgreement).guardian();
        if (g != address(0)) {
            require(!IArc402Guardian(g).isPaused(), "SessionChannels: protocol paused");
        }
        _;
    }

    modifier onlySA() {
        require(msg.sender == serviceAgreement, "SessionChannels: not SA");
        _;
    }

    constructor(address _sa) {
        require(_sa != address(0), "SessionChannels: zero SA");
        serviceAgreement = _sa;
    }

    // ─── Session Channel Functions (called via SA as trusted forwarder) ───────

    /// @notice Open a session payment channel.
    ///         Called by SA which has already validated and transferred tokens/ETH.
    ///         For ETH channels: SA forwards msg.value via {value: msg.value}.
    ///         For ERC-20: SA has already transferred tokens to this contract.
    function openSessionChannel(
        address client,
        address provider,
        address token,
        uint256 maxAmount,
        uint256 ratePerCall,
        uint256 deadline
    ) external payable onlySA nonReentrant whenNotPaused returns (bytes32 channelId) {
        unchecked { _channelNonce++; }
        channelId = keccak256(abi.encodePacked(client, provider, token, maxAmount, deadline, block.timestamp, _channelNonce));
        channels[channelId] = ChannelTypes.Channel({
            client: client,
            provider: provider,
            token: token,
            depositAmount: maxAmount,
            settledAmount: 0,
            lastSequenceNumber: 0,
            deadline: deadline,
            challengeExpiry: 0,
            status: ChannelTypes.ChannelStatus.OPEN
        });
        _channelsByClient[client].push(channelId);
        _channelsByProvider[provider].push(channelId);
        emit ChannelOpened(channelId, client, provider, token, maxAmount, deadline);
    }

    function closeChannel(
        address caller,
        bytes32 channelId,
        bytes calldata finalStateBytes
    ) external onlySA nonReentrant whenNotPaused {
        ChannelTypes.Channel storage ch = channels[channelId];
        require(ch.client != address(0), "SessionChannels: channel not found");
        require(ch.status == ChannelTypes.ChannelStatus.OPEN, "SessionChannels: channel not OPEN");
        require(caller == ch.client || caller == ch.provider, "SessionChannels: not a party");
        ChannelTypes.ChannelState memory state = abi.decode(finalStateBytes, (ChannelTypes.ChannelState));
        require(state.channelId == channelId, "SessionChannels: channelId mismatch");
        require(state.token == ch.token, "SessionChannels: token mismatch");
        require(state.cumulativePayment <= ch.depositAmount, "SessionChannels: payment exceeds deposit");
        require(state.sequenceNumber > 0, "SessionChannels: zero sequence number");
        _verifyChannelStateSigs(ch, state);
        ch.status = ChannelTypes.ChannelStatus.CLOSING;
        ch.lastSequenceNumber = state.sequenceNumber;
        ch.settledAmount = state.cumulativePayment;
        ch.challengeExpiry = block.timestamp + CHALLENGE_WINDOW;
        emit ChannelClosing(channelId, state.sequenceNumber, state.cumulativePayment, ch.challengeExpiry);
    }

    function challengeChannel(
        address caller,
        bytes32 channelId,
        bytes calldata latestStateBytes
    ) external onlySA nonReentrant whenNotPaused {
        ChannelTypes.Channel storage ch = channels[channelId];
        require(ch.client != address(0), "SessionChannels: channel not found");
        require(
            ch.status == ChannelTypes.ChannelStatus.CLOSING ||
            ch.status == ChannelTypes.ChannelStatus.OPEN,
            "SessionChannels: not challengeable"
        );
        address watchtowerReg = ISAConfig(serviceAgreement).watchtowerRegistry();
        require(
            caller == ch.client ||
            caller == ch.provider ||
            (watchtowerReg != address(0) && (
                IWatchtowerRegistry(watchtowerReg).channelWatchtower(channelId) == caller ||
                caller == watchtowerReg
            )),
            "SessionChannels: not authorized to challenge"
        );
        if (ch.status == ChannelTypes.ChannelStatus.CLOSING) {
            // slither-disable-next-line timestamp
            require(block.timestamp <= ch.challengeExpiry, "SessionChannels: challenge window expired");
        }
        ChannelTypes.ChannelState memory state = abi.decode(latestStateBytes, (ChannelTypes.ChannelState));
        require(state.channelId == channelId, "SessionChannels: channelId mismatch");
        require(state.token == ch.token, "SessionChannels: token mismatch");
        require(state.cumulativePayment <= ch.depositAmount, "SessionChannels: payment exceeds deposit");
        require(state.sequenceNumber > ch.lastSequenceNumber, "SessionChannels: sequence not higher");
        _verifyChannelStateSigs(ch, state);
        address badFaithCloser = ch.status == ChannelTypes.ChannelStatus.CLOSING
            ? (caller == ch.client ? ch.provider : ch.client)
            : address(0);
        ch.status = ChannelTypes.ChannelStatus.SETTLED;
        ch.settledAmount = state.cumulativePayment;
        ch.lastSequenceNumber = state.sequenceNumber;
        emit ChannelChallenged(channelId, caller, state.sequenceNumber, state.cumulativePayment);
        _settleChannel(channelId, ch);
        if (badFaithCloser != address(0)) {
            address tr = ISAConfig(serviceAgreement).trustRegistry();
            if (tr != address(0)) {
                try ITrustRegistry(tr).recordAnomaly(badFaithCloser, caller, "session-channel-bad-faith", ch.depositAmount) {} catch {
                    emit TrustUpdateFailed(badFaithCloser, "channel:bad-faith-close");
                }
            }
        }
    }

    function finaliseChallenge(address caller, bytes32 channelId) external onlySA nonReentrant {
        ChannelTypes.Channel storage ch = channels[channelId];
        require(ch.client != address(0), "SessionChannels: channel not found");
        require(ch.status == ChannelTypes.ChannelStatus.CLOSING, "SessionChannels: not CLOSING");
        // slither-disable-next-line timestamp
        require(block.timestamp > ch.challengeExpiry, "SessionChannels: challenge window open");
        ch.status = ChannelTypes.ChannelStatus.SETTLED;
        emit ChallengeFinalised(channelId, caller, ch.settledAmount);
        _settleChannel(channelId, ch);
        _updateChannelTrust(channelId, ch, true, false);
    }

    function reclaimExpiredChannel(address caller, bytes32 channelId) external onlySA nonReentrant {
        ChannelTypes.Channel storage ch = channels[channelId];
        require(ch.client != address(0), "SessionChannels: channel not found");
        require(caller == ch.client, "SessionChannels: not client");
        require(ch.status == ChannelTypes.ChannelStatus.OPEN, "SessionChannels: channel not OPEN");
        // slither-disable-next-line timestamp
        require(block.timestamp > ch.deadline, "SessionChannels: deadline not passed");
        ch.status = ChannelTypes.ChannelStatus.SETTLED;
        ch.settledAmount = 0;
        uint256 reclaimAmount = ch.depositAmount;
        emit ChannelExpiredReclaimed(channelId, ch.client, reclaimAmount);
        _releaseEscrow(ch.token, ch.client, reclaimAmount);
        address tr = ISAConfig(serviceAgreement).trustRegistry();
        if (tr != address(0)) {
            try ITrustRegistry(tr).recordAnomaly(ch.provider, ch.client, "session-channel-no-close", ch.depositAmount) {} catch {
                emit TrustUpdateFailed(ch.provider, "channel:no-close");
            }
        }
    }

    /// @dev Returns ABI-encoded Channel struct for SA to decode into its own Channel type.
    function getChannelEncoded(bytes32 channelId) external view returns (bytes memory) {
        require(channels[channelId].client != address(0), "SessionChannels: channel not found");
        ChannelTypes.Channel memory ch = channels[channelId];
        // Encode as SA.Channel (same layout as ChannelTypes.Channel)
        return abi.encode(
            ch.client,
            ch.provider,
            ch.token,
            ch.depositAmount,
            ch.settledAmount,
            ch.lastSequenceNumber,
            ch.deadline,
            ch.challengeExpiry,
            uint8(ch.status)
        );
    }

    function getChannelsByClient(address client) external view returns (bytes32[] memory) {
        return _channelsByClient[client];
    }

    function getChannelsByProvider(address provider) external view returns (bytes32[] memory) {
        return _channelsByProvider[provider];
    }

    // ─── Internal Helpers ─────────────────────────────────────────────────────

    function _settleChannel(bytes32 channelId, ChannelTypes.Channel storage ch) internal {
        uint256 providerAmount = ch.settledAmount;
        uint256 clientRefund = ch.depositAmount - ch.settledAmount;
        emit ChannelSettled(channelId, ch.provider, providerAmount, clientRefund);
        if (providerAmount > 0) _releaseEscrowWithFee(ch.token, ch.provider, providerAmount);
        if (clientRefund > 0) _releaseEscrow(ch.token, ch.client, clientRefund);
    }

    function _updateChannelTrust(bytes32, ChannelTypes.Channel storage ch, bool providerSuccess, bool clientSuccess) internal {
        address tr = ISAConfig(serviceAgreement).trustRegistry();
        if (tr == address(0)) return;
        if (providerSuccess) {
            try ITrustRegistry(tr).recordSuccess(ch.provider, ch.client, "session-channel", ch.settledAmount) {} catch {}
        }
        if (clientSuccess) {
            try ITrustRegistry(tr).recordSuccess(ch.client, ch.provider, "session-channel", ch.settledAmount) {} catch {}
        }
    }

    function _verifyChannelStateSigs(ChannelTypes.Channel storage ch, ChannelTypes.ChannelState memory state) internal view {
        bytes32 messageHash = keccak256(abi.encode(
            state.channelId,
            state.sequenceNumber,
            state.callCount,
            state.cumulativePayment,
            state.token,
            state.timestamp
        ));
        bytes32 ethHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", messageHash));
        address clientSigner = ECDSA.recover(ethHash, state.clientSig);
        address providerSigner = ECDSA.recover(ethHash, state.providerSig);
        require(clientSigner == ch.client, "SessionChannels: invalid client sig");
        require(providerSigner == ch.provider, "SessionChannels: invalid provider sig");
    }

    // wake-disable-next-line reentrancy
    // @dev Called only from nonReentrant-guarded entry points.
    // slither-disable-next-line arbitrary-send-eth
    function _releaseEscrow(address token, address recipient, uint256 amount) internal {
        if (amount == 0) return;
        if (token == address(0)) {
            (bool ok, ) = recipient.call{value: amount}("");
            require(ok, "SessionChannels: ETH transfer failed");
        } else {
            IERC20(token).safeTransfer(recipient, amount);
        }
    }

    function _releaseEscrowWithFee(address token, address provider, uint256 amount) internal {
        if (amount == 0) return;
        uint256 feeBps = ISAConfig(serviceAgreement).protocolFeeBps();
        address treasury = ISAConfig(serviceAgreement).protocolTreasury();
        if (feeBps > 0 && treasury != address(0)) {
            uint256 fee = (amount * feeBps) / 10_000;
            if (fee > 0) _releaseEscrow(token, treasury, fee);
            _releaseEscrow(token, provider, amount - fee);
        } else {
            _releaseEscrow(token, provider, amount);
        }
    }

    receive() external payable {}
}
