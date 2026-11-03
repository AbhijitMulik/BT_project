const { expect } = require('chai');
const { ethers } = require('hardhat');

describe('PatentRoyaltyMarketplace', function () {
  async function deployed() {
    const [admin, inventor, buyerA, buyerB, stranger] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory('PatentRoyaltyMarketplace');
    const market = await Factory.deploy();
    await market.waitForDeployment();
    await market.connect(admin).setInventorVerified(inventor.address, true);
    await market.connect(inventor).registerPatent('AI Crop Disease Detection', ethers.parseEther('1'), 800, 'QmDemoCid');
    await market.connect(admin).approvePatent(1);
    return { market, admin, inventor, buyerA, buyerB, stranger };
  }

  it('registers a patent and completes a first sale', async function () {
    const { market, inventor, buyerA } = await deployed();
    await expect(market.connect(buyerA).buyPatent(1, { value: ethers.parseEther('1') }))
      .to.emit(market, 'PatentSold').withArgs(1, inventor.address, buyerA.address, ethers.parseEther('1'));
    expect((await market.getPatentDetails(1)).currentOwner).to.equal(buyerA.address);
  });

  it('splits resale payment and preserves the original inventor royalty', async function () {
    const { market, inventor, buyerA, buyerB } = await deployed();
    await market.connect(buyerA).buyPatent(1, { value: ethers.parseEther('1') });
    await market.connect(buyerA).listForSale(1, ethers.parseEther('2'));
    const before = await ethers.provider.getBalance(inventor.address);
    await market.connect(buyerB).resellPatent(1, { value: ethers.parseEther('2') });
    const after = await ethers.provider.getBalance(inventor.address);
    expect(after - before).to.equal(ethers.parseEther('0.16'));
    expect((await market.getRoyaltyHistory(1))[0].royaltyAmount).to.equal(ethers.parseEther('0.16'));
    expect((await market.getPatentDetails(1)).currentOwner).to.equal(buyerB.address);
  });

  it('blocks unauthorized listings and invalid payments', async function () {
    const { market, buyerA, stranger } = await deployed();
    await expect(market.connect(stranger).listForSale(1, 100)).to.be.revertedWith('Not patent owner');
    await expect(market.connect(buyerA).buyPatent(1, { value: 100 })).to.be.revertedWith('Incorrect payment');
  });

  it('blocks unverified inventors and non-admin approval', async function () {
    const [admin, inventor, stranger] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory('PatentRoyaltyMarketplace');
    const market = await Factory.deploy();
    await market.waitForDeployment();
    await expect(market.connect(inventor).registerPatent('Unverified', 100, 500, 'QmUnverified')).to.be.revertedWith('Inventor not verified');
    await expect(market.connect(stranger).setInventorVerified(inventor.address, true)).to.be.revertedWithCustomError(market, 'OwnableUnauthorizedAccount').withArgs(stranger.address);
    await market.connect(admin).setInventorVerified(inventor.address, true);
    await market.connect(inventor).registerPatent('Verified', 100, 500, 'QmVerified');
    await expect(market.connect(stranger).approvePatent(1)).to.be.revertedWithCustomError(market, 'OwnableUnauthorizedAccount').withArgs(stranger.address);
    expect((await market.getPatentDetails(1)).approved).to.equal(false);
  });

  it('keeps an unapproved patent unlisted until the admin approves it', async function () {
    const [admin, inventor, buyer] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory('PatentRoyaltyMarketplace');
    const market = await Factory.deploy();
    await market.waitForDeployment();
    await market.connect(admin).setInventorVerified(inventor.address, true);
    await market.connect(inventor).registerPatent('Pending Patent', ethers.parseEther('1'), 500, 'QmPending');
    await expect(market.connect(buyer).buyPatent(1, { value: ethers.parseEther('1') })).to.be.revertedWith('Patent not approved');
    await market.connect(admin).approvePatent(1);
    const patent = await market.getPatentDetails(1);
    expect(patent.approved).to.equal(true);
    expect(patent.listed).to.equal(true);
    await market.connect(buyer).buyPatent(1, { value: ethers.parseEther('1') });
  });
});