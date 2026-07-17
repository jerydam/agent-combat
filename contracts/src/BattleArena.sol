// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IAgentNFT {
    function ownerOf(uint256 tokenId) external view returns (address);
    function recordBattle(uint256 tokenId, bool won, uint64 xpGained) external;
}

/// @title BattleArena v2 — consent, wagers, and verified results
/// @notice Two ways to fight:
///         1. challenge/accept — optional BOT stake, winner takes the pot
///            minus protocol fee. Seed is fixed at ACCEPT so neither player
///            nor backend can pre-compute the outcome before committing.
///         2. quickMatch — zero stakes, instant, but the target agent's
///            owner must have opted in via setQuickMatch (no consent
///            griefing).
///         Results are simulated off-chain by the open-source deterministic
///         engine and must be signed by the game signer. movesHash commits
///         the full battle log on-chain for public replay audits.
contract BattleArena is Ownable, ReentrancyGuard {
    // ---------------------------------------------------------------- types

    enum BattleStatus {
        None,
        Open,      // challenge posted, waiting for accept
        Pending,   // accepted, waiting for verified result
        Resolved,
        Cancelled
    }

    struct Battle {
        uint256 agentA;      // challenger's agent
        uint256 agentB;      // target agent
        address playerA;
        address playerB;
        uint128 stake;       // per side, in wei of BOT (0 = friendly)
        uint256 seed;        // fixed at accept / quickMatch
        uint64 createdAt;    // set at accept (Pending) for timeout math
        BattleStatus status;
        uint256 winnerAgent;
    }

    // ---------------------------------------------------------------- state

    IAgentNFT public immutable agentNFT;
    /// @notice Backend account allowed to submit results.
    address public gameServer;
    address public feeRecipient;
    uint16 public feeBps = 250; // 2.5% of the pot on staked battles

    uint256 public nextBattleId = 1;
    uint64 public constant RESULT_TIMEOUT = 1 hours;
    uint64 public constant ACCEPT_TIMEOUT = 24 hours;
    uint64 public constant WIN_XP = 100;
    uint64 public constant LOSS_XP = 25;

    mapping(uint256 => Battle) public battles;
    mapping(uint256 => uint256) public activeBattleOf; // agent => battleId
    mapping(uint256 => bool) public quickMatchEnabled; // agent opt-in
    mapping(uint256 => uint64) private _openedAt;      // challenge timestamp

    // --------------------------------------------------------------- events

    event ChallengeCreated(
        uint256 indexed battleId,
        uint256 indexed agentA,
        uint256 indexed agentB,
        address playerA,
        address playerB,
        uint128 stake
    );
    event ChallengeAccepted(uint256 indexed battleId, uint256 seed);
    event QuickMatchStarted(
        uint256 indexed battleId,
        uint256 indexed agentA,
        uint256 indexed agentB,
        uint256 seed
    );
    event BattleResolved(
        uint256 indexed battleId,
        uint256 indexed winnerAgent,
        bytes32 movesHash,
        uint256 payout
    );
    event BattleCancelled(uint256 indexed battleId);
    event QuickMatchSet(uint256 indexed agentId, bool enabled);
    event GameServerUpdated(address indexed newServer);
    event FeeUpdated(uint16 feeBps, address feeRecipient);

    // --------------------------------------------------------------- errors

    error NotAgentOwner();
    error NotChallengeTarget();
    error AgentBusy();
    error SelfBattle();
    error BadBattleStatus();
    error BadStake();
    error QuickMatchNotEnabled();
    error InvalidWinner();
    error NotGameServer();
    error TimeoutNotReached();
    error TransferFailed();
    error FeeTooHigh();

    // ---------------------------------------------------------- constructor

    constructor(
        address nft,
        address server
    ) Ownable(msg.sender) {
        agentNFT = IAgentNFT(nft);
        gameServer = server;
        feeRecipient = msg.sender;
    }

    // ---------------------------------------------------------------- admin

    function setGameServer(address newServer) external onlyOwner {
        gameServer = newServer;
        emit GameServerUpdated(newServer);
    }

    function setFee(uint16 newFeeBps, address newRecipient) external onlyOwner {
        if (newFeeBps > 1000) revert FeeTooHigh(); // max 10%
        feeBps = newFeeBps;
        feeRecipient = newRecipient;
        emit FeeUpdated(newFeeBps, newRecipient);
    }

    // ------------------------------------------------------------- opt-ins

    /// @notice Let anyone quick-match against this agent (zero stakes).
    function setQuickMatch(uint256 agentId, bool enabled) external {
        if (agentNFT.ownerOf(agentId) != msg.sender) revert NotAgentOwner();
        quickMatchEnabled[agentId] = enabled;
        emit QuickMatchSet(agentId, enabled);
    }

    // ----------------------------------------------------- challenge flow

    /// @notice Post a challenge. msg.value is your stake (0 for friendly).
    ///         Only YOUR agent locks now; the target locks when they accept.
    function challenge(
        uint256 myAgent,
        uint256 targetAgent
    ) external payable returns (uint256 battleId) {
        if (agentNFT.ownerOf(myAgent) != msg.sender) revert NotAgentOwner();
        if (myAgent == targetAgent) revert SelfBattle();
        if (activeBattleOf[myAgent] != 0) revert AgentBusy();
        if (msg.value > type(uint128).max) revert BadStake();

        address target = agentNFT.ownerOf(targetAgent);
        if (target == msg.sender) revert SelfBattle();

        battleId = nextBattleId++;
        battles[battleId] = Battle({
            agentA: myAgent,
            agentB: targetAgent,
            playerA: msg.sender,
            playerB: target,
            stake: uint128(msg.value),
            seed: 0,
            createdAt: 0,
            status: BattleStatus.Open,
            winnerAgent: 0
        });
        activeBattleOf[myAgent] = battleId;
        _openedAt[battleId] = uint64(block.timestamp);

        emit ChallengeCreated(
            battleId, myAgent, targetAgent, msg.sender, target, uint128(msg.value)
        );
    }

    /// @notice Accept a challenge against your agent, matching the stake.
    ///         Seed is fixed HERE — after both sides committed.
    function accept(uint256 battleId) external payable {
        Battle storage b = battles[battleId];
        if (b.status != BattleStatus.Open) revert BadBattleStatus();
        // Ownership may have changed since the challenge; re-check live.
        if (agentNFT.ownerOf(b.agentB) != msg.sender) revert NotChallengeTarget();
        if (msg.value != b.stake) revert BadStake();
        if (activeBattleOf[b.agentB] != 0) revert AgentBusy();

        b.playerB = msg.sender;
        b.status = BattleStatus.Pending;
        b.createdAt = uint64(block.timestamp);
        b.seed = uint256(
            keccak256(
                abi.encodePacked(block.prevrandao, battleId, b.agentA, b.agentB)
            )
        );
        activeBattleOf[b.agentB] = battleId;

        emit ChallengeAccepted(battleId, b.seed);
    }

    /// @notice Withdraw an unaccepted challenge (refunds stake). Anyone can
    ///         sweep it after ACCEPT_TIMEOUT to free the challenger's agent.
    function cancelChallenge(uint256 battleId) external nonReentrant {
        Battle storage b = battles[battleId];
        if (b.status != BattleStatus.Open) revert BadBattleStatus();
        bool timedOut =
            block.timestamp >= _openedAt[battleId] + ACCEPT_TIMEOUT;
        if (msg.sender != b.playerA && !timedOut) revert TimeoutNotReached();

        b.status = BattleStatus.Cancelled;
        activeBattleOf[b.agentA] = 0;
        _pay(b.playerA, b.stake);
        emit BattleCancelled(battleId);
    }

    // -------------------------------------------------------- quick match

    /// @notice Instant zero-stake battle vs an opted-in agent.
    function quickMatch(
        uint256 myAgent,
        uint256 targetAgent
    ) external returns (uint256 battleId) {
        if (agentNFT.ownerOf(myAgent) != msg.sender) revert NotAgentOwner();
        if (myAgent == targetAgent) revert SelfBattle();
        if (!quickMatchEnabled[targetAgent]) revert QuickMatchNotEnabled();
        if (activeBattleOf[myAgent] != 0) revert AgentBusy();
        if (activeBattleOf[targetAgent] != 0) revert AgentBusy();

        address target = agentNFT.ownerOf(targetAgent);
        if (target == msg.sender) revert SelfBattle();

        battleId = nextBattleId++;
        uint256 seed = uint256(
            keccak256(
                abi.encodePacked(block.prevrandao, battleId, myAgent, targetAgent)
            )
        );
        battles[battleId] = Battle({
            agentA: myAgent,
            agentB: targetAgent,
            playerA: msg.sender,
            playerB: target,
            stake: 0,
            seed: seed,
            createdAt: uint64(block.timestamp),
            status: BattleStatus.Pending,
            winnerAgent: 0
        });
        activeBattleOf[myAgent] = battleId;
        activeBattleOf[targetAgent] = battleId;

        emit QuickMatchStarted(battleId, myAgent, targetAgent, seed);
    }

    // ------------------------------------------------------------ results

    /// @notice Only the game server settles battles. movesHash commits the
    ///         full battle log for public replay audits.
    function submitResult(
        uint256 battleId,
        uint256 winnerAgent,
        bytes32 movesHash
    ) external nonReentrant {
        if (msg.sender != gameServer) revert NotGameServer();
        Battle storage b = battles[battleId];
        if (b.status != BattleStatus.Pending) revert BadBattleStatus();
        if (winnerAgent != b.agentA && winnerAgent != b.agentB) {
            revert InvalidWinner();
        }

        b.status = BattleStatus.Resolved;
        b.winnerAgent = winnerAgent;
        activeBattleOf[b.agentA] = 0;
        activeBattleOf[b.agentB] = 0;

        uint256 loserAgent = winnerAgent == b.agentA ? b.agentB : b.agentA;
        agentNFT.recordBattle(winnerAgent, true, WIN_XP);
        agentNFT.recordBattle(loserAgent, false, LOSS_XP);

        // Payout: winner takes the pot minus protocol fee.
        uint256 payout = 0;
        if (b.stake > 0) {
            uint256 pot = uint256(b.stake) * 2;
            uint256 fee = (pot * feeBps) / 10_000;
            payout = pot - fee;
            address winnerOwner =
                winnerAgent == b.agentA ? b.playerA : b.playerB;
            if (fee > 0) _pay(feeRecipient, fee);
            _pay(winnerOwner, payout);
        }

        emit BattleResolved(battleId, winnerAgent, movesHash, payout);
    }

    /// @notice Refund both sides and free agents if the backend never
    ///         resolves an accepted battle.
    function cancelStaleBattle(uint256 battleId) external nonReentrant {
        Battle storage b = battles[battleId];
        if (b.status != BattleStatus.Pending) revert BadBattleStatus();
        if (block.timestamp < b.createdAt + RESULT_TIMEOUT) {
            revert TimeoutNotReached();
        }

        b.status = BattleStatus.Cancelled;
        activeBattleOf[b.agentA] = 0;
        activeBattleOf[b.agentB] = 0;

        if (b.stake > 0) {
            _pay(b.playerA, b.stake);
            _pay(b.playerB, b.stake);
        }
        emit BattleCancelled(battleId);
    }

    // ---------------------------------------------------------------- views

    function getBattle(uint256 battleId) external view returns (Battle memory) {
        return battles[battleId];
    }

    // ------------------------------------------------------------- internal

    function _pay(address to, uint256 amount) private {
        (bool ok, ) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}
