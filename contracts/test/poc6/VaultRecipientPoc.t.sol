// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/src/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {HeimdallVault} from "../../contracts/HeimdallVault.sol";
import {ShieldGuarded} from "../../contracts/ShieldGuarded.sol";
import {MockERC20, MockFeed, MockSwapRouter02} from "../../contracts/mocks/Mocks.sol";

/// R6-01: the vault allowlists router selectors, but never looked at the swap's `recipient`. A manager holding a
/// Shield receipt (Shield bug, misjudged simulation, or a leaked signer key) could send swap output to itself:
/// the vault only sees a NAV drop, which passes as long as it fits the per-trade and daily loss limits.
contract VaultRecipientPoc is Test {
    uint256 constant SHIELD_PK = 0xA11CE;
    HeimdallVault vault;
    MockERC20 usdg;
    MockERC20 nvda;
    MockFeed feed;
    MockSwapRouter02 router;
    address manager = address(0xBEEF);
    address user = address(0x3001);
    uint256 nonce;

    function setUp() public {
        vm.warp(1_790_000_000);
        usdg = new MockERC20("Global Dollar", "USDG", 6);
        nvda = new MockERC20("NVIDIA", "NVDA", 18);
        feed = new MockFeed(8, 100e8);
        feed.set(100e8, block.timestamp);
        router = new MockSwapRouter02();
        router.setRate(address(usdg), address(nvda), 1e28); // fair: 1 USDG -> 0.01 NVDA
        HeimdallVault.CallPerm[] memory calls = new HeimdallVault.CallPerm[](2);
        calls[0] = HeimdallVault.CallPerm(address(router), MockSwapRouter02.exactInputSingle.selector);
        calls[1] = HeimdallVault.CallPerm(address(router), MockSwapRouter02.exactInput.selector);
        address[] memory spenders = new address[](1);
        spenders[0] = address(router);
        HeimdallVault.AssetInit[] memory assets = new HeimdallVault.AssetInit[](1);
        assets[0] = HeimdallVault.AssetInit(address(nvda), address(feed), 7 days);
        vault = new HeimdallVault(HeimdallVault.InitConfig({
            baseAsset: IERC20(address(usdg)), name: "Poc", symbol: "hPOC", owner: address(this), manager: manager,
            feeRecipient: address(0xFEE), shieldSigner: vm.addr(SHIELD_PK), guardian: address(0), maxTradeBps: 2500,
            maxLossBps: 300, maxDailyLossBps: 500, depositCap: type(uint256).max, heimToken: address(0), holderMin: 0,
            calls: calls, spenders: spenders, assets: assets
        }));
        usdg.mint(user, 100_000e6);
        vm.startPrank(user);
        usdg.approve(address(vault), type(uint256).max);
        vault.deposit(100_000e6, user);
        vm.stopPrank();
        _exec(address(usdg), abi.encodeCall(IERC20.approve, (address(router), type(uint256).max)));
    }

    function _exec(address target, bytes memory data) internal {
        ShieldGuarded.Receipt memory r = ShieldGuarded.Receipt(
            address(vault), target, keccak256(data), 0, 0, uint64(block.timestamp + 120), keccak256(abi.encode(++nonce))
        );
        (uint8 v, bytes32 rr, bytes32 s) = vm.sign(SHIELD_PK, vault.receiptDigest(r));
        vm.prank(manager);
        vault.execute(target, data, r, abi.encodePacked(rr, s, v));
    }

    function _single(address recipient, uint256 amountIn) internal pure returns (MockSwapRouter02.ExactInputSingleParams memory) {
        return MockSwapRouter02.ExactInputSingleParams(address(0), address(0), 500, recipient, amountIn, 0, 0);
    }

    function _singleCall(address recipient, uint256 amountIn) internal view returns (bytes memory) {
        MockSwapRouter02.ExactInputSingleParams memory p = _single(recipient, amountIn);
        p.tokenIn = address(usdg);
        p.tokenOut = address(nvda);
        return abi.encodeCall(MockSwapRouter02.exactInputSingle, (p));
    }

    function _pathCall(address recipient, uint256 amountIn) internal view returns (bytes memory) {
        bytes memory path = abi.encodePacked(address(usdg), uint24(500), address(nvda));
        return abi.encodeCall(MockSwapRouter02.exactInput, (MockSwapRouter02.ExactInputParams(path, recipient, amountIn, 0)));
    }

    /// Fixed: swap output to anyone but the vault is refused onchain, whatever Shield said.
    function test_R6_01_swapOutputToManagerIsRefused() public {
        vm.expectRevert(abi.encodeWithSelector(HeimdallVault.CallNotAllowed.selector, address(router), MockSwapRouter02.exactInputSingle.selector));
        this.exec(address(router), _singleCall(manager, 2_900e6));
        vm.expectRevert(abi.encodeWithSelector(HeimdallVault.CallNotAllowed.selector, address(router), MockSwapRouter02.exactInput.selector));
        this.exec(address(router), _pathCall(manager, 2_900e6));
        // the router itself (ADDRESS_THIS = address(2)) would leave the output for anyone to sweep
        vm.expectRevert(abi.encodeWithSelector(HeimdallVault.CallNotAllowed.selector, address(router), MockSwapRouter02.exactInputSingle.selector));
        this.exec(address(router), _singleCall(address(2), 2_900e6));
        assertEq(nvda.balanceOf(manager), 0);
        assertEq(vault.totalAssets(), 100_000e6);
    }

    /// Normal trades still work, to the vault or to MSG_SENDER (address(1)).
    function test_R6_01_swapToVaultStillWorks() public {
        _exec(address(router), _singleCall(address(vault), 1_000e6));
        _exec(address(router), _singleCall(address(1), 1_000e6));
        _exec(address(router), _pathCall(address(vault), 1_000e6));
        assertEq(nvda.balanceOf(address(vault)), 30e18);
        assertEq(vault.totalAssets(), 100_000e6);
    }

    /// A multicall selector can never be allowlisted: it would hide any recipient.
    function test_R6_01_multicallCannotBeAllowlisted() public {
        vm.expectRevert(HeimdallVault.InvalidConfig.selector);
        vault.setCall(address(router), MockSwapRouter02.multicall.selector, true);
    }

    function exec(address target, bytes calldata data) external {
        _exec(target, data);
    }
}
