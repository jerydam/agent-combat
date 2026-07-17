// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IAgentNFTL {
    function ownerOf(uint256 tokenId) external view returns (address);
}

/// @title League — code-gated async league rooms with a schedule
/// @notice Anyone creates a room (free or paid) with a start/end time and a
///         join-code hash. Players join with the code before start. During
///         the window, players play their own fixtures asynchronously
///         (double round-robin, engine-simulated off-chain); after the end
///         time the backend submits signed final standings and the prize
///         pool pays 50/30/20. Rooms that never fill (<3) or never resolve
///         are fully refundable.
/// @dev The join code travels in calldata when players join, so it is
///      secret only until the first join lands on-chain — a social gate
///      for private rooms, not cryptographic access control.
contract League is Ownable, ReentrancyGuard {
    enum Status { None, Registration, Active, Resolved, Cancelled }

    struct Room {
        address creator;
        uint128 entryFee;
        uint32 maxPlayers;
        uint64 startTime;
        uint64 endTime;
        bytes32 codeHash;   // keccak256(code); bytes32(0) = public room
        uint256 seed;       // fixed at activation
        Status status;
        uint256 pool;
    }

    IAgentNFTL public immutable agentNFT;
    address public gameServer;
    address public feeRecipient;
    uint16 public feeBps = 500;

    uint256 public nextLeagueId = 1;
    uint64 public constant RESOLVE_TIMEOUT = 48 hours;
    uint32 public constant MIN_PLAYERS = 3;

    uint16 public constant FIRST_BPS = 5000;
    uint16 public constant SECOND_BPS = 3000;
    uint16 public constant THIRD_BPS = 2000;

    mapping(uint256 => Room) public rooms;
    mapping(uint256 => uint256[]) public entrants; // leagueId => agentIds
    mapping(uint256 => mapping(uint256 => address)) public payoutAddress;
    mapping(uint256 => mapping(uint256 => bool)) public isEntered;
    mapping(uint256 => mapping(uint256 => bool)) public refunded;

    event LeagueCreated(
        uint256 indexed leagueId,
        address indexed creator,
        uint128 entryFee,
        uint32 maxPlayers,
        uint64 startTime,
        uint64 endTime,
        bool isPrivate
    );
    event PlayerJoined(
        uint256 indexed leagueId, uint256 indexed agentId, address owner
    );
    event LeagueActivated(uint256 indexed leagueId, uint256 seed);
    event LeagueResolved(
        uint256 indexed leagueId,
        uint256 first,
        uint256 second,
        uint256 third,
        bytes32 standingsHash
    );
    event LeagueCancelled(uint256 indexed leagueId);
    event EntryRefunded(uint256 indexed leagueId, uint256 indexed agentId);

    error BadSchedule();
    error BadStatus();
    error JoinClosed();
    error RoomFull();
    error WrongCode();
    error AlreadyEntered();
    error NotAgentOwner();
    error BadFee();
    error NotStartedYet();
    error NotEndedYet();
    error TooFewPlayers();
    error NotGameServer();
    error InvalidStandings();
    error TimeoutNotReached();
    error NotAllowed();
    error NothingToRefund();
    error TransferFailed();

    constructor(
        address nft,
        address server
    ) Ownable(msg.sender) {
        agentNFT = IAgentNFTL(nft);
        gameServer = server;
        feeRecipient = msg.sender;
    }

    function setGameServer(address s) external onlyOwner { gameServer = s; }

    function setFee(uint16 bps, address recipient) external onlyOwner {
        if (bps > 1000) revert BadFee();
        feeBps = bps;
        feeRecipient = recipient;
    }

    // ------------------------------------------------------------ lifecycle

    /// @notice Open a league room. codeHash = keccak256(bytes(code)) for a
    ///         private room, or bytes32(0) for public. Free room: fee 0.
    function createLeague(
        uint128 entryFee,
        uint32 maxPlayers,
        uint64 startTime,
        uint64 endTime,
        bytes32 codeHash
    ) external returns (uint256 leagueId) {
        if (
            startTime <= block.timestamp ||
            endTime <= startTime ||
            maxPlayers < MIN_PLAYERS
        ) revert BadSchedule();

        leagueId = nextLeagueId++;
        rooms[leagueId] = Room({
            creator: msg.sender,
            entryFee: entryFee,
            maxPlayers: maxPlayers,
            startTime: startTime,
            endTime: endTime,
            codeHash: codeHash,
            seed: 0,
            status: Status.Registration,
            pool: 0
        });
        emit LeagueCreated(
            leagueId, msg.sender, entryFee, maxPlayers,
            startTime, endTime, codeHash != bytes32(0)
        );
    }

    /// @notice Join with the room code (empty string for public rooms).
    function join(
        uint256 leagueId,
        string calldata code,
        uint256 agentId
    ) external payable {
        Room storage r = rooms[leagueId];
        if (r.status != Status.Registration) revert BadStatus();
        if (block.timestamp >= r.startTime) revert JoinClosed();
        if (entrants[leagueId].length >= r.maxPlayers) revert RoomFull();
        if (r.codeHash != bytes32(0) && keccak256(bytes(code)) != r.codeHash) {
            revert WrongCode();
        }
        if (isEntered[leagueId][agentId]) revert AlreadyEntered();
        if (agentNFT.ownerOf(agentId) != msg.sender) revert NotAgentOwner();
        if (msg.value != r.entryFee) revert BadFee();

        entrants[leagueId].push(agentId);
        isEntered[leagueId][agentId] = true;
        payoutAddress[leagueId][agentId] = msg.sender;
        r.pool += msg.value;

        emit PlayerJoined(leagueId, agentId, msg.sender);
    }

    /// @notice Anyone can activate once the start time passes (3+ players).
    ///         Fixes the seed every fixture derives from.
    function activate(uint256 leagueId) external {
        Room storage r = rooms[leagueId];
        if (r.status != Status.Registration) revert BadStatus();
        if (block.timestamp < r.startTime) revert NotStartedYet();
        if (entrants[leagueId].length < MIN_PLAYERS) revert TooFewPlayers();

        r.status = Status.Active;
        r.seed = uint256(
            keccak256(
                abi.encodePacked(
                    block.prevrandao, leagueId, entrants[leagueId].length
                )
            )
        );
        emit LeagueActivated(leagueId, r.seed);
    }

    /// @notice Backend submits signed final standings after the end time.
    ///         standingsHash commits the full table + every fixture log.
    function submitStandings(
        uint256 leagueId,
        uint256 first,
        uint256 second,
        uint256 third,
        bytes32 standingsHash
    ) external nonReentrant {
        if (msg.sender != gameServer) revert NotGameServer();
        Room storage r = rooms[leagueId];
        if (r.status != Status.Active) revert BadStatus();
        if (block.timestamp < r.endTime) revert NotEndedYet();
        if (
            !isEntered[leagueId][first] ||
            !isEntered[leagueId][second] ||
            !isEntered[leagueId][third] ||
            first == second || first == third || second == third
        ) revert InvalidStandings();

        r.status = Status.Resolved;

        uint256 fee = (r.pool * feeBps) / 10_000;
        uint256 prizePool = r.pool - fee;
        if (fee > 0) _pay(feeRecipient, fee);
        _pay(payoutAddress[leagueId][first], (prizePool * FIRST_BPS) / 10_000);
        _pay(payoutAddress[leagueId][second], (prizePool * SECOND_BPS) / 10_000);
        _pay(payoutAddress[leagueId][third], (prizePool * THIRD_BPS) / 10_000);

        emit LeagueResolved(leagueId, first, second, third, standingsHash);
    }

    /// @notice Cancel: creator/owner pre-activation; anyone if the room
    ///         can't start (past startTime, <3 players) or went unresolved
    ///         past endTime + timeout.
    function cancel(uint256 leagueId) external {
        Room storage r = rooms[leagueId];
        if (r.status != Status.Registration && r.status != Status.Active) {
            revert BadStatus();
        }
        bool deadRoom = r.status == Status.Registration &&
            block.timestamp >= r.startTime &&
            entrants[leagueId].length < MIN_PLAYERS;
        bool stuck = r.status == Status.Active &&
            block.timestamp >= r.endTime + RESOLVE_TIMEOUT;
        bool privileged = msg.sender == r.creator || msg.sender == owner();
        if (!deadRoom && !stuck && !(privileged && r.status == Status.Registration)) {
            revert NotAllowed();
        }
        r.status = Status.Cancelled;
        emit LeagueCancelled(leagueId);
    }

    function refund(uint256 leagueId, uint256 agentId) external nonReentrant {
        Room storage r = rooms[leagueId];
        if (r.status != Status.Cancelled) revert BadStatus();
        if (!isEntered[leagueId][agentId] || refunded[leagueId][agentId]) {
            revert NothingToRefund();
        }
        refunded[leagueId][agentId] = true;
        _pay(payoutAddress[leagueId][agentId], r.entryFee);
        emit EntryRefunded(leagueId, agentId);
    }

    function getEntrants(uint256 leagueId) external view returns (uint256[] memory) {
        return entrants[leagueId];
    }

    function _pay(address to, uint256 amount) private {
        (bool ok, ) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}
