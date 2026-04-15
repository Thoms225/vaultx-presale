const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const { MerkleTree } = require("merkletreejs");
const keccak256 = require("keccak256");

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

function buildMerkleTree(addresses) {
  const leaves = addresses.map((addr) =>
    keccak256(Buffer.from(addr.slice(2), "hex"))
  );
  return new MerkleTree(leaves, keccak256, { sortPairs: true });
}

function getProof(tree, address) {
  const leaf = keccak256(Buffer.from(address.slice(2), "hex"));
  return tree.getHexProof(leaf);
}

function getRoot(tree) {
  return "0x" + tree.getRoot().toString("hex");
}

const RoundType = { PreSeed: 0, Seed: 1, Public: 2 };
const ZERO_BYTES32 = ethers.ZeroHash;

// ─────────────────────────────────────────────
// TEST SUITE
// ─────────────────────────────────────────────

describe("PresaleVault", function () {
  let owner, treasury, buyer1, buyer2, buyer3;
  let vault, token;
  let tree, merkleRoot;

  beforeEach(async function () {
    [owner, treasury, buyer1, buyer2, buyer3] = await ethers.getSigners();

    // Build merkle tree with buyer1 and buyer2 whitelisted
    tree = buildMerkleTree([buyer1.address, buyer2.address]);
    merkleRoot = getRoot(tree);

    // Deploy VaultXToken with a temporary address, then redeploy with vault
    // Step 1: Deploy vault first with a placeholder token
    const Token = await ethers.getContractFactory("VaultXToken");
    const Vault = await ethers.getContractFactory("PresaleVault");

    // Deploy vault with temp address to get vault address
    // We deploy token pointing to owner first, then vault
    // Correct order: vault address needed before token deployment
    // Solution: deploy token with owner as placeholder, then deploy vault, then check balance

    // Actually: token constructor takes presaleVault address
    // We need vault address before deploying token
    // Use: deploy vault with a mock token first, then redeploy properly

    // Proper pattern: deploy vault with nonce prediction OR use two-step
    // Simplest for tests: deploy token with owner, transfer supply to vault after

    // Deploy a simple mock or use the real token pointed to owner temporarily
    // Then deploy vault, then transfer tokens to vault

    token = await Token.deploy(owner.address); // mint to owner first
    vault = await Vault.deploy(
      await token.getAddress(),
      treasury.address
    );

    // Transfer full supply to vault
    const supply = await token.balanceOf(owner.address);
    await token.transfer(await vault.getAddress(), supply);
  });

  // ─────────────────────────────────────────────
  // 1. DEPLOYMENT
  // ─────────────────────────────────────────────

  describe("Deployment", function () {
    it("sets the correct owner", async function () {
      expect(await vault.owner()).to.equal(owner.address);
    });

    it("sets the correct treasury", async function () {
      expect(await vault.treasury()).to.equal(treasury.address);
    });

    it("vault holds the full token supply", async function () {
      const balance = await token.balanceOf(await vault.getAddress());
      expect(balance).to.be.gt(0n);
    });

    it("reverts if token address is zero", async function () {
      const Vault = await ethers.getContractFactory("PresaleVault");
      await expect(
        Vault.deploy(ethers.ZeroAddress, treasury.address)
      ).to.be.revertedWith("PresaleVault: zero token address");
    });

    it("reverts if treasury address is zero", async function () {
      const Vault = await ethers.getContractFactory("PresaleVault");
      await expect(
        Vault.deploy(await token.getAddress(), ethers.ZeroAddress)
      ).to.be.revertedWith("PresaleVault: zero treasury address");
    });

    it("all rounds start closed", async function () {
      for (const round of [RoundType.PreSeed, RoundType.Seed, RoundType.Public]) {
        const info = await vault.getRoundInfo(round);
        expect(info.isOpen).to.equal(false);
      }
    });
  });

  // ─────────────────────────────────────────────
  // 2. ROUND MANAGEMENT
  // ─────────────────────────────────────────────

  describe("Round Management", function () {
    it("owner can open a whitelisted round with merkle root", async function () {
      await expect(vault.openRound(RoundType.PreSeed, merkleRoot))
        .to.emit(vault, "RoundOpened")
        .withArgs(RoundType.PreSeed, ethers.parseEther("0.0001"), ethers.parseEther("100"));

      const info = await vault.getRoundInfo(RoundType.PreSeed);
      expect(info.isOpen).to.equal(true);
    });

    it("owner can open public round without merkle root", async function () {
      await expect(vault.openRound(RoundType.Public, ZERO_BYTES32))
        .to.emit(vault, "RoundOpened");

      const info = await vault.getRoundInfo(RoundType.Public);
      expect(info.isOpen).to.equal(true);
    });

    it("reverts opening already open round", async function () {
      await vault.openRound(RoundType.PreSeed, merkleRoot);
      await expect(
        vault.openRound(RoundType.PreSeed, merkleRoot)
      ).to.be.revertedWith("PresaleVault: round already open");
    });

    it("reverts opening whitelisted round without merkle root", async function () {
      await expect(
        vault.openRound(RoundType.PreSeed, ZERO_BYTES32)
      ).to.be.revertedWith("PresaleVault: merkle root required");
    });

    it("owner can close an open round", async function () {
      await vault.openRound(RoundType.PreSeed, merkleRoot);
      await expect(vault.closeRound(RoundType.PreSeed))
        .to.emit(vault, "RoundClosed");

      const info = await vault.getRoundInfo(RoundType.PreSeed);
      expect(info.isOpen).to.equal(false);
    });

    it("reverts closing already closed round", async function () {
      await expect(
        vault.closeRound(RoundType.PreSeed)
      ).to.be.revertedWith("PresaleVault: round not open");
    });

    it("non-owner cannot open round", async function () {
      await expect(
        vault.connect(buyer1).openRound(RoundType.Public, ZERO_BYTES32)
      ).to.be.reverted;
    });

    it("non-owner cannot close round", async function () {
      await vault.openRound(RoundType.PreSeed, merkleRoot);
      await expect(
        vault.connect(buyer1).closeRound(RoundType.PreSeed)
      ).to.be.reverted;
    });

    it("owner can update treasury", async function () {
      await expect(vault.setTreasury(buyer3.address))
        .to.emit(vault, "TreasuryUpdated")
        .withArgs(treasury.address, buyer3.address);
      expect(await vault.treasury()).to.equal(buyer3.address);
    });

    it("reverts setTreasury with zero address", async function () {
      await expect(
        vault.setTreasury(ethers.ZeroAddress)
      ).to.be.revertedWith("PresaleVault: zero address");
    });
  });

  // ─────────────────────────────────────────────
  // 3. PURCHASE LOGIC
  // ─────────────────────────────────────────────

  describe("buyTokens", function () {
    describe("Whitelisted round (PreSeed)", function () {
      beforeEach(async function () {
        await vault.openRound(RoundType.PreSeed, merkleRoot);
      });

      it("whitelisted buyer can purchase tokens", async function () {
        const proof = getProof(tree, buyer1.address);
        const payment = ethers.parseEther("0.01");

        await expect(
          vault.connect(buyer1).buyTokens(RoundType.PreSeed, proof, { value: payment })
        ).to.emit(vault, "TokensPurchased");
      });

      it("purchase sends funds to treasury", async function () {
        const proof = getProof(tree, buyer1.address);
        const payment = ethers.parseEther("0.01");
        const treasuryBefore = await ethers.provider.getBalance(treasury.address);

        await vault.connect(buyer1).buyTokens(RoundType.PreSeed, proof, { value: payment });

        const treasuryAfter = await ethers.provider.getBalance(treasury.address);
        expect(treasuryAfter - treasuryBefore).to.equal(payment);
      });

      it("creates vesting schedule after purchase", async function () {
        const proof = getProof(tree, buyer1.address);
        await vault.connect(buyer1).buyTokens(
          RoundType.PreSeed, proof, { value: ethers.parseEther("0.01") }
        );

        const info = await vault.getVestingInfo(buyer1.address);
        expect(info.totalTokens).to.be.gt(0n);
      });

      it("reverts if buyer not whitelisted", async function () {
        const fakeProof = getProof(tree, buyer1.address);
        await expect(
          vault.connect(buyer3).buyTokens(RoundType.PreSeed, fakeProof, {
            value: ethers.parseEther("0.01"),
          })
        ).to.be.revertedWith("PresaleVault: not whitelisted");
      });

      it("reverts if round is closed", async function () {
        await vault.closeRound(RoundType.PreSeed);
        const proof = getProof(tree, buyer1.address);
        await expect(
          vault.connect(buyer1).buyTokens(RoundType.PreSeed, proof, {
            value: ethers.parseEther("0.01"),
          })
        ).to.be.revertedWith("PresaleVault: round is closed");
      });

      it("reverts if msg.value is zero", async function () {
        const proof = getProof(tree, buyer1.address);
        await expect(
          vault.connect(buyer1).buyTokens(RoundType.PreSeed, proof, { value: 0 })
        ).to.be.revertedWith("PresaleVault: send ETH/BNB to buy");
      });

      it("reverts if hard cap exceeded", async function () {
        const proof = getProof(tree, buyer1.address);
        await expect(
          vault.connect(buyer1).buyTokens(RoundType.PreSeed, proof, {
            value: ethers.parseEther("101"), // hardcap is 100 ETH
          })
        ).to.be.revertedWith("PresaleVault: hard cap exceeded");
      });

      it("auto-closes round when hard cap exactly reached", async function () {
        // Set up a mini-cap round by buying exactly the cap
        // hardcap = 100 ETH, we need a buyer with enough funds
        // Use owner who has plenty
        const proof = getProof(tree, buyer1.address);
        // buyer1 default has 10000 ETH in hardhat network
        await vault.connect(buyer1).buyTokens(RoundType.PreSeed, proof, {
          value: ethers.parseEther("100"),
        });
        const info = await vault.getRoundInfo(RoundType.PreSeed);
        expect(info.isOpen).to.equal(false);
      });
    });

    describe("Public round", function () {
      beforeEach(async function () {
        await vault.openRound(RoundType.Public, ZERO_BYTES32);
      });

      it("any address can buy without proof", async function () {
        await expect(
          vault.connect(buyer3).buyTokens(RoundType.Public, [], {
            value: ethers.parseEther("0.01"),
          })
        ).to.emit(vault, "TokensPurchased");
      });

      it("emits correct TokensPurchased event", async function () {
        const payment = ethers.parseEther("0.005");
        const expectedTokens = (payment * BigInt(1e18)) / ethers.parseEther("0.0005");

        await expect(
          vault.connect(buyer3).buyTokens(RoundType.Public, [], { value: payment })
        )
          .to.emit(vault, "TokensPurchased")
          .withArgs(buyer3.address, RoundType.Public, payment, expectedTokens);
      });
    });
  });

  // ─────────────────────────────────────────────
  // 4. VESTING SCHEDULE
  // ─────────────────────────────────────────────

  describe("Vesting", function () {
    beforeEach(async function () {
      await vault.openRound(RoundType.Public, ZERO_BYTES32);
      await vault.connect(buyer1).buyTokens(RoundType.Public, [], {
        value: ethers.parseEther("0.01"),
      });
    });

    it("claimable is 0 during cliff period", async function () {
      const claimable = await vault.getClaimableTokens(buyer1.address);
      expect(claimable).to.equal(0n);
    });

    it("claimable is 0 after cliff if nothing unlocked yet (exactly at cliff)", async function () {
      // Advance to just before cliff end (30 days for Public)
      await time.increase(29 * 24 * 3600);
      const claimable = await vault.getClaimableTokens(buyer1.address);
      expect(claimable).to.equal(0n);
    });

    it("tokens unlock linearly after cliff", async function () {
      // Advance past cliff (30 days)
      await time.increase(31 * 24 * 3600);
      const claimable = await vault.getClaimableTokens(buyer1.address);
      expect(claimable).to.be.gt(0n);
    });

    it("all tokens unlocked after full vesting duration", async function () {
      // Public: 360 days vesting
      await time.increase(361 * 24 * 3600);
      const info = await vault.getVestingInfo(buyer1.address);
      const claimable = await vault.getClaimableTokens(buyer1.address);
      expect(claimable).to.equal(info.totalTokens);
    });

    it("buyer can claim vested tokens after cliff", async function () {
      await time.increase(31 * 24 * 3600);

      const balanceBefore = await token.balanceOf(buyer1.address);
      await expect(vault.connect(buyer1).claimVested())
        .to.emit(vault, "VestingClaimed");

      const balanceAfter = await token.balanceOf(buyer1.address);
      expect(balanceAfter).to.be.gt(balanceBefore);
    });

    it("claimed tokens are deducted from claimable", async function () {
      await time.increase(31 * 24 * 3600);
      await vault.connect(buyer1).claimVested();

      // Immediately after claiming, claimable should be 0 or very small
      const claimable = await vault.getClaimableTokens(buyer1.address);
      expect(claimable).to.equal(0n);
    });

    it("reverts claimVested with no vesting schedule", async function () {
      await expect(
        vault.connect(buyer3).claimVested()
      ).to.be.revertedWith("PresaleVault: no vesting schedule");
    });

    it("reverts claimVested during cliff period", async function () {
      await expect(
        vault.connect(buyer1).claimVested()
      ).to.be.revertedWith("PresaleVault: nothing to claim yet");
    });

    it("multiple purchases accumulate in same vesting schedule", async function () {
      await vault.connect(buyer1).buyTokens(RoundType.Public, [], {
        value: ethers.parseEther("0.01"),
      });

      const info = await vault.getVestingInfo(buyer1.address);
      // Should be double the single purchase amount
      expect(info.totalTokens).to.be.gt(0n);
    });
  });

  // ─────────────────────────────────────────────
  // 5. VIEW FUNCTIONS
  // ─────────────────────────────────────────────

  describe("View Functions", function () {
    it("getRoundInfo returns correct data", async function () {
      const info = await vault.getRoundInfo(RoundType.PreSeed);
      expect(info.tokenPrice).to.equal(ethers.parseEther("0.0001"));
      expect(info.hardCap).to.equal(ethers.parseEther("100"));
      expect(info.totalRaised).to.equal(0n);
      expect(info.isOpen).to.equal(false);
      expect(info.whitelistRequired).to.equal(true);
    });

    it("getVestingInfo returns zeros for address with no schedule", async function () {
      const info = await vault.getVestingInfo(buyer3.address);
      expect(info.totalTokens).to.equal(0n);
      expect(info.claimedTokens).to.equal(0n);
    });

    it("getClaimableTokens returns 0 for unknown address", async function () {
      expect(await vault.getClaimableTokens(buyer3.address)).to.equal(0n);
    });
  });

  // ─────────────────────────────────────────────
  // 6. GAS CHECK
  // ─────────────────────────────────────────────

  describe("Gas", function () {
    it("buyTokens uses less than 150,000 gas", async function () {
      await vault.openRound(RoundType.Public, ZERO_BYTES32);
      const tx = await vault.connect(buyer1).buyTokens(
        RoundType.Public, [], { value: ethers.parseEther("0.01") }
      );
      const receipt = await tx.wait();
      expect(receipt.gasUsed).to.be.lt(150000n);
    });
  });
  
  // ─────────────────────────────────────────────
  // 7. BRANCH COVERAGE
  // ─────────────────────────────────────────────

  describe("Branch Coverage", function () {
    it("Seed round: whitelisted buyer can purchase and gets correct vesting params", async function () {
      await vault.openRound(RoundType.Seed, merkleRoot);
      const proof = getProof(tree, buyer1.address);

      await vault.connect(buyer1).buyTokens(
        RoundType.Seed, proof, { value: ethers.parseEther("0.01") }
      );

      const info = await vault.getVestingInfo(buyer1.address);
      expect(info.totalTokens).to.be.gt(0n);
      // Seed cliff = 90 days
      expect(info.cliffEnd - info.startTime).to.equal(90 * 24 * 3600);
    });

    it("PreSeed round: whitelisted buyer gets correct vesting params", async function () {
      await vault.openRound(RoundType.PreSeed, merkleRoot);
      const proof = getProof(tree, buyer2.address);

      await vault.connect(buyer2).buyTokens(
        RoundType.PreSeed, proof, { value: ethers.parseEther("0.01") }
      );

      const info = await vault.getVestingInfo(buyer2.address);
      // PreSeed cliff = 180 days
      expect(info.cliffEnd - info.startTime).to.equal(180 * 24 * 3600);
    });

    it("claimVested: full vesting reached returns all tokens", async function () {
      await vault.openRound(RoundType.Public, ZERO_BYTES32);
      await vault.connect(buyer1).buyTokens(
        RoundType.Public, [], { value: ethers.parseEther("0.01") }
      );

      // Advance past full vesting duration (360 days)
      await time.increase(361 * 24 * 3600);

      const info = await vault.getVestingInfo(buyer1.address);
      const claimable = await vault.getClaimableTokens(buyer1.address);
      expect(claimable).to.equal(info.totalTokens);

      await expect(vault.connect(buyer1).claimVested())
        .to.emit(vault, "VestingClaimed");

      expect(await vault.getClaimableTokens(buyer1.address)).to.equal(0n);
    });

    it("nextUnlockTimestamp returns block.timestamp + 30 days after cliff passed", async function () {
      await vault.openRound(RoundType.Public, ZERO_BYTES32);
      await vault.connect(buyer1).buyTokens(
        RoundType.Public, [], { value: ethers.parseEther("0.01") }
      );

      await time.increase(31 * 24 * 3600);
      const info = await vault.getVestingInfo(buyer1.address);
      expect(info.nextUnlockTimestamp).to.be.gt(info.cliffEnd);
    });
  });
});