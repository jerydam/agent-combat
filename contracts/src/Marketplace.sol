// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title Marketplace — fixed-price listings for Agent NFTs, paid in BOT
/// @notice Approval-based (no escrow): sellers keep custody until sale.
///         Ownership and approval are re-checked at purchase time.
contract Marketplace is Ownable, ReentrancyGuard {
    struct Listing {
        address seller;
        uint128 price;
    }

    IERC721 public immutable agentNFT;
    address public feeRecipient;
    uint16 public feeBps = 250; // 2.5%

    mapping(uint256 => Listing) public listings;

    event Listed(uint256 indexed tokenId, address indexed seller, uint128 price);
    event Delisted(uint256 indexed tokenId);
    event Sold(
        uint256 indexed tokenId,
        address indexed seller,
        address indexed buyer,
        uint128 price
    );

    error NotOwner();
    error NotSeller();
    error NotListed();
    error NotApproved();
    error WrongPrice();
    error FeeTooHigh();
    error TransferFailed();

    constructor(address nft) Ownable(msg.sender) {
        agentNFT = IERC721(nft);
        feeRecipient = msg.sender;
    }

    function setFee(uint16 bps, address recipient) external onlyOwner {
        if (bps > 1000) revert FeeTooHigh();
        feeBps = bps;
        feeRecipient = recipient;
    }

    function list(uint256 tokenId, uint128 price) external {
        if (agentNFT.ownerOf(tokenId) != msg.sender) revert NotOwner();
        if (
            agentNFT.getApproved(tokenId) != address(this) &&
            !agentNFT.isApprovedForAll(msg.sender, address(this))
        ) revert NotApproved();
        listings[tokenId] = Listing(msg.sender, price);
        emit Listed(tokenId, msg.sender, price);
    }

    function delist(uint256 tokenId) external {
        if (listings[tokenId].seller != msg.sender) revert NotSeller();
        delete listings[tokenId];
        emit Delisted(tokenId);
    }

    function buy(uint256 tokenId) external payable nonReentrant {
        Listing memory l = listings[tokenId];
        if (l.seller == address(0)) revert NotListed();
        if (msg.value != l.price) revert WrongPrice();
        // Stale-listing protection: seller must still own it.
        if (agentNFT.ownerOf(tokenId) != l.seller) revert NotListed();

        delete listings[tokenId];

        uint256 fee = (uint256(l.price) * feeBps) / 10_000;
        _pay(feeRecipient, fee);
        _pay(l.seller, l.price - fee);
        agentNFT.safeTransferFrom(l.seller, msg.sender, tokenId);

        emit Sold(tokenId, l.seller, msg.sender, l.price);
    }

    function _pay(address to, uint256 amount) private {
        if (amount == 0) return;
        (bool ok, ) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}
