// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title AgentNFT — AI battle agents for Agent Arena on BOT Chain
/// @notice Each agent is an ERC721 with on-chain stats. Stats are the source
///         of truth for battle resolution; the AI engine only picks strategy.
contract AgentNFT is ERC721, Ownable {
    // ---------------------------------------------------------------- types

    enum Personality {
        Aggressive,
        Defensive,
        Tactical
    }

    struct Agent {
        uint16 attack;
        uint16 defense;
        uint16 speed;
        uint16 intelligence;
        uint16 level;
        uint32 wins;
        uint32 losses;
        uint64 experience;
        uint64 lastBattleAt;
        Personality personality;
        uint8 tier; // 1 Basic, 2 Advanced, 3 Elite — unlocks abilities
    }

    // ---------------------------------------------------------------- state

    uint256 public nextTokenId = 1;
    uint256 public constant MAX_AGENTS_PER_WALLET = 5;
    uint64 public constant XP_PER_LEVEL = 500;
    uint32 public constant TIER2_WINS = 25;
    uint32 public constant TIER3_WINS = 60;

    mapping(uint256 => Agent) public agents;
    mapping(address => uint256) public agentCount;
    mapping(uint256 => string) public agentNames;

    /// @notice Contracts allowed to record battle outcomes
    ///         (BattleArena, SoloArena, League)
    mapping(address => bool) public arenas;

    string private _baseTokenURI;

    // --------------------------------------------------------------- events

    event AgentMinted(
        uint256 indexed tokenId,
        address indexed owner,
        string name,
        Personality personality,
        uint16 attack,
        uint16 defense,
        uint16 speed,
        uint16 intelligence
    );
    event AgentLeveledUp(uint256 indexed tokenId, uint16 newLevel);
    event AgentEvolved(uint256 indexed tokenId, uint8 newTier);
    event BattleRecorded(uint256 indexed tokenId, bool won, uint64 xpGained);
    event ArenaUpdated(address indexed arena, bool authorized);

    // --------------------------------------------------------------- errors

    error NotArena();
    error MaxAgentsReached();
    error NameTooLong();
    error AgentDoesNotExist();

    // ---------------------------------------------------------- constructor

    constructor(
        string memory baseURI
    ) ERC721("Agent Arena Fighter", "AGENT") Ownable(msg.sender) {
        _baseTokenURI = baseURI;
    }

    // ------------------------------------------------------------ modifiers

    modifier onlyArena() {
        if (!arenas[msg.sender]) revert NotArena();
        _;
    }

    // ---------------------------------------------------------------- admin

    function setArena(address arena, bool authorized) external onlyOwner {
        arenas[arena] = authorized;
        emit ArenaUpdated(arena, authorized);
    }

    function setBaseURI(string calldata baseURI) external onlyOwner {
        _baseTokenURI = baseURI;
    }

    // ----------------------------------------------------------------- mint

    /// @notice Mint a new agent with pseudo-random base stats.
    /// @dev prevrandao/blockhash randomness is gameable by validators in
    ///      theory; acceptable for base-stat rolls where stakes are low.
    ///      Wager matches must NOT rely on this alone (see BattleArena).
    function mintAgent(
        string calldata name,
        Personality personality
    ) external returns (uint256 tokenId) {
        if (agentCount[msg.sender] >= MAX_AGENTS_PER_WALLET) {
            revert MaxAgentsReached();
        }
        if (bytes(name).length > 32) revert NameTooLong();

        tokenId = nextTokenId++;

        uint256 seed = uint256(
            keccak256(
                abi.encodePacked(
                    block.prevrandao,
                    blockhash(block.number - 1),
                    msg.sender,
                    tokenId
                )
            )
        );

        // Base stats: 40–90 each, with a personality-flavored bonus.
        uint16 atk = uint16(40 + (seed % 51));
        uint16 def = uint16(40 + ((seed >> 16) % 51));
        uint16 spd = uint16(40 + ((seed >> 32) % 51));
        uint16 intel = uint16(40 + ((seed >> 48) % 51));

        if (personality == Personality.Aggressive) atk += 10;
        else if (personality == Personality.Defensive) def += 10;
        else intel += 10;

        agents[tokenId] = Agent({
            attack: atk,
            defense: def,
            speed: spd,
            intelligence: intel,
            level: 1,
            wins: 0,
            losses: 0,
            experience: 0,
            lastBattleAt: 0,
            personality: personality,
            tier: 1
        });
        agentNames[tokenId] = name;
        agentCount[msg.sender]++;

        _safeMint(msg.sender, tokenId);

        emit AgentMinted(
            tokenId, msg.sender, name, personality, atk, def, spd, intel
        );
    }

    // --------------------------------------------------------- arena hooks

    /// @notice Called by BattleArena after a verified battle result.
    function recordBattle(
        uint256 tokenId,
        bool won,
        uint64 xpGained
    ) external onlyArena {
        Agent storage a = agents[tokenId];
        if (a.level == 0) revert AgentDoesNotExist();

        a.experience += xpGained;
        a.lastBattleAt = uint64(block.timestamp);
        if (won) a.wins++;
        else a.losses++;

        // Level up: +1 level per XP_PER_LEVEL, stat bumps on level-up.
        uint16 targetLevel = uint16(1 + a.experience / XP_PER_LEVEL);
        if (targetLevel > a.level) {
            uint16 gained = targetLevel - a.level;
            a.level = targetLevel;
            a.attack += 2 * gained;
            a.defense += 2 * gained;
            a.speed += 1 * gained;
            a.intelligence += 1 * gained;
            emit AgentLeveledUp(tokenId, targetLevel);
        }

        // Evolution: milestones unlock ability tiers (engine reads tier).
        uint8 targetTier = 1;
        if (a.wins >= TIER3_WINS) targetTier = 3;
        else if (a.wins >= TIER2_WINS) targetTier = 2;
        if (targetTier > a.tier) {
            a.tier = targetTier;
            a.intelligence += 5; // evolving sharpens the mind
            emit AgentEvolved(tokenId, targetTier);
        }

        emit BattleRecorded(tokenId, won, xpGained);
    }

    // ---------------------------------------------------------------- views

    function getAgent(
        uint256 tokenId
    ) external view returns (Agent memory, string memory name) {
        Agent memory a = agents[tokenId];
        if (a.level == 0) revert AgentDoesNotExist();
        return (a, agentNames[tokenId]);
    }

    function _baseURI() internal view override returns (string memory) {
        return _baseTokenURI;
    }

    // Keep per-wallet count accurate on transfers.
    function _update(
        address to,
        uint256 tokenId,
        address auth
    ) internal override returns (address from) {
        from = super._update(to, tokenId, auth);
        if (from != address(0)) agentCount[from]--;
        if (to != address(0)) agentCount[to]++;
    }
}
