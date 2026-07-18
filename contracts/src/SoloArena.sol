// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title SoloArena — stake escrow for live Agent Combat fights
///
/// Flow:
///   1. Player calls play(agentId, botId) with BOT attached. botId is a
///      pure reference — NOT validated against any registry; the real
///      opponent is the game server's live AI, so no house bots need to
///      be registered. agentId MUST be owned by msg.sender (checked
///      against AgentNFT.ownerOf).
///   2. Backend indexes SoloPlayed, the player fights in real time.
///   3. The game server submits the live result: win pays PAYOUT_NUM /
///      PAYOUT_DEN (1.8x) from stake + house bankroll; loss keeps the
///      stake in the house.
///   4. If the server never resolves (outage), the player can reclaim
///      their full stake after RECLAIM_AFTER — funds can never be stuck.
///
/// ABI compatibility: SoloPlayed's indexed layout (gameId, agentId,
/// botId indexed; player/stake/seed in data, stake as uint128) matches
/// the app's existing SOLO_ARENA_ABI / SOLO_ABI exactly, and play() /
/// submitResult() keep their original signatures — so the frontend and
/// backend need no ABI changes, only this contract's new address.
///
/// Solvency: every accepted stake reserves its potential payout, so the
/// house can't take bets it can't pay and the owner can't withdraw funds
/// backing pending games.
interface IAgentNFT {
    function ownerOf(uint256 tokenId) external view returns (address);
}

contract SoloArena {
    // ---------------------------------------------------------- errors
    error NotOwner();
    error NotGameServer();
    error NotAgentOwner();
    error ZeroStake();
    error StakeTooLarge(uint256 maxStake);
    error GameNotPending();
    error NotYourGame();
    error TooEarlyToReclaim(uint256 reclaimableAt);
    error TransferFailed();
    error InsufficientFreeBalance();

    // ---------------------------------------------------------- events
    // Matches the existing SOLO_ARENA_ABI / SOLO_ABI: gameId, agentId,
    // botId indexed; player, stake (uint128), seed in the log data.
    event SoloPlayed(
        uint256 indexed gameId,
        uint256 indexed agentId,
        uint256 indexed botId,
        address player,
        uint128 stake,
        uint256 seed
    );
    event SoloResolved(
        uint256 indexed gameId,
        bool playerWon,
        uint256 payout,
        bytes32 movesHash
    );
    event SoloReclaimed(uint256 indexed gameId, address indexed player, uint256 stake);
    event GameServerChanged(address indexed gameServer);
    event HouseFunded(address indexed from, uint256 amount);
    event HouseWithdrawn(address indexed to, uint256 amount);

    // ---------------------------------------------------------- config
    uint256 public constant PAYOUT_NUM = 18; // win pays 1.8x the stake
    uint256 public constant PAYOUT_DEN = 10;
    uint256 public constant RECLAIM_AFTER = 1 hours;

    address public owner;
    address public gameServer;
    IAgentNFT public immutable agentNFT;

    // ----------------------------------------------------------- state
    enum Status { None, Pending, Resolved, Reclaimed }

    struct Game {
        address player;
        uint256 agentId;
        uint256 botId;      // reference only, never validated
        uint128 stake;
        uint64 createdAt;
        Status status;
        bool playerWon;
        bytes32 movesHash;
    }

    uint256 public nextGameId = 1;
    mapping(uint256 => Game) public games;

    /// Total potential payouts of all pending games. Contract balance
    /// minus this is the "free" bankroll available for new bets or
    /// owner withdrawal.
    uint256 public reserved;

    bool private _entered;

    // ------------------------------------------------------- modifiers
    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyGameServer() {
        if (msg.sender != gameServer) revert NotGameServer();
        _;
    }

    modifier nonReentrant() {
        require(!_entered, "reentrancy");
        _entered = true;
        _;
        _entered = false;
    }

    /// Matches Deploy.s.sol's `new SoloArena(address(nft), gameServer)`.
    constructor(address _agentNFT, address _gameServer) {
        owner = msg.sender;
        agentNFT = IAgentNFT(_agentNFT);
        gameServer = _gameServer;
        emit GameServerChanged(_gameServer);
    }

    // ---------------------------------------------------------- player
    /// Stake on your next live fight. agentId must be yours. botId is a
    /// reference the backend echoes back; nothing on-chain checks it —
    /// no house bot needs to be registered anywhere.
    function play(uint256 agentId, uint256 botId)
        external
        payable
        returns (uint256 gameId)
    {
        if (agentNFT.ownerOf(agentId) != msg.sender) revert NotAgentOwner();
        if (msg.value == 0) revert ZeroStake();
        require(msg.value <= type(uint128).max, "stake too large for uint128");

        // House must be able to cover the win payout beyond the stake
        // itself: extra needed = stake * 0.8.
        uint256 extraNeeded = (msg.value * (PAYOUT_NUM - PAYOUT_DEN)) / PAYOUT_DEN;
        uint256 free = address(this).balance - reserved - msg.value;
        if (extraNeeded > free) {
            // biggest stake the current bankroll supports
            revert StakeTooLarge((free * PAYOUT_DEN) / (PAYOUT_NUM - PAYOUT_DEN));
        }

        gameId = nextGameId++;
        games[gameId] = Game({
            player: msg.sender,
            agentId: agentId,
            botId: botId,
            stake: uint128(msg.value),
            createdAt: uint64(block.timestamp),
            status: Status.Pending,
            playerWon: false,
            movesHash: bytes32(0)
        });
        reserved += msg.value + extraNeeded;

        uint256 seed = uint256(
            keccak256(abi.encodePacked(blockhash(block.number - 1), msg.sender, gameId))
        );
        emit SoloPlayed(gameId, agentId, botId, msg.sender, uint128(msg.value), seed);
    }

    /// Refund path if the game server never resolves the fight.
    function reclaim(uint256 gameId) external nonReentrant {
        Game storage g = games[gameId];
        if (g.status != Status.Pending) revert GameNotPending();
        if (g.player != msg.sender) revert NotYourGame();
        uint256 readyAt = uint256(g.createdAt) + RECLAIM_AFTER;
        if (block.timestamp < readyAt) revert TooEarlyToReclaim(readyAt);

        g.status = Status.Reclaimed;
        uint256 stake = g.stake;
        reserved -= stake + (stake * (PAYOUT_NUM - PAYOUT_DEN)) / PAYOUT_DEN;

        (bool ok, ) = msg.sender.call{value: stake}("");
        if (!ok) revert TransferFailed();
        emit SoloReclaimed(gameId, msg.sender, stake);
    }

    // ----------------------------------------------------- game server
    /// Called by the backend with the LIVE fight's outcome.
    function submitResult(uint256 gameId, bool playerWon, bytes32 movesHash)
        external
        onlyGameServer
        nonReentrant
    {
        Game storage g = games[gameId];
        if (g.status != Status.Pending) revert GameNotPending();

        g.status = Status.Resolved;
        g.playerWon = playerWon;
        g.movesHash = movesHash;

        uint256 stake = g.stake;
        reserved -= stake + (stake * (PAYOUT_NUM - PAYOUT_DEN)) / PAYOUT_DEN;

        uint256 payout = 0;
        if (playerWon) {
            payout = (stake * PAYOUT_NUM) / PAYOUT_DEN;
            (bool ok, ) = g.player.call{value: payout}("");
            if (!ok) revert TransferFailed();
        }
        emit SoloResolved(gameId, playerWon, payout, movesHash);
    }

    // ------------------------------------------------------------ admin
    function setGameServer(address _gameServer) external onlyOwner {
        gameServer = _gameServer;
        emit GameServerChanged(_gameServer);
    }

    function fundHouse() external payable {
        emit HouseFunded(msg.sender, msg.value);
    }

    receive() external payable {
        emit HouseFunded(msg.sender, msg.value);
    }

    /// Withdraw profits — only funds not backing pending games.
    function withdrawHouse(uint256 amount) external onlyOwner nonReentrant {
        if (amount > address(this).balance - reserved) {
            revert InsufficientFreeBalance();
        }
        (bool ok, ) = owner.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit HouseWithdrawn(owner, amount);
    }

    // ------------------------------------------------------------ views
    function maxStake() external view returns (uint256) {
        uint256 free = address(this).balance - reserved;
        return (free * PAYOUT_DEN) / (PAYOUT_NUM - PAYOUT_DEN);
    }

    function getGame(uint256 gameId)
        external
        view
        returns (
            address player,
            uint256 agentId,
            uint256 botId,
            uint256 stake,
            uint8 status,
            bool playerWon
        )
    {
        Game storage g = games[gameId];
        return (g.player, g.agentId, g.botId, g.stake, uint8(g.status), g.playerWon);
    }
}