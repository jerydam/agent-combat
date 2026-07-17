// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title Shop — buy market items with BOT
/// @notice Items themselves (skins, boosts, powers) are defined and granted
///         by the game backend; the chain's job here is payments. A purchase
///         emits ItemPurchased; the listener grants the item to the wallet.
///         Redemptions with earned points never touch this contract.
contract Shop is Ownable, ReentrancyGuard {
    mapping(string => uint128) public priceOf; // itemId => wei of BOT (0 = not for sale)

    event ItemPriced(string itemId, uint128 price);
    event ItemPurchased(
        address indexed buyer, string itemId, uint256 indexed agentId, uint128 paid
    );

    error NotForSale();
    error WrongPayment();
    error TransferFailed();

    constructor() Ownable(msg.sender) {}

    function setPrice(string calldata itemId, uint128 price) external onlyOwner {
        priceOf[itemId] = price;
        emit ItemPriced(itemId, price);
    }

    /// @param agentId which agent the item applies to (0 = wallet-level)
    function purchase(string calldata itemId, uint256 agentId)
        external
        payable
        nonReentrant
    {
        uint128 price = priceOf[itemId];
        if (price == 0) revert NotForSale();
        if (msg.value != price) revert WrongPayment();
        emit ItemPurchased(msg.sender, itemId, agentId, price);
    }

    function withdraw(address to, uint256 amount) external onlyOwner nonReentrant {
        (bool ok, ) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}
