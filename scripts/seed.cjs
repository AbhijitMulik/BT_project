const hre = require('hardhat');

const eth = (value) => hre.ethers.parseEther(value);
const cid = (letter) => `Qm${letter.repeat(44)}`;

async function main() {
  const [admin, inventor, companyA, companyB, companyC] = await hre.ethers.getSigners();
  const deployments = await hre.ethers.getContractFactory('PatentRoyaltyMarketplace');
  const addressFile = require('node:path').join(__dirname, '..', 'frontend', '.env.local');
  const text = require('node:fs').readFileSync(addressFile, 'utf8');
  const address = text.match(/^VITE_CONTRACT_ADDRESS=(.+)$/m)?.[1];
  if (!address) throw new Error('Deploy the contract first with npm run deploy:local');
  const market = deployments.attach(address);

  await (await market.connect(admin).setInventorVerified(inventor.address, true)).wait();
  await (await market.connect(inventor).registerPatent('AI-Based Crop Disease Detection System', eth('5'), 800, cid('a'))).wait();
  await (await market.connect(admin).approvePatent(1)).wait();
  await (await market.connect(inventor).registerPatent('Low-Cost Solar Water Purifier', eth('3'), 500, cid('b'))).wait();
  await (await market.connect(admin).approvePatent(2)).wait();
  await (await market.connect(inventor).registerPatent('Biodegradable Rice Husk Packaging', eth('4'), 1000, cid('c'))).wait();
  await (await market.connect(admin).approvePatent(3)).wait();

  await (await market.connect(companyA).buyPatent(1, { value: eth('5') })).wait();
  await (await market.connect(companyA).listForSale(1, eth('8'))).wait();
  await (await market.connect(companyB).resellPatent(1, { value: eth('8') })).wait();
  await (await market.connect(companyB).listForSale(1, eth('12'))).wait();
  await (await market.connect(companyC).resellPatent(1, { value: eth('12') })).wait();
  console.log(`Seeded demo patents. Admin: ${admin.address}; inventor: ${inventor.address}; company A/B/C: ${companyA.address}, ${companyB.address}, ${companyC.address}`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });