const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with account:", deployer.address);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Account balance:", ethers.formatEther(balance), "ETH/BNB");

  // 1. Deploy VaultXToken (mint to deployer first)
  console.log("\n[1/3] Deploying VaultXToken...");
  const Token = await ethers.getContractFactory("VaultXToken");
  const token = await Token.deploy(deployer.address);
  await token.waitForDeployment();
  const tokenAddress = await token.getAddress();
  console.log("VaultXToken deployed to:", tokenAddress);

  // 2. Deploy PresaleVault
  console.log("\n[2/3] Deploying PresaleVault...");
  const treasury = deployer.address; // use deployer as treasury for testnet
  const Vault = await ethers.getContractFactory("PresaleVault");
  const vault = await Vault.deploy(tokenAddress, treasury);
  await vault.waitForDeployment();
  const vaultAddress = await vault.getAddress();
  console.log("PresaleVault deployed to:", vaultAddress);

  // 3. Transfer full token supply to vault
  console.log("\n[3/3] Transferring token supply to vault...");
  const supply = await token.balanceOf(deployer.address);
  const tx = await token.transfer(vaultAddress, supply);
  await tx.wait();
  console.log("Transferred", ethers.formatEther(supply), "VLX to vault");

  console.log("\n✅ Deployment complete!");
  console.log("─────────────────────────────────────");
  console.log("VaultXToken :", tokenAddress);
  console.log("PresaleVault:", vaultAddress);
  console.log("Treasury    :", treasury);
  console.log("─────────────────────────────────────");
  console.log("\nNext steps:");
  console.log("Verify VaultXToken:");
  console.log(`npx hardhat verify --network sepolia ${tokenAddress} "${deployer.address}"`);
  console.log("Verify PresaleVault:");
  console.log(`npx hardhat verify --network sepolia ${vaultAddress} "${tokenAddress}" "${treasury}"`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });