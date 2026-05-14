require("@nomicfoundation/hardhat-ethers");
require("@nomicfoundation/hardhat-chai-matchers");
require("@nomicfoundation/hardhat-network-helpers");
require("dotenv").config();

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: { optimizer: { enabled: true, runs: 200 } },
  },
  networks: {
    // ─── Arc Testnet ───────────────────────────────────────────
    arc_testnet: {
      url:     "https://rpc.testnet.arc.network",
      chainId: 5042002,
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
    },
    // ─── Local Hardhat ─────────────────────────────────────────
    hardhat: { chainId: 31337 },
  },
  etherscan: {
    apiKey: { arc_testnet: "no-key" },
    customChains: [{
      network: "arc_testnet",
      chainId: 5042002,
      urls: {
        apiURL:     "https://testnet.arcscan.app/api",
        browserURL: "https://testnet.arcscan.app",
      },
    }],
  },
};
