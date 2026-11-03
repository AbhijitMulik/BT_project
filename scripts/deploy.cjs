const hre = require('hardhat');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const Factory = await hre.ethers.getContractFactory('PatentRoyaltyMarketplace');
  const market = await Factory.deploy();
  await market.waitForDeployment();
  const address = await market.getAddress();
  const network = await hre.ethers.provider.getNetwork();
  const envPath = path.join(__dirname, '..', 'frontend', '.env.local');
  const current = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
  const withoutAddress = current.replace(/^VITE_CONTRACT_ADDRESS=.*$/m, '').replace(/^VITE_CHAIN_ID=.*$/m, '');
  fs.writeFileSync(envPath, `${withoutAddress.trim()}\nVITE_CONTRACT_ADDRESS=${address}\nVITE_CHAIN_ID=${network.chainId}\n`);
  console.log(`PatentRoyaltyMarketplace deployed to ${address}`);
  console.log(`Frontend configuration written to ${envPath}`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });