// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {Shop} from "../src/Shop.sol";

/// Fills the Shop's price table.
///
/// Shop.purchase() reverts NotForSale() whenever priceOf[itemId] == 0, and a
/// freshly deployed Shop has every price at 0 — so until this runs, every
/// buy-with-BOT in the market reverts and the storefront looks broken while
/// the backend catalog happily serves 32 priced items. Deploy.s.sol does not
/// call setPrice, so this is a required post-deploy step, not an optional one.
///
/// Prices come from script/shop-prices.json so the backend catalog stays the
/// single source of truth. Regenerate that file from /market/catalog whenever
/// the catalog or the BOT/USD peg moves:
///
///   curl -s "$API/market/catalog" | python3 -c '...'   # see repo docs
///
/// Must be run by the Shop owner (setPrice is onlyOwner) — that is
/// BOT_OWNER_ADDRESS, not the game-server key:
///   source .env
///   forge script script/SeedShop.s.sol:SeedShop --rpc-url testnet --broadcast
contract SeedShop is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY"); // must own the Shop
        address shopAddr = vm.envAddress("SHOP_ADDRESS");

        string memory raw = vm.readFile("script/shop-prices.json");
        string[] memory ids = vm.parseJsonStringArray(raw, ".ids");
        // Prices are hex strings on purpose: item prices run to ~4.1e17 wei,
        // past the 2^53 where JSON numbers silently lose precision.
        uint256[] memory prices = vm.parseJsonUintArray(raw, ".prices");
        require(ids.length == prices.length, "ids/prices length mismatch");

        Shop shop = Shop(payable(shopAddr));
        require(shop.owner() == vm.addr(pk), "PRIVATE_KEY does not own Shop");

        vm.startBroadcast(pk);
        uint256 written;
        for (uint256 i = 0; i < ids.length; i++) {
            require(prices[i] > 0, "zero price would keep item unsellable");
            require(prices[i] <= type(uint128).max, "price exceeds uint128");
            // Skip no-op writes so a re-run after a partial broadcast costs
            // gas only for the prices that actually changed.
            if (shop.priceOf(ids[i]) == uint128(prices[i])) continue;
            shop.setPrice(ids[i], uint128(prices[i]));
            written++;
        }
        vm.stopBroadcast();

        console.log("Shop:", shopAddr);
        console.log("items in file:", ids.length);
        console.log("prices written:", written);
    }
}
