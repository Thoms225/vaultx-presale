// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

/**
 * @title PresaleVault
 * @notice Multi-round token presale with whitelist gating and linear vesting
 * @dev Supports ETH and BNB networks (deployed separately on each chain)
 *
 * Rounds   : Pre-Seed (0) → Seed (1) → Public (2)
 * Vesting  : cliff period + monthly linear release via claimVested()
 * Whitelist: Merkle proof verification for private rounds
 */
contract PresaleVault is Ownable, ReentrancyGuard {

    // ─────────────────────────────────────────────
    // MODULE 1 — STRUCTURES & STATE
    // Structs are tightly packed to minimize storage slots and gas costs
    // ─────────────────────────────────────────────

    IERC20 public immutable token;

    enum RoundType { PreSeed, Seed, Public }

    // Packed into 4 storage slots (down from 6)
    // Slot 0: tokenPrice(128) + hardCap(128)
    // Slot 1: totalRaised(128) + tokensAllocated(128)
    // Slot 2: isOpen(8) + whitelistRequired(8)
    // Slot 3: merkleRoot(256)
    struct Round {
        uint128 tokenPrice;
        uint128 hardCap;
        uint128 totalRaised;
        uint128 tokensAllocated;
        bool isOpen;
        bool whitelistRequired;
        bytes32 merkleRoot;
    }

    // Packed into 2 storage slots (down from 5)
    // Slot 0: totalTokens(128) + claimedTokens(128)
    // Slot 1: startTime(64) + cliffDuration(32) + vestingDuration(32)
    struct VestingSchedule {
        uint128 totalTokens;
        uint128 claimedTokens;
        uint64  startTime;
        uint32  cliffDuration;
        uint32  vestingDuration;
    }

    mapping(RoundType => Round) public rounds;
    mapping(address => VestingSchedule) public vestingSchedules;

    address public treasury;

    // ─────────────────────────────────────────────
    // MODULE 2 — EVENTS
    // ─────────────────────────────────────────────

    event TokensPurchased(
        address indexed buyer,
        RoundType indexed round,
        uint256 amountPaid,
        uint256 tokensAllocated
    );

    event VestingClaimed(
        address indexed claimer,
        uint256 tokensClaimed,
        uint256 remainingLocked
    );

    event RoundOpened(RoundType indexed round, uint256 tokenPrice, uint256 hardCap);
    event RoundClosed(RoundType indexed round, uint256 totalRaised);
    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);

    // ─────────────────────────────────────────────
    // MODULE 3 — CONSTRUCTOR
    // ─────────────────────────────────────────────

    constructor(address _token, address _treasury) Ownable(msg.sender) {
        require(_token != address(0), "PresaleVault: zero token address");
        require(_treasury != address(0), "PresaleVault: zero treasury address");

        token = IERC20(_token);
        treasury = _treasury;

        rounds[RoundType.PreSeed] = Round({
            tokenPrice       : 0.0001 ether,
            hardCap          : 100 ether,
            totalRaised      : 0,
            tokensAllocated  : 0,
            isOpen           : false,
            whitelistRequired: true,
            merkleRoot       : bytes32(0)
        });

        rounds[RoundType.Seed] = Round({
            tokenPrice       : 0.0002 ether,
            hardCap          : 300 ether,
            totalRaised      : 0,
            tokensAllocated  : 0,
            isOpen           : false,
            whitelistRequired: true,
            merkleRoot       : bytes32(0)
        });

        rounds[RoundType.Public] = Round({
            tokenPrice       : 0.0005 ether,
            hardCap          : 1000 ether,
            totalRaised      : 0,
            tokensAllocated  : 0,
            isOpen           : false,
            whitelistRequired: false,
            merkleRoot       : bytes32(0)
        });
    }

    // ─────────────────────────────────────────────
    // MODULE 4 — ROUND MANAGEMENT (Owner only)
    // ─────────────────────────────────────────────

    function openRound(
        RoundType roundType,
        bytes32 merkleRoot
    ) external onlyOwner {
        Round storage r = rounds[roundType];
        require(!r.isOpen, "PresaleVault: round already open");

        if (r.whitelistRequired) {
            require(merkleRoot != bytes32(0), "PresaleVault: merkle root required");
            r.merkleRoot = merkleRoot;
        }

        r.isOpen = true;
        emit RoundOpened(roundType, r.tokenPrice, r.hardCap);
    }

    function closeRound(RoundType roundType) external onlyOwner {
        Round storage r = rounds[roundType];
        require(r.isOpen, "PresaleVault: round not open");
        r.isOpen = false;
        emit RoundClosed(roundType, r.totalRaised);
    }

    function setTreasury(address newTreasury) external onlyOwner {
        require(newTreasury != address(0), "PresaleVault: zero address");
        emit TreasuryUpdated(treasury, newTreasury);
        treasury = newTreasury;
    }

    // ─────────────────────────────────────────────
    // MODULE 5 — PURCHASE LOGIC
    // ─────────────────────────────────────────────

    function buyTokens(
        RoundType roundType,
        bytes32[] calldata merkleProof
    ) external payable nonReentrant {
        require(msg.value > 0, "PresaleVault: send ETH/BNB to buy");

        Round storage r = rounds[roundType];
        require(r.isOpen, "PresaleVault: round is closed");

        uint128 payment = uint128(msg.value);
        uint128 newTotalRaised;
        unchecked { newTotalRaised = r.totalRaised + payment; }
        require(newTotalRaised <= r.hardCap, "PresaleVault: hard cap exceeded");

        if (r.whitelistRequired) {
            bytes32 leaf = keccak256(abi.encodePacked(msg.sender));
            require(
                MerkleProof.verify(merkleProof, r.merkleRoot, leaf),
                "PresaleVault: not whitelisted"
            );
        }

        uint128 tokensToAllocate = uint128((msg.value * 1e18) / r.tokenPrice);
        require(tokensToAllocate > 0, "PresaleVault: amount too small");

        unchecked {
            r.totalRaised     = newTotalRaised;
            r.tokensAllocated += tokensToAllocate;
        }

        if (newTotalRaised == r.hardCap) {
            r.isOpen = false;
            emit RoundClosed(roundType, newTotalRaised);
        }

        _updateVesting(msg.sender, tokensToAllocate, roundType);

        (bool sent, ) = treasury.call{value: msg.value}("");
        require(sent, "PresaleVault: treasury transfer failed");

        emit TokensPurchased(msg.sender, roundType, msg.value, tokensToAllocate);
    }

    // ─────────────────────────────────────────────
    // MODULE 6 — VESTING LOGIC
    // ─────────────────────────────────────────────

    function _updateVesting(
        address buyer,
        uint128 tokensToAllocate,
        RoundType roundType
    ) internal {
        VestingSchedule storage vs = vestingSchedules[buyer];

        if (vs.totalTokens == 0) {
            (uint32 cliff, uint32 duration) = _getVestingParams(roundType);
            vs.startTime       = uint64(block.timestamp);
            vs.cliffDuration   = cliff;
            vs.vestingDuration = duration;
        }

        unchecked { vs.totalTokens += tokensToAllocate; }
    }

    function _getVestingParams(
        RoundType roundType
    ) internal pure returns (uint32 cliff, uint32 duration) {
        if (roundType == RoundType.PreSeed) {
            return (uint32(180 days), uint32(720 days));
        } else if (roundType == RoundType.Seed) {
            return (uint32(90 days), uint32(540 days));
        } else {
            return (uint32(30 days), uint32(360 days));
        }
    }

    function claimVested() external nonReentrant {
        VestingSchedule storage vs = vestingSchedules[msg.sender];
        require(vs.totalTokens > 0, "PresaleVault: no vesting schedule");

        uint128 unlocked  = _computeUnlocked(vs);
        uint128 claimable = unlocked - vs.claimedTokens;
        require(claimable > 0, "PresaleVault: nothing to claim yet");

        vs.claimedTokens += claimable;

        require(
            token.transfer(msg.sender, claimable),
            "PresaleVault: token transfer failed"
        );

        emit VestingClaimed(
            msg.sender,
            claimable,
            vs.totalTokens - vs.claimedTokens
        );
    }

    function _computeUnlocked(
        VestingSchedule storage vs
    ) internal view returns (uint128) {
        uint256 elapsed = block.timestamp - vs.startTime;

        if (elapsed < vs.cliffDuration)   return 0;
        if (elapsed >= vs.vestingDuration) return vs.totalTokens;

        return uint128((uint256(vs.totalTokens) * elapsed) / vs.vestingDuration);
    }

    // ─────────────────────────────────────────────
    // MODULE 7 — VIEW FUNCTIONS
    // ─────────────────────────────────────────────

    function getClaimableTokens(address buyer) external view returns (uint256) {
        VestingSchedule storage vs = vestingSchedules[buyer];
        if (vs.totalTokens == 0) return 0;
        uint128 unlocked = _computeUnlocked(vs);
        return unlocked - vs.claimedTokens;
    }

    function getVestingInfo(address buyer) external view returns (
        uint256 totalTokens,
        uint256 claimedTokens,
        uint256 claimableNow,
        uint256 nextUnlockTimestamp,
        uint256 startTime,
        uint256 cliffEnd
    ) {
        VestingSchedule storage vs = vestingSchedules[buyer];
        totalTokens    = vs.totalTokens;
        claimedTokens  = vs.claimedTokens;
        claimableNow   = this.getClaimableTokens(buyer);
        startTime      = vs.startTime;
        cliffEnd       = vs.startTime + vs.cliffDuration;
        nextUnlockTimestamp = cliffEnd > block.timestamp ? cliffEnd : block.timestamp + 30 days;
    }

    function getRoundInfo(RoundType roundType) external view returns (
        uint256 tokenPrice,
        uint256 hardCap,
        uint256 totalRaised,
        uint256 remaining,
        bool isOpen,
        bool whitelistRequired
    ) {
        Round storage r = rounds[roundType];
        return (
            r.tokenPrice,
            r.hardCap,
            r.totalRaised,
            r.hardCap - r.totalRaised,
            r.isOpen,
            r.whitelistRequired
        );
    }
}