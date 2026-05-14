const { expect }       = require("chai");
const { ethers }       = require("hardhat");
const { time }         = require("@nomicfoundation/hardhat-network-helpers");

describe("PredictionMarket", function () {
  let pm, owner, creator, alice, bob;
  const ONE_USDC  = ethers.parseUnits("1", 6);   // 1 USDC (6 decimals on Arc)
  const TEN_USDC  = ethers.parseUnits("10", 6);
  const FIVE_USDC = ethers.parseUnits("5", 6);

  beforeEach(async () => {
    [owner, creator, alice, bob] = await ethers.getSigners();
    const PredictionMarket = await ethers.getContractFactory("PredictionMarket");
    pm = await PredictionMarket.deploy();
    await pm.waitForDeployment();
  });

  // ─── Helpers ───────────────────────────────────────────────
  async function createMarket(signer, deadline, fee = 200) {
    return pm.connect(signer).createMarket(
      "Will BTC hit $100K before July 2025?",
      "crypto",
      deadline,
      fee
    );
  }

  // ─── Market Creation ───────────────────────────────────────
  describe("createMarket", () => {
    it("creates market with correct params", async () => {
      const deadline = (await time.latest()) + 7 * 86400;
      await createMarket(creator, deadline);

      const m = await pm.getMarket(1);
      expect(m.id).to.equal(1);
      expect(m.creator).to.equal(creator.address);
      expect(m.question).to.equal("Will BTC hit $100K before July 2025?");
      expect(m.category).to.equal("crypto");
      expect(m.state).to.equal(0); // Open
      expect(m.deadline).to.equal(deadline);
    });

    it("increments market count", async () => {
      const deadline = (await time.latest()) + 86400;
      await createMarket(creator, deadline);
      await createMarket(creator, deadline);
      expect(await pm.marketCount()).to.equal(2);
    });

    it("reverts with past deadline", async () => {
      const past = (await time.latest()) - 100;
      await expect(createMarket(creator, past))
        .to.be.revertedWithCustomError(pm, "InvalidDeadline");
    });

    it("reverts with creator fee > 500 bps", async () => {
      const deadline = (await time.latest()) + 86400;
      await expect(createMarket(creator, deadline, 501))
        .to.be.revertedWithCustomError(pm, "InvalidFee");
    });

    it("emits MarketCreated event", async () => {
      const deadline = (await time.latest()) + 86400;
      await expect(createMarket(creator, deadline))
        .to.emit(pm, "MarketCreated")
        .withArgs(1, creator.address, "Will BTC hit $100K before July 2025?", "crypto", deadline);
    });
  });

  // ─── Place Bet ─────────────────────────────────────────────
  describe("placeBet", () => {
    let marketId, deadline;

    beforeEach(async () => {
      deadline = (await time.latest()) + 7 * 86400;
      await createMarket(creator, deadline);
      marketId = 1;
    });

    it("accepts YES bet", async () => {
      await pm.connect(alice).placeBet(marketId, 1, { value: TEN_USDC });
      const m = await pm.getMarket(marketId);
      expect(m.yesPool).to.equal(TEN_USDC);
    });

    it("accepts NO bet", async () => {
      await pm.connect(bob).placeBet(marketId, 2, { value: FIVE_USDC });
      const m = await pm.getMarket(marketId);
      expect(m.noPool).to.equal(FIVE_USDC);
    });

    it("reverts with zero bet", async () => {
      await expect(pm.connect(alice).placeBet(marketId, 1, { value: 0 }))
        .to.be.revertedWithCustomError(pm, "ZeroBet");
    });

    it("reverts with invalid outcome", async () => {
      await expect(pm.connect(alice).placeBet(marketId, 0, { value: ONE_USDC }))
        .to.be.revertedWithCustomError(pm, "InvalidOutcome");
    });

    it("reverts after deadline", async () => {
      await time.increaseTo(deadline + 1);
      await expect(pm.connect(alice).placeBet(marketId, 1, { value: ONE_USDC }))
        .to.be.revertedWithCustomError(pm, "DeadlinePassed");
    });

    it("tracks implied probability", async () => {
      await pm.connect(alice).placeBet(marketId, 1, { value: TEN_USDC });   // 10 YES
      await pm.connect(bob).placeBet(marketId, 2, { value: FIVE_USDC });    // 5 NO
      const [yesBps, noBps] = await pm.getImpliedProbability(marketId);
      expect(yesBps).to.equal(6666n);   // ~66.66%
      expect(noBps).to.equal(3334n);
    });
  });

  // ─── Resolve & Claim ───────────────────────────────────────
  describe("resolveMarket + claimWinnings", () => {
    let marketId, deadline;

    beforeEach(async () => {
      deadline = (await time.latest()) + 86400;
      await createMarket(creator, deadline, 200); // 2% creator fee
      marketId = 1;

      // Alice bets YES: 10 USDC
      await pm.connect(alice).placeBet(marketId, 1, { value: TEN_USDC });
      // Bob bets NO: 5 USDC
      await pm.connect(bob).placeBet(marketId, 2, { value: FIVE_USDC });

      // Advance past deadline
      await time.increaseTo(deadline + 1);

      // Close market
      await pm.connect(creator).closeMarket(marketId);
    });

    it("resolves YES — alice wins, bob gets nothing", async () => {
      await pm.connect(creator).resolveMarket(marketId, 1); // YES wins

      // Alice claims
      const before = await ethers.provider.getBalance(alice.address);
      const tx     = await pm.connect(alice).claimWinnings(marketId);
      const receipt = await tx.wait();
      const gasCost = receipt.gasUsed * tx.gasPrice;
      const after   = await ethers.provider.getBalance(alice.address);
      const profit  = after - before + gasCost;

      // Alice gets 15 USDC total - 1% protocol - 2% creator = 14.55 USDC
      // She bet 10 so net gain should be positive
      expect(profit).to.be.gt(0n);

      // Bob can't claim
      await expect(pm.connect(bob).claimWinnings(marketId))
        .to.be.revertedWithCustomError(pm, "NoWinnings");
    });

    it("reverts double claim", async () => {
      await pm.connect(creator).resolveMarket(marketId, 1);
      await pm.connect(alice).claimWinnings(marketId);
      await expect(pm.connect(alice).claimWinnings(marketId))
        .to.be.revertedWithCustomError(pm, "AlreadyClaimed");
    });

    it("protocol owner can withdraw fees", async () => {
      await pm.connect(creator).resolveMarket(marketId, 1);
      await pm.connect(alice).claimWinnings(marketId);

      // Protocol fee = 1% of grossPayout
      // grossPayout = (10 / 10) * 15 = 15 USDC
      // protocolCut = 1% of 15 = 0.15 USDC = 150000 (6 decimals)
      const fees = await pm.protocolFees();
      expect(fees).to.be.gt(0n); // fees accumulated in contract

      // Owner withdraws
      const before = await ethers.provider.getBalance(owner.address);
      const tx     = await pm.connect(owner).withdrawProtocolFees();
      await tx.wait();

      const feesAfter = await pm.protocolFees();
      expect(feesAfter).to.equal(0n); // cleared after withdrawal
    });
  });

  // ─── Getters ───────────────────────────────────────────────
  describe("view functions", () => {
    it("getMarketIds returns paginated ids", async () => {
      const deadline = (await time.latest()) + 86400;
      await createMarket(creator, deadline);
      await createMarket(creator, deadline);
      await createMarket(creator, deadline);

      const ids = await pm.getMarketIds(0, 2);
      expect(ids).to.deep.equal([1n, 2n]);
    });

    it("returns 50/50 probability for empty market", async () => {
      const deadline = (await time.latest()) + 86400;
      await createMarket(creator, deadline);
      const [yes, no] = await pm.getImpliedProbability(1);
      expect(yes).to.equal(5000n);
      expect(no).to.equal(5000n);
    });
  });
});
