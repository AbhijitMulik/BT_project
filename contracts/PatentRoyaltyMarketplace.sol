// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from '@openzeppelin/contracts/access/Ownable.sol';
import {Pausable} from '@openzeppelin/contracts/utils/Pausable.sol';
import {ReentrancyGuard} from '@openzeppelin/contracts/utils/ReentrancyGuard.sol';

/// @title PatentChain - academic prototype, not legal patent ownership.
contract PatentRoyaltyMarketplace is Ownable, Pausable, ReentrancyGuard {
    uint16 public constant MAX_ROYALTY_BPS = 2_500;
    uint256 private constant BPS = 10_000;

    enum TransferType { Registration, FirstSale, Resale, DirectTransfer }

    struct Patent {
        uint256 id;
        string name;
        address inventor;
        address currentOwner;
        uint256 originalPrice;
        uint16 royaltyBps;
        string ipfsCid;
        bool active;
        bool listed;
        uint256 salePrice;
        uint256 saleCount;
        uint256 registeredAt;
        bool approved;
    }

    struct OwnershipRecord {
        uint256 patentId;
        address from;
        address to;
        uint256 price;
        uint256 timestamp;
        TransferType transferType;
    }

    struct RoyaltyRecord {
        uint256 patentId;
        address inventor;
        address seller;
        address buyer;
        uint256 resalePrice;
        uint16 royaltyBps;
        uint256 royaltyAmount;
        uint256 timestamp;
    }

    uint256 public patentCount;
    mapping(uint256 => Patent) private patents;
    mapping(uint256 => OwnershipRecord[]) private ownershipHistory;
    mapping(uint256 => RoyaltyRecord[]) private royaltyHistory;
    mapping(address => uint256) public totalRoyaltyEarned;
    mapping(address => uint256) public royaltyPaymentCount;
    mapping(bytes32 => bool) private cidUsed;
    mapping(address => bool) public verifiedInventor;

    event PatentRegistered(uint256 indexed id, address indexed inventor, string name, uint256 originalPrice, uint16 royaltyBps, string ipfsCid);
    event PatentListed(uint256 indexed id, address indexed seller, uint256 price);
    event ListingCancelled(uint256 indexed id, address indexed seller);
    event PatentSold(uint256 indexed id, address indexed seller, address indexed buyer, uint256 price);
    event PatentResold(uint256 indexed id, address indexed seller, address indexed buyer, address inventor, uint256 price, uint256 royaltyAmount, uint256 sellerAmount);
    event RoyaltyPaid(uint256 indexed id, address indexed inventor, address indexed payer, uint256 amount);
    event OwnershipTransferredForPatent(uint256 indexed id, address indexed from, address indexed to, uint256 price, TransferType transferType);
    event PatentStatusChanged(uint256 indexed id, bool active);
    event InventorVerificationChanged(address indexed inventor, bool verified);
    event PatentApproved(uint256 indexed id, address indexed admin);

    constructor() Ownable(msg.sender) {}

    modifier validPatent(uint256 id) { require(id > 0 && id <= patentCount, 'Invalid patent ID'); _; }
    modifier onlyPatentOwner(uint256 id) { require(patents[id].currentOwner == msg.sender, 'Not patent owner'); _; }

    function registerPatent(string calldata name, uint256 originalPrice, uint16 royaltyBps, string calldata ipfsCid)
        external whenNotPaused returns (uint256 id)
    {
        require(verifiedInventor[msg.sender], 'Inventor not verified');
        require(bytes(name).length > 0 && bytes(name).length <= 120, 'Invalid name');
        require(originalPrice > 0, 'Price must be > 0');
        require(royaltyBps <= MAX_ROYALTY_BPS, 'Royalty too high');
        require(bytes(ipfsCid).length >= 4 && bytes(ipfsCid).length <= 100, 'Invalid CID');
        bytes32 cidHash = keccak256(bytes(ipfsCid));
        require(!cidUsed[cidHash], 'CID already registered');
        cidUsed[cidHash] = true;
        id = ++patentCount;
        patents[id] = Patent(id, name, msg.sender, msg.sender, originalPrice, royaltyBps, ipfsCid, true, false, 0, 0, block.timestamp, false);
        ownershipHistory[id].push(OwnershipRecord(id, address(0), msg.sender, 0, block.timestamp, TransferType.Registration));
        emit PatentRegistered(id, msg.sender, name, originalPrice, royaltyBps, ipfsCid);
    }

    function listForSale(uint256 id, uint256 price) external whenNotPaused validPatent(id) onlyPatentOwner(id) {
        Patent storage patent = patents[id];
        require(patent.active, 'Patent inactive');
        require(patent.approved, 'Patent not approved');
        require(!patent.listed, 'Already listed');
        require(price > 0, 'Price must be > 0');
        patent.listed = true;
        patent.salePrice = price;
        emit PatentListed(id, msg.sender, price);
    }

    function cancelListing(uint256 id) external validPatent(id) onlyPatentOwner(id) {
        Patent storage patent = patents[id];
        require(patent.listed, 'Not listed');
        patent.listed = false;
        patent.salePrice = 0;
        emit ListingCancelled(id, msg.sender);
    }

    function buyPatent(uint256 id) external payable nonReentrant whenNotPaused validPatent(id) {
        Patent storage patent = patents[id];
        require(patent.active, 'Patent inactive');
        require(patent.approved, 'Patent not approved');
        require(patent.listed, 'Not listed');
        require(patent.saleCount == 0, 'Already sold: use resellPatent');
        require(msg.sender != patent.currentOwner, 'Owner cannot buy');
        require(msg.value == patent.salePrice, 'Incorrect payment');
        address seller = patent.currentOwner;
        uint256 price = patent.salePrice;
        patent.listed = false;
        patent.salePrice = 0;
        patent.saleCount = 1;
        _transferOwnership(patent, msg.sender, price, TransferType.FirstSale);
        emit PatentSold(id, seller, msg.sender, price);
        _pay(seller, price);
    }

    function resellPatent(uint256 id) external payable nonReentrant whenNotPaused validPatent(id) {
        Patent storage patent = patents[id];
        require(patent.active, 'Patent inactive');
        require(patent.approved, 'Patent not approved');
        require(patent.listed, 'Not listed');
        require(patent.saleCount > 0, 'First sale: use buyPatent');
        require(msg.sender != patent.currentOwner, 'Owner cannot buy');
        require(msg.value == patent.salePrice, 'Incorrect payment');
        address seller = patent.currentOwner;
        uint256 price = patent.salePrice;
        uint256 royalty = (price * patent.royaltyBps) / BPS;
        uint256 sellerAmount = price - royalty;
        patent.listed = false;
        patent.salePrice = 0;
        patent.saleCount += 1;
        totalRoyaltyEarned[patent.inventor] += royalty;
        royaltyPaymentCount[patent.inventor] += 1;
        royaltyHistory[id].push(RoyaltyRecord(id, patent.inventor, seller, msg.sender, price, patent.royaltyBps, royalty, block.timestamp));
        _transferOwnership(patent, msg.sender, price, TransferType.Resale);
        emit PatentResold(id, seller, msg.sender, patent.inventor, price, royalty, sellerAmount);
        emit RoyaltyPaid(id, patent.inventor, seller, royalty);
        if (royalty > 0) _pay(patent.inventor, royalty);
        _pay(seller, sellerAmount);
    }

    function transferOwnership(uint256 id, address to) external whenNotPaused validPatent(id) onlyPatentOwner(id) {
        Patent storage patent = patents[id];
        require(patent.active, 'Patent inactive');
        require(patent.approved, 'Patent not approved');
        require(!patent.listed, 'Cancel listing first');
        require(to != address(0) && to != msg.sender, 'Invalid recipient');
        _transferOwnership(patent, to, 0, TransferType.DirectTransfer);
    }

    function _transferOwnership(Patent storage patent, address to, uint256 price, TransferType transferType) private {
        address from = patent.currentOwner;
        patent.currentOwner = to;
        ownershipHistory[patent.id].push(OwnershipRecord(patent.id, from, to, price, block.timestamp, transferType));
        emit OwnershipTransferredForPatent(patent.id, from, to, price, transferType);
    }

    function _pay(address to, uint256 amount) private { (bool ok, ) = payable(to).call{value: amount}(''); require(ok, 'Transfer failed'); }
    function getPatentDetails(uint256 id) external view validPatent(id) returns (Patent memory) { return patents[id]; }
    function getOwnershipHistory(uint256 id) external view validPatent(id) returns (OwnershipRecord[] memory) { return ownershipHistory[id]; }
    function getRoyaltyHistory(uint256 id) external view validPatent(id) returns (RoyaltyRecord[] memory) { return royaltyHistory[id]; }

    function getPatents(uint256 offset, uint256 limit) external view returns (Patent[] memory) {
        if (offset >= patentCount) return new Patent[](0);
        uint256 end = offset + limit;
        if (end > patentCount) end = patentCount;
        Patent[] memory result = new Patent[](end - offset);
        for (uint256 i = offset; i < end; i++) result[i - offset] = patents[i + 1];
        return result;
    }

    function setPatentActive(uint256 id, bool active) external onlyOwner validPatent(id) {
        patents[id].active = active;
        if (!active) { patents[id].listed = false; patents[id].salePrice = 0; }
        emit PatentStatusChanged(id, active);
    }

    function setInventorVerified(address inventor, bool verified) external onlyOwner {
        require(inventor != address(0), 'Zero address');
        verifiedInventor[inventor] = verified;
        emit InventorVerificationChanged(inventor, verified);
    }

    function approvePatent(uint256 id) external onlyOwner validPatent(id) {
        Patent storage patent = patents[id];
        require(patent.active, 'Patent inactive');
        require(!patent.approved, 'Already approved');
        patent.approved = true;
        patent.listed = true;
        patent.salePrice = patent.originalPrice;
        emit PatentApproved(id, msg.sender);
        emit PatentListed(id, patent.currentOwner, patent.originalPrice);
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }
}
