// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {AgentNFT} from "../contracts/AgentNFT.sol";
import {SoloArena} from "../contracts/SoloArena.sol";

/// Mints the house-bot roster, registers them on SoloArena, and funds the
/// vault so staked solo play can pay out.
///
/// Run with the wallet you want as BOT_OWNER (max 5 agents per wallet):
/// forge script script/SetupBots.s.sol --rpc-url botchain_testnet --broadcast
contract SetupBots is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY"); // bot-owner wallet key
        address nftAddr = vm.envAddress("AGENT_NFT_ADDRESS");
        address soloAddr = vm.envAddress("SOLO_ARENA_ADDRESS");
        uint256 vaultFunding = vm.envOr("VAULT_FUNDING_WEI", uint256(0));

        AgentNFT nft = AgentNFT(nftAddr);
        SoloArena solo = SoloArena(payable(soloAddr));

        string[5] memory names =
            ["Trainer Bot", "Guard Bot", "Blade Bot", "Mind Bot", "Omega Bot"];
        AgentNFT.Personality[5] memory personalities = [
            AgentNFT.Personality.Defensive,
            AgentNFT.Personality.Defensive,
            AgentNFT.Personality.Aggressive,
            AgentNFT.Personality.Tactical,
            AgentNFT.Personality.Aggressive
        ];

        vm.startBroadcast(pk);
        for (uint256 i = 0; i < 5; i++) {
            uint256 id = nft.mintAgent(names[i], personalities[i]);
            solo.setBot(id, true); // requires this wallet to be SoloArena owner
            console.log("Bot minted: %s -> tokenId %s", names[i], id);
        }
        if (vaultFunding > 0) {
            solo.fundVault{value: vaultFunding}();
            console.log("Vault funded with %s wei", vaultFunding);
        }
        vm.stopBroadcast();
        console.log("Set BOT_OWNER_ADDRESS to this wallet in backend/.env");
    }
}
