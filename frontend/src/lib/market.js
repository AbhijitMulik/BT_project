import { BrowserProvider, Contract, JsonRpcProvider } from 'ethers';

export const marketAbi = [
  'function owner() view returns (address)',
  'function patentCount() view returns (uint256)',
  'function getPatents(uint256 offset, uint256 limit) view returns (tuple(uint256 id,string name,address inventor,address currentOwner,uint256 originalPrice,uint16 royaltyBps,string ipfsCid,bool active,bool listed,uint256 salePrice,uint256 saleCount,uint256 registeredAt,bool approved)[])',
  'function getPatentDetails(uint256 id) view returns (tuple(uint256 id,string name,address inventor,address currentOwner,uint256 originalPrice,uint16 royaltyBps,string ipfsCid,bool active,bool listed,uint256 salePrice,uint256 saleCount,uint256 registeredAt,bool approved))',
  'function getOwnershipHistory(uint256 id) view returns (tuple(uint256 patentId,address from,address to,uint256 price,uint256 timestamp,uint8 transferType)[])',
  'function getRoyaltyHistory(uint256 id) view returns (tuple(uint256 patentId,address inventor,address seller,address buyer,uint256 resalePrice,uint16 royaltyBps,uint256 royaltyAmount,uint256 timestamp)[])',
  'function totalRoyaltyEarned(address) view returns (uint256)',
  'function royaltyPaymentCount(address) view returns (uint256)',
  'function verifiedInventor(address) view returns (bool)',
  'function setInventorVerified(address,bool)',
  'function approvePatent(uint256)',
  'function registerPatent(string,uint256,uint16,string) returns (uint256)',
  'function listForSale(uint256,uint256)',
  'function cancelListing(uint256)',
  'function buyPatent(uint256) payable',
  'function resellPatent(uint256) payable',
  'function transferOwnership(uint256,address)',
  'event PatentRegistered(uint256 indexed id,address indexed inventor,string name,uint256 originalPrice,uint16 royaltyBps,string ipfsCid)',
  'event PatentListed(uint256 indexed id,address indexed seller,uint256 price)',
  'event PatentSold(uint256 indexed id,address indexed seller,address indexed buyer,uint256 price)',
  'event PatentResold(uint256 indexed id,address indexed seller,address indexed buyer,address inventor,uint256 price,uint256 royaltyAmount,uint256 sellerAmount)',
  'event RoyaltyPaid(uint256 indexed id,address indexed inventor,address indexed payer,uint256 amount)'
];

export const contractAddress = import.meta.env.VITE_CONTRACT_ADDRESS || '';
export const chainId = Number(import.meta.env.VITE_CHAIN_ID || 31337);

export function readContract() {
  if (!contractAddress) return null;
  const provider = new JsonRpcProvider(import.meta.env.VITE_RPC_URL || 'http://127.0.0.1:8545');
  return new Contract(contractAddress, marketAbi, provider);
}

export async function signerContract() {
  if (!contractAddress || !window.ethereum) return null;
  const provider = new BrowserProvider(window.ethereum);
  return new Contract(contractAddress, marketAbi, await provider.getSigner());
}

export function normalizePatent(patent) {
  const id = patent.id ?? patent[0];
  const name = patent.name ?? patent[1];
  const inventor = patent.inventor ?? patent[2];
  const currentOwner = patent.currentOwner ?? patent[3];
  const originalPrice = patent.originalPrice ?? patent[4];
  const royaltyBps = patent.royaltyBps ?? patent[5];
  const ipfsCid = patent.ipfsCid ?? patent[6];
  const active = patent.active ?? patent[7];
  const listed = patent.listed ?? patent[8];
  const salePrice = patent.salePrice ?? patent[9];
  const saleCount = patent.saleCount ?? patent[10];
  const approved = patent.approved ?? patent[12];
  return {
    id: Number(id),
    name,
    inventor: inventor || 'Unknown inventor',
    owner: currentOwner || 'Unknown owner',
    royalty: Number(royaltyBps) / 100,
    price: Number(salePrice) / 1e18,
    originalPrice: Number(originalPrice) / 1e18,
    inventorWallet: inventor,
    ownerWallet: currentOwner,
    status: !approved ? 'Pending approval' : active ? (listed ? (Number(saleCount) ? 'Listed' : 'First sale') : 'Owned') : 'Inactive',
    cid: ipfsCid,
    resales: Number(saleCount) > 1 ? Number(saleCount) - 1 : 0,
    earned: 0,
    color: 'mint'
  };
}