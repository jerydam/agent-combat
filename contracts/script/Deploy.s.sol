// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {AgentNFT} from "../src/AgentNFT.sol";
import {BattleArena} from "../src/BattleArena.sol";
import {SoloArena} from "../src/SoloArena.sol";
import {League} from "../src/League.sol";
import {Tournament} from "../src/Tournament.sol";
import {Marketplace} from "../src/Marketplace.sol";
import {Shop} from "../src/Shop.sol";

/// forge script script/Deploy.s.sol --rpc-url botchain_testnet --broadcast
contract Deploy is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address gameServer = vm.envAddress("GAME_SERVER_ADDRESS");
        string memory baseURI = vm.envOr(
            "METADATA_BASE_URI",
            string("http://localhost:8000/metadata/")
        );

        vm.startBroadcast(pk);

        AgentNFT nft = new AgentNFT(baseURI);
        BattleArena arena = new BattleArena(address(nft), gameServer);
        SoloArena solo = new SoloArena(address(nft), gameServer);
        League league = new League(address(nft), gameServer);
        Tournament tournament = new Tournament(address(nft), gameServer);
        Marketplace market = new Marketplace(address(nft));
        Shop shop = new Shop();

        // Battle-recording contracts + the game server (for market boosts)
        nft.setArena(address(arena), true);
        nft.setArena(address(solo), true);
        nft.setArena(gameServer, true);

        vm.stopBroadcast();

        console.log("AGENT_NFT_ADDRESS=%s", address(nft));
        console.log("BATTLE_ARENA_ADDRESS=%s", address(arena));
        console.log("SOLO_ARENA_ADDRESS=%s", address(solo));
        console.log("LEAGUE_ADDRESS=%s", address(league));
        console.log("TOURNAMENT_ADDRESS=%s", address(tournament));
        console.log("MARKETPLACE_ADDRESS=%s", address(market));
        console.log("SHOP_ADDRESS=%s", address(shop));
    }
}
