# VaultX Presale — Smart Contract

Multi-round token presale system with whitelist gating and linear vesting, deployed on Ethereum Sepolia and BSC Testnet.

## Overview

PresaleVault is an auditable Solidity smart contract implementing:
- **3 presale rounds** : Pre-Seed, Seed, and Public with tiered pricing
- **Whitelist gating** : Merkle proof verification for private rounds
- **Linear vesting** : Cliff period + monthly release via `claimVested()`
- **Dual-network** : Deployed identically on Ethereum and BNB Smart Chain
- **Gas optimized** : `buyTokens()` under 150,000 gas via struct packing

---

## Deployed Contracts

### Ethereum Sepolia (Testnet)

| Contract | Address | Explorer |
|---|---|---|
| VaultXToken | `0x95f19a42fc11571bfE80CC757CA856dC945c581D` | [Etherscan](https://sepolia.etherscan.io/address/0x95f19a42fc11571bfE80CC757CA856dC945c581D#code) |
| PresaleVault | `0xe82136Feed9FA22D7780ea58cEfAe171CC34220C` | [Etherscan](https://sepolia.etherscan.io/address/0xe82136Feed9FA22D7780ea58cEfAe171CC34220C#code) |

### BNB Smart Chain Testnet

| Contract | Address | Explorer |
|---|---|---|
| VaultXToken | `0x95f19a42fc11571bfE80CC757CA856dC945c581D` | [BscScan](https://testnet.bscscan.com/address/0x95f19a42fc11571bfE80CC757CA856dC945c581D#code) |
| PresaleVault | `0xe82136Feed9FA22D7780ea58cEfAe171CC34220C` | [BscScan](https://testnet.bscscan.com/address/0xe82136Feed9FA22D7780ea58cEfAe171CC34220C#code) |

---

## Architecture

PresaleVault.sol
├── Module 1 — Structs & State (Round, VestingSchedule)
├── Module 2 — Events (TokensPurchased, VestingClaimed, RoundOpened, RoundClosed)
├── Module 3 — Constructor
├── Module 4 — Round Management (openRound, closeRound, setTreasury)
├── Module 5 — Purchase Logic (buyTokens)
├── Module 6 — Vesting Logic (claimVested, _computeUnlocked)
└── Module 7 — View Functions (getClaimableTokens, getVestingInfo, getRoundInfo)

### Round Configuration

| Round | Price | Hard Cap | Whitelist | Cliff | Vesting |
|---|---|---|---|---|---|
| Pre-Seed | 0.0001 ETH/BNB | 100 ETH/BNB | ✅ Merkle proof | 6 months | 24 months |
| Seed | 0.0002 ETH/BNB | 300 ETH/BNB | ✅ Merkle proof | 3 months | 18 months |
| Public | 0.0005 ETH/BNB | 1000 ETH/BNB | ❌ Open | 1 month | 12 months |

---

## Test Results

43 passing
0 failing
Statements : 100%
Functions  : 100%
Lines      : 100%
Branches   : 90%

### Security

- Slither static analysis : **0 findings**
- Reentrancy guard on `buyTokens()` and `claimVested()`
- Merkle proof verification for whitelisted rounds
- Hard cap enforcement with auto-close on cap reached

### Gas

| Function | Gas Used | Limit |
|---|---|---|
| buyTokens() | < 150,000 | 150,000 ✅ |

---

## Project Structure

vaultx-presale/
├── contracts/
│   ├── PresaleVault.sol      # Main presale contract
│   └── VaultXToken.sol       # ERC-20 token (1B VLX supply)
├── test/
│   └── presale.test.js       # 43 unit tests
├── scripts/
│   └── deploy.js             # Deployment script
├── hardhat.config.js
└── package.json

---

## Local Setup

```bash
# Install dependencies
npm install

# Compile contracts
npx hardhat compile

# Run tests
npx hardhat test

# Run coverage
npx hardhat coverage

# Run security audit
slither .
```

### Environment Variables

Create a `.env` file at the root:

PRIVATE_KEY=your_private_key_without_0x
SEPOLIA_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/your_key
ETHERSCAN_API_KEY=your_etherscan_api_key
BSCSCAN_API_KEY=your_bscscan_api_key

### Deploy

```bash
# Ethereum Sepolia
npx hardhat run scripts/deploy.js --network sepolia

# BSC Testnet
npx hardhat run scripts/deploy.js --network bscTestnet
```

---

## Key Design Decisions

**Goerli → Sepolia** : Goerli was officially deprecated in 2023. Sepolia is the current standard Ethereum testnet recommended by the Ethereum Foundation.

**Struct packing** : `Round` and `VestingSchedule` use `uint128/uint64/uint32` instead of `uint256` to pack multiple values into single storage slots, reducing gas consumption on `buyTokens()` from ~186k to ~140k gas.

**Single deployment, dual network** : The same contract bytecode is deployed on both Ethereum and BSC. Network-specific logic (ETH vs BNB) is handled at the RPC/wallet level, not in the contract.

---

## License

MIT
