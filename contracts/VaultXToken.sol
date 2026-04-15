// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title VaultXToken
 * @notice ERC-20 token for the VaultX presale ecosystem
 * @dev Minted entirely at deployment and transferred to PresaleVault
 */
contract VaultXToken is ERC20, Ownable {
    uint256 public constant MAX_SUPPLY = 1_000_000_000 * 10 ** 18; // 1 billion tokens

    constructor(address presaleVault) ERC20("VaultX Token", "VLX") Ownable(msg.sender) {
        // Mint entire supply directly to the presale vault
        _mint(presaleVault, MAX_SUPPLY);
    }
}
