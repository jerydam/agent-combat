// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IAgentNFT {
    function ownerOf(uint256 tokenId) external view returns (address);
    function recordBattle(uint256 tokenId, bool won, uint64 xpGained) external;
}

/// @title SoloArena — player vs house bots, free or staked
/// @notice Free play: stake 0, instant, XP only. Staked play: beat the bot
///         to win stake * multiplier (default 1.8x) from the house vault.
///         The vault reserves liability at play time, so a win can never
///         be unpayable. Seeds fix on-chain at play; results are engine-
///         simulated and signer-verified like every other mode.
contract SoloArena is Ownable, ReentrancyGuard {
    enum GameStatus { None, Pending, Resolved, Refunded }

    struct Game {
        uint256 agentId;
        uint256 botId;
        address player;
        uint128 stake;
        uint256 seed;
        uint64 createdAt;
        GameStatus status;
        bool playerWon;
    }

    IAgentNFT public immutable agentNFT;
    address public gameServer;

    uint16 public winMultiplierBps = 18_000; // 1.8x stake on a win
    uint128 public maxStake = 100 ether;     // in BOT
    uint256 public reservedLiability;        // vault BOT promised to pending games

    uint256 public nextGameId = 1;
    uint64 public constant RESULT_TIMEOUT = 1 hours;
    uint64 public constant WIN_XP = 100;
    uint64 public constant LOSS_XP = 25;

    mapping(uint256 => Game) public games;
    mapping(uint256 => bool) public isBot; // house agents

    event BotSet(uint256 indexed agentId, bool enabled);
    event SoloPlayed(
        uint256 indexed gameId,
        uint256 indexed agentId,
        uint256 indexed botId,
        address player,
        uint128 stake,
        uint256 seed
    );
    event SoloResolved(
        uint256 indexed gameId, bool playerWon, bytes32 movesHash, uint256 payout
    );
    event SoloRefunded(uint256 indexed gameId);
    event VaultFunded(uint256 amount);
    event VaultWithdrawn(uint256 amount);

    error NotAgentOwner();
    error NotABot();
    error StakeTooHigh();
    error VaultCannotCover();
    error BadStatus();
    error NotGameServer();
    error TimeoutNotReached();
    error InsufficientFreeVault();
    error TransferFailed();

    constructor(
        address nft,
        address server
    ) Ownable(msg.sender) {
        agentNFT = IAgentNFT(nft);
        gameServer = server;
    }

    // ---------------------------------------------------------------- admin

    function setGameServer(address s) external onlyOwner { gameServer = s; }

    function setBot(uint256 agentId, bool enabled) external onlyOwner {
        isBot[agentId] = enabled;
        emit BotSet(agentId, enabled);
    }

    function setParams(uint16 multiplierBps, uint128 newMaxStake) external onlyOwner {
        require(multiplierBps >= 10_000 && multiplierBps <= 30_000, "bad multiplier");
        winMultiplierBps = multiplierBps;
        maxStake = newMaxStake;
    }

    function fundVault() external payable onlyOwner {
        emit VaultFunded(msg.value);
    }

    function withdrawVault(uint256 amount) external onlyOwner nonReentrant {
        if (address(this).balance - reservedLiability < amount) {
            revert InsufficientFreeVault();
        }
        _pay(owner(), amount);
        emit VaultWithdrawn(amount);
    }

    // ----------------------------------------------------------------- play

    function play(
        uint256 agentId,
        uint256 botId
    ) external payable returns (uint256 gameId) {
        if (agentNFT.ownerOf(agentId) != msg.sender) revert NotAgentOwner();
        if (!isBot[botId]) revert NotABot();
        if (msg.value > maxStake) revert StakeTooHigh();

        uint256 potentialPayout = 0;
        if (msg.value > 0) {
            potentialPayout = (msg.value * winMultiplierBps) / 10_000;
            // vault (minus already-promised payouts, minus this stake which
            // just arrived) must cover the win
            if (
                address(this).balance - msg.value - reservedLiability + msg.value
                    < potentialPayout
            ) revert VaultCannotCover();
            reservedLiability += potentialPayout;
        }

        gameId = nextGameId++;
        uint256 seed = uint256(
            keccak256(abi.encodePacked(block.prevrandao, gameId, agentId, botId))
        );
        games[gameId] = Game({
            agentId: agentId,
            botId: botId,
            player: msg.sender,
            stake: uint128(msg.value),
            seed: seed,
            createdAt: uint64(block.timestamp),
            status: GameStatus.Pending,
            playerWon: false
        });

        emit SoloPlayed(gameId, agentId, botId, msg.sender, uint128(msg.value), seed);
    }

    function submitResult(
        uint256 gameId,
        bool playerWon,
        bytes32 movesHash
    ) external nonReentrant {
        if (msg.sender != gameServer) revert NotGameServer();
        Game storage g = games[gameId];
        if (g.status != GameStatus.Pending) revert BadStatus();

        g.status = GameStatus.Resolved;
        g.playerWon = playerWon;

        agentNFT.recordBattle(g.agentId, playerWon, playerWon ? WIN_XP : LOSS_XP);
        agentNFT.recordBattle(g.botId, !playerWon, playerWon ? LOSS_XP : WIN_XP);

        uint256 payout = 0;
        if (g.stake > 0) {
            uint256 promised = (uint256(g.stake) * winMultiplierBps) / 10_000;
            reservedLiability -= promised;
            if (playerWon) {
                payout = promised;
                _pay(g.player, payout);
            }
            // on loss the stake simply stays in the vault
        }
        emit SoloResolved(gameId, playerWon, movesHash, payout);
    }

    /// @notice Refund a staked game the backend never resolved.
    function refundStale(uint256 gameId) external nonReentrant {
        Game storage g = games[gameId];
        if (g.status != GameStatus.Pending) revert BadStatus();
        if (block.timestamp < g.createdAt + RESULT_TIMEOUT) revert TimeoutNotReached();

        g.status = GameStatus.Refunded;
        if (g.stake > 0) {
            reservedLiability -= (uint256(g.stake) * winMultiplierBps) / 10_000;
            _pay(g.player, g.stake);
        }
        emit SoloRefunded(gameId);
    }

    receive() external payable {} // losses / direct funding land in the vault

    function _pay(address to, uint256 amount) private {
        (bool ok, ) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}
