# PatentChain

Blockchain-Based Patent Ownership & Resale Royalty Management System. This is an academic prototype: it records digital ownership and contractual payments, but does not replace official patent registration or legal ownership.

## Run locally

Requirements: Node.js 20+ and MetaMask for wallet testing. MongoDB is optional; without `MONGO_URI`, the API uses an in-memory profile/metadata store.

```powershell
npm install
Push-Location backend; npm install; Pop-Location
Push-Location frontend; npm install; Pop-Location
npm test
```

For the contract-connected local demo, use four terminals:

```powershell
npm run node
npm run deploy:local
npm run seed:local
npm run dev
```

Open `http://localhost:5173`. Deployment writes the address to `frontend/.env.local`; restart Vite after redeploying. The API runs on `http://localhost:4000`.

For a UI-only walkthrough, `npm run dev` is enough and the frontend falls back to fictional demo data when no contract address is configured.

## Contract

`PatentRoyaltyMarketplace.sol` implements registration, first sale, resale listing, royalty distribution, ownership transfer, ownership history, and royalty history. Resales require the exact listed payment and split it inside the contract between the original inventor and current seller.

For a local blockchain, `npm run deploy:local` deploys the contract and writes `VITE_CONTRACT_ADDRESS` and `VITE_CHAIN_ID` to `frontend/.env.local`. `npm run seed:local` registers three fictional patents, performs the first sale and two resales for patent #1, and leaves the other patents listed. Set `PINATA_JWT` and `MOCK_IPFS=false` for real Pinata uploads; otherwise valid PDFs are stored locally and exposed through `/files/:cid`.

Import Hardhat account #1 as the inventor, #2 as Company A, #3 as Company B, and #4 as Company C in MetaMask. Use network RPC `http://127.0.0.1:8545`, chain ID `31337`, and never use these public test keys on a real network.

The frontend reads marketplace data from the contract and uses `buyPatent`, `resellPatent`, and `listForSale` when a wallet and deployed address are available. It retains demo-mode actions for presentation without MetaMask.

## Role workflow

Wallets authenticate by signing a nonce; there are no passwords. Choose a role beside the Connect wallet button:

- Buyer / Company: browse and purchase listed patents.
- Reseller / Owner: sign in as a wallet that currently owns a patent and list it for resale.
- Inventor: submit `/verification` first. An admin must verify the wallet on-chain before it can register patents.
- Admin: use the Hardhat deployer wallet (account #0) and open `/admin` to review inventor requests.

Registration is now ordered as: authenticated PDF upload -> IPFS/mock CID -> MetaMask contract registration -> MongoDB/in-memory metadata save. New patents remain pending until the admin calls `approvePatent`.

## Verified

- `npm test`: 3 Hardhat tests passing
- `npm --prefix frontend run build`: production bundle builds successfully
- `GET /api/health`: API responds with `{ "ok": true }`
- `npm run deploy:local`: local deployment succeeds
- `npm run seed:local`: three-patent, three-sale demo succeeds

## Blueprint status

Implemented foundations include the contract source of truth, wallet-signature API authentication, profile and metadata routes, secure PDF validation, Pinata/mock IPFS upload, local deployment, seed data, and contract-connected marketplace actions. The current React surface still presents the existing marketplace/dashboard views; the full multi-route admin/profile/chart surface from the larger blueprint remains a follow-up UI phase.