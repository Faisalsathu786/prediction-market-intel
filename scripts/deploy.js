const hre = require("hardhat");

async function main() {
  console.log("🔮 Deploying PredictionMarket to Arc Testnet...");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  const [deployer] = await hre.ethers.getSigners();
  console.log("📬 Deployer:", deployer.address);

  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("💰 Balance: ", hre.ethers.formatUnits(balance, 6), "USDC");

  if (balance === 0n) {
    console.error("❌ Zero balance! Get testnet USDC from: https://faucet.circle.com");
    process.exit(1);
  }

  // Deploy
  const PredictionMarket = await hre.ethers.getContractFactory("PredictionMarket");
  const pm = await PredictionMarket.deploy();
  await pm.waitForDeployment();

  const address = await pm.getAddress();
  console.log("\n✅ PredictionMarket deployed!");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("📋 Contract Address:", address);
  console.log("🔍 ArcScan:         ", `https://testnet.arcscan.app/address/${address}`);
  console.log("⛓  Network:         ", hre.network.name, "(Chain ID 5042002)");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  // Create a sample market
  console.log("\n📝 Creating sample market...");
  const oneWeek = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;
  const tx = await pm.createMarket(
    "Will BTC hit $100K before July 2025?",
    "crypto",
    oneWeek,
    200  // 2% creator fee
  );
  await tx.wait();
  console.log("✅ Sample market created! ID: 1");
  console.log("🔗 Tx:", tx.hash);

  // Save deployment info
  const fs = require("fs");
  const deployInfo = {
    network:  "arc_testnet",
    chainId:  5042002,
    address:  address,
    deployer: deployer.address,
    deployedAt: new Date().toISOString(),
    explorer: `https://testnet.arcscan.app/address/${address}`,
  };

  fs.writeFileSync(
    "./deployments/arc_testnet.json",
    JSON.stringify(deployInfo, null, 2)
  );
  console.log("\n💾 Deployment info saved to deployments/arc_testnet.json");
  console.log("\n🚀 Next: Update CONTRACT_ADDRESS in index.html with:", address);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
