// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {HeimdallVault} from "./HeimdallVault.sol";
import {HeimdallVaultDeployer} from "./HeimdallVaultDeployer.sol";

/// @title HeimdallVaultFactory
/// @notice Anyone can open a vault and become its manager agent. Every vault starts from the platform's
///         reviewed defaults (Shield signer, allowed targets/spenders, tracked assets with price feeds),
///         and is owned by the platform admin (a Safe), never by the manager.
contract HeimdallVaultFactory is Ownable2Step {
    IERC20 public immutable baseAsset;
    HeimdallVaultDeployer public immutable deployer;
    address public vaultAdmin;
    address public feeRecipient;
    address public shieldSigner;
    uint16 public maxTradeBpsCap = 2_500; // a manager may not ask for more than 25% per trade
    uint16 public maxLossBpsCap = 300; // or more than 3% loss per trade
    uint16 public dailyLossBps = 500; // every vault: at most 5% of NAV lost to trades per 24h
    uint256 public defaultDepositCap = 10_000e6; // guarded launch: 10,000 USDG per vault, raised by the admin later
    address public heimToken; // optional $HEIM: holder managers pay half the platform fee
    uint256 public holderMin = 100_000e18;

    HeimdallVault.CallPerm[] internal _defaultCalls;
    address[] public defaultSpenders;
    HeimdallVault.AssetInit[] public defaultAssets;

    address[] public allVaults;
    mapping(address => bool) public isVault;

    event VaultCreated(address indexed vault, address indexed manager, string name, string symbol, uint16 maxTradeBps, uint16 maxLossBps);
    event DefaultsUpdated();
    event RolesUpdated(address vaultAdmin, address feeRecipient, address shieldSigner);
    event CapsUpdated(uint16 tradeCap, uint16 lossCap, uint16 dailyLoss, uint256 depositCap);
    event HolderTermsUpdated(address indexed token, uint256 minBalance);

    error LimitAboveCap();
    error ZeroAddress();
    error InvalidConfig();

    constructor(IERC20 base, HeimdallVaultDeployer deployer_, address owner_, address admin, address fees, address signer) Ownable(owner_) {
        if (address(base) == address(0) || admin == address(0) || fees == address(0) || signer == address(0)) {
            revert ZeroAddress();
        }
        baseAsset = base;
        deployer = deployer_;
        vaultAdmin = admin;
        feeRecipient = fees;
        shieldSigner = signer;
        emit RolesUpdated(admin, fees, signer);
    }

    function createVault(string calldata name, string calldata symbol, uint16 maxTradeBps, uint16 maxLossBps)
        external
        returns (address vault)
    {
        if (maxTradeBps == 0 || maxTradeBps > maxTradeBpsCap || maxLossBps > maxLossBpsCap) revert LimitAboveCap();
        HeimdallVault.InitConfig memory c = HeimdallVault.InitConfig({
            baseAsset: baseAsset,
            name: name,
            symbol: symbol,
            owner: vaultAdmin,
            manager: msg.sender,
            feeRecipient: feeRecipient,
            shieldSigner: shieldSigner,
            maxTradeBps: maxTradeBps,
            maxLossBps: maxLossBps,
            maxDailyLossBps: dailyLossBps > maxLossBps ? dailyLossBps : maxLossBps,
            depositCap: defaultDepositCap,
            heimToken: heimToken,
            holderMin: holderMin,
            calls: _defaultCalls,
            spenders: defaultSpenders,
            assets: defaultAssets
        });
        vault = deployer.deploy(c);
        allVaults.push(vault);
        isVault[vault] = true;
        emit VaultCreated(vault, msg.sender, name, symbol, maxTradeBps, maxLossBps);
    }

    function vaultCount() external view returns (uint256) {
        return allVaults.length;
    }

    function getDefaults()
        external
        view
        returns (HeimdallVault.CallPerm[] memory calls, address[] memory spenders, HeimdallVault.AssetInit[] memory assets)
    {
        return (_defaultCalls, defaultSpenders, defaultAssets);
    }

    function setDefaults(
        HeimdallVault.CallPerm[] calldata calls,
        address[] calldata spenders,
        HeimdallVault.AssetInit[] calldata assets
    ) external onlyOwner {
        delete _defaultCalls;
        for (uint256 i; i < calls.length; ++i) {
            if (calls[i].target == address(0) || calls[i].target == address(baseAsset)) revert InvalidConfig();
            _defaultCalls.push(calls[i]);
        }
        defaultSpenders = spenders;
        delete defaultAssets;
        for (uint256 i; i < assets.length; ++i) {
            if (assets[i].token == address(0) || assets[i].feed == address(0) || assets[i].heartbeat == 0) revert InvalidConfig();
            defaultAssets.push(assets[i]);
        }
        emit DefaultsUpdated();
    }

    function setRoles(address admin, address fees, address signer) external onlyOwner {
        if (admin == address(0) || fees == address(0) || signer == address(0)) revert ZeroAddress();
        vaultAdmin = admin;
        feeRecipient = fees;
        shieldSigner = signer;
        emit RolesUpdated(admin, fees, signer);
    }

    function setCaps(uint16 tradeCap, uint16 lossCap, uint16 dailyLoss, uint256 depositCap_) external onlyOwner {
        if (tradeCap == 0 || tradeCap > 10_000 || lossCap > 1_000 || dailyLoss > 1_500 || dailyLoss < lossCap) {
            revert InvalidConfig();
        }
        maxTradeBpsCap = tradeCap;
        maxLossBpsCap = lossCap;
        dailyLossBps = dailyLoss;
        defaultDepositCap = depositCap_;
        emit CapsUpdated(tradeCap, lossCap, dailyLoss, depositCap_);
    }

    function setHolderTerms(address token, uint256 minBalance) external onlyOwner {
        heimToken = token;
        holderMin = minBalance;
        emit HolderTermsUpdated(token, minBalance);
    }
}
