// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IAgentNFTMin {
    function ownerOf(uint256 tokenId) external view returns (address);
}

/// @title Tournament — bracket tournaments with an on-chain prize pool
/// @notice Entry fees pool on-chain. When registration closes, start()
///         fixes a bracket seed; the backend deterministically derives the
///         bracket and every match seed from it, simulates all rounds with
///         the open-source engine, and submits the podium signed by the
///         game signer. Prizes: 50/30/20 minus protocol fee. If a
///         tournament never starts or never resolves, entrants reclaim
///         their fee.
contract Tournament is Ownable, ReentrancyGuard {
    enum Status {
        None,
        Registration,
        Started,
        Resolved,
        Cancelled
    }

    struct Info {
        uint128 entryFee;
        uint32 maxEntrants;
        uint64 registrationEnd;
        uint64 startedAt;
        uint256 bracketSeed;
        Status status;
        uint256 pool;
    }

    IAgentNFTMin public immutable agentNFT;
    address public gameServer;
    address public feeRecipient;
    uint16 public feeBps = 500; // 5% of pool

    uint256 public nextTournamentId = 1;
    uint64 public constant RESOLVE_TIMEOUT = 48 hours;

    // podium split of the post-fee pool, in bps
    uint16 public constant FIRST_BPS = 5000;
    uint16 public constant SECOND_BPS = 3000;
    uint16 public constant THIRD_BPS = 2000;

    mapping(uint256 => Info) public tournaments;
    mapping(uint256 => uint256[]) public entrants; // tid => agentIds
    mapping(uint256 => mapping(uint256 => address)) public payoutAddress;
    mapping(uint256 => mapping(uint256 => bool)) public isEntered;
    mapping(uint256 => mapping(uint256 => bool)) public refunded;

    event TournamentCreated(
        uint256 indexed tournamentId,
        uint128 entryFee,
        uint32 maxEntrants,
        uint64 registrationEnd
    );
    event AgentEntered(
        uint256 indexed tournamentId, uint256 indexed agentId, address owner
    );
    event TournamentStarted(uint256 indexed tournamentId, uint256 bracketSeed);
    event TournamentResolved(
        uint256 indexed tournamentId,
        uint256 first,
        uint256 second,
        uint256 third,
        bytes32 bracketHash
    );
    event TournamentCancelled(uint256 indexed tournamentId);
    event EntryRefunded(
        uint256 indexed tournamentId, uint256 indexed agentId
    );

    error BadStatus();
    error RegistrationClosed();
    error RegistrationNotOver();
    error TournamentFull();
    error AlreadyEntered();
    error NotAgentOwner();
    error BadFee();
    error TooFewEntrants();
    error NotGameServer();
    error InvalidPodium();
    error TimeoutNotReached();
    error NothingToRefund();
    error TransferFailed();

    constructor(
        address nft,
        address server
    ) Ownable(msg.sender) {
        agentNFT = IAgentNFTMin(nft);
        gameServer = server;
        feeRecipient = msg.sender;
    }

    function setGameServer(address s) external onlyOwner {
        gameServer = s;
    }

    function setFee(uint16 bps, address recipient) external onlyOwner {
        if (bps > 1000) revert BadFee();
        feeBps = bps;
        feeRecipient = recipient;
    }

    // ---------------------------------------------------------- lifecycle

    function createTournament(
        uint128 entryFee,
        uint32 maxEntrants,
        uint64 registrationEnd
    ) external onlyOwner returns (uint256 tid) {
        tid = nextTournamentId++;
        tournaments[tid] = Info({
            entryFee: entryFee,
            maxEntrants: maxEntrants,
            registrationEnd: registrationEnd,
            startedAt: 0,
            bracketSeed: 0,
            status: Status.Registration,
            pool: 0
        });
        emit TournamentCreated(tid, entryFee, maxEntrants, registrationEnd);
    }

    function enter(uint256 tid, uint256 agentId) external payable {
        Info storage t = tournaments[tid];
        if (t.status != Status.Registration) revert BadStatus();
        if (block.timestamp >= t.registrationEnd) revert RegistrationClosed();
        if (entrants[tid].length >= t.maxEntrants) revert TournamentFull();
        if (isEntered[tid][agentId]) revert AlreadyEntered();
        if (agentNFT.ownerOf(agentId) != msg.sender) revert NotAgentOwner();
        if (msg.value != t.entryFee) revert BadFee();

        entrants[tid].push(agentId);
        isEntered[tid][agentId] = true;
        payoutAddress[tid][agentId] = msg.sender;
        t.pool += msg.value;

        emit AgentEntered(tid, agentId, msg.sender);
    }

    /// @notice Anyone can start after registration ends; needs 4+ entrants.
    ///         Fixes the bracket seed the backend derives everything from.
    function start(uint256 tid) external {
        Info storage t = tournaments[tid];
        if (t.status != Status.Registration) revert BadStatus();
        if (block.timestamp < t.registrationEnd) revert RegistrationNotOver();
        if (entrants[tid].length < 4) revert TooFewEntrants();

        t.status = Status.Started;
        t.startedAt = uint64(block.timestamp);
        t.bracketSeed = uint256(
            keccak256(
                abi.encodePacked(block.prevrandao, tid, entrants[tid].length)
            )
        );
        emit TournamentStarted(tid, t.bracketSeed);
    }

    /// @notice Backend submits the signed podium. bracketHash commits the
    ///         full bracket + every match log (public replay audit).
    function submitPodium(
        uint256 tid,
        uint256 first,
        uint256 second,
        uint256 third,
        bytes32 bracketHash
    ) external nonReentrant {
        if (msg.sender != gameServer) revert NotGameServer();
        Info storage t = tournaments[tid];
        if (t.status != Status.Started) revert BadStatus();
        if (
            !isEntered[tid][first] ||
            !isEntered[tid][second] ||
            !isEntered[tid][third] ||
            first == second || first == third || second == third
        ) revert InvalidPodium();

        t.status = Status.Resolved;

        uint256 fee = (t.pool * feeBps) / 10_000;
        uint256 prizePool = t.pool - fee;
        if (fee > 0) _pay(feeRecipient, fee);
        _pay(payoutAddress[tid][first], (prizePool * FIRST_BPS) / 10_000);
        _pay(payoutAddress[tid][second], (prizePool * SECOND_BPS) / 10_000);
        _pay(payoutAddress[tid][third], (prizePool * THIRD_BPS) / 10_000);

        emit TournamentResolved(tid, first, second, third, bracketHash);
    }

    /// @notice Cancel: owner anytime pre-resolve; anyone if a started
    ///         tournament went unresolved past the timeout, or if it can
    ///         never start (too few entrants after registration).
    function cancel(uint256 tid) external {
        Info storage t = tournaments[tid];
        if (t.status != Status.Registration && t.status != Status.Started) {
            revert BadStatus();
        }
        bool stuckStarted = t.status == Status.Started &&
            block.timestamp >= t.startedAt + RESOLVE_TIMEOUT;
        bool deadRegistration = t.status == Status.Registration &&
            block.timestamp >= t.registrationEnd &&
            entrants[tid].length < 4;
        if (msg.sender != owner() && !stuckStarted && !deadRegistration) {
            revert TimeoutNotReached();
        }
        t.status = Status.Cancelled;
        emit TournamentCancelled(tid);
    }

    /// @notice Reclaim your entry fee from a cancelled tournament.
    function refund(uint256 tid, uint256 agentId) external nonReentrant {
        Info storage t = tournaments[tid];
        if (t.status != Status.Cancelled) revert BadStatus();
        if (!isEntered[tid][agentId] || refunded[tid][agentId]) {
            revert NothingToRefund();
        }
        refunded[tid][agentId] = true;
        _pay(payoutAddress[tid][agentId], t.entryFee);
        emit EntryRefunded(tid, agentId);
    }

    // ---------------------------------------------------------------- views

    function getEntrants(uint256 tid) external view returns (uint256[] memory) {
        return entrants[tid];
    }

    function _pay(address to, uint256 amount) private {
        (bool ok, ) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}
