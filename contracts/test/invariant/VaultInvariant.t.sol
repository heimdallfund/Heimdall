// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/src/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {HeimdallVault} from "../../contracts/HeimdallVault.sol";
import {ShieldGuarded} from "../../contracts/ShieldGuarded.sol";
import {MockERC20, MockFeed, MockRouter} from "../../contracts/mocks/Mocks.sol";

/// Random deposits, exits, manager trades (honest and hostile), price moves, harvests and time.
/// The manager is assumed compromised: it may route swap output to itself. Shield receipts are always granted,
/// so this also models a compromised Shield signer (audit question Q-3).
contract VaultHandler is Test {
    uint256 constant SHIELD_PK = 0xA11CE;
    HeimdallVault public vault;
    MockERC20 public usdg;
    MockERC20 public nvda;
    MockFeed public feed;
    MockRouter public router;
    address public manager = address(0xBEEF);
    address[3] public users = [address(0x3001), address(0x3002), address(0x3003)];
    uint256 nonce;
    uint256 public price = 100e8;

    // value (USDG units at the oracle price) the manager has extracted, per loss window
    uint64 public stealWindow;
    uint256 public stolenInWindow;
    uint256 public windowNav;
    uint256 public hostileOk;

    constructor(HeimdallVault v, MockERC20 u, MockERC20 n, MockFeed f, MockRouter r) {
        vault = v; usdg = u; nvda = n; feed = f; router = r;
        for (uint256 i; i < 3; ++i) {
            usdg.mint(users[i], 1e14);
            vm.prank(users[i]);
            usdg.approve(address(vault), type(uint256).max);
        }
        _exec(address(usdg), abi.encodeCall(IERC20.approve, (address(router), type(uint256).max)));
        _exec(address(nvda), abi.encodeCall(IERC20.approve, (address(router), type(uint256).max)));
    }

    function _exec(address target, bytes memory data) internal returns (bool ok) {
        ShieldGuarded.Receipt memory r = ShieldGuarded.Receipt({
            agent: address(vault), target: target, dataHash: keccak256(data), value: 0, verdict: 0,
            expiresAt: uint64(block.timestamp + 120), checkId: keccak256(abi.encode("inv", ++nonce))
        });
        (uint8 v, bytes32 rr, bytes32 s) = vm.sign(SHIELD_PK, vault.receiptDigest(r));
        vm.prank(manager);
        try vault.execute(target, data, r, abi.encodePacked(rr, s, v)) { ok = true; } catch { ok = false; }
    }

    function _syncRouter() internal {
        // 1 USDG (1e6) buys 1e6 * 1e12 * 1e8 / price NVDA units; rates are per 1e18 in
        router.setRate(address(usdg), address(nvda), 1e18 * 1e12 * 1e8 / price);
        router.setRate(address(nvda), address(usdg), 1e18 * price / 1e8 / 1e12);
    }

    function deposit(uint256 u, uint256 amt) external {
        amt = bound(amt, 1, 1e12);
        vm.prank(users[u % 3]); vault.deposit(amt, users[u % 3]);
    }

    function redeem(uint256 u, uint256 frac) external {
        address a = users[u % 3];
        uint256 s = vault.balanceOf(a) * bound(frac, 1, 100) / 100;
        uint256 m = vault.maxRedeem(a); // ERC-4626: redeeming up to maxRedeem must never revert
        if (s > m) s = m;
        if (s == 0 || vault.previewRedeem(s) == 0) return;
        vm.prank(a); vault.redeem(s, a, a);
    }

    function withdraw(uint256 u, uint256 frac) external {
        address a = users[u % 3];
        uint256 amt = vault.maxWithdraw(a) * bound(frac, 1, 100) / 100; // ERC-4626: up to maxWithdraw must never revert
        if (amt == 0) return;
        vm.prank(a); vault.withdraw(amt, a, a);
    }

    function redeemInKind(uint256 u, uint256 frac) external {
        address a = users[u % 3];
        uint256 s = vault.balanceOf(a) * bound(frac, 1, 100) / 100;
        if (s == 0) return;
        vm.prank(a); vault.redeemInKind(s, a, a);
    }

    /// Manager trade. `hostile` sends the output to the manager instead of the vault.
    function trade(uint256 amt, bool buy, bool hostile) external {
        address to = hostile ? manager : address(vault);
        IERC20 tin = buy ? IERC20(address(usdg)) : IERC20(address(nvda));
        uint256 bal = tin.balanceOf(address(vault));
        if (bal == 0) return;
        amt = bound(amt, 1, bal);
        uint256 mU = usdg.balanceOf(manager);
        uint256 mN = nvda.balanceOf(manager);
        bytes memory data = abi.encodeCall(MockRouter.swap, (address(tin), buy ? address(nvda) : address(usdg), amt, to));
        if (!_exec(address(router), data)) return;
        if (hostile) {
            // follow the vault's own 24h loss window
            if (vault.lossWindowStart() != stealWindow) { stealWindow = vault.lossWindowStart(); stolenInWindow = 0; windowNav = vault.lossWindowNav(); }
            hostileOk += 1;
            stolenInWindow += (usdg.balanceOf(manager) - mU) + vault.valueOf(address(nvda), nvda.balanceOf(manager) - mN);
        }
    }

    function movePrice(int256 bps) external {
        bps = bound(bps, -500, 500);
        price = uint256(int256(price) * (10_000 + bps) / 10_000);
        if (price < 1e8) price = 1e8;
        feed.set(int256(price), block.timestamp);
        _syncRouter();
    }

    function harvest() external { vault.harvest(); }

    function warp(uint32 dt) external {
        vm.warp(block.timestamp + bound(dt, 1, 2 days));
        feed.set(int256(price), block.timestamp);
    }

    function user(uint256 i) external view returns (address) { return users[i]; }
}

contract VaultInvariantTest is Test {
    HeimdallVault vault;
    MockERC20 usdg;
    MockERC20 nvda;
    MockFeed feed;
    MockRouter router;
    VaultHandler h;
    address fees = address(0xFEE);

    function setUp() public {
        usdg = new MockERC20("Global Dollar", "USDG", 6);
        nvda = new MockERC20("NVIDIA", "NVDA", 18);
        feed = new MockFeed(8, 100e8);
        router = new MockRouter();
        router.setRate(address(usdg), address(nvda), 1e28);
        router.setRate(address(nvda), address(usdg), 1e8);
        HeimdallVault.CallPerm[] memory calls = new HeimdallVault.CallPerm[](1);
        calls[0] = HeimdallVault.CallPerm(address(router), MockRouter.swap.selector);
        address[] memory spenders = new address[](1);
        spenders[0] = address(router);
        HeimdallVault.AssetInit[] memory assets = new HeimdallVault.AssetInit[](1);
        assets[0] = HeimdallVault.AssetInit(address(nvda), address(feed), 7 days);
        vault = new HeimdallVault(HeimdallVault.InitConfig({
            baseAsset: IERC20(address(usdg)), name: "Inv", symbol: "hINV", owner: address(this), manager: address(0xBEEF),
            feeRecipient: fees, shieldSigner: vm.addr(0xA11CE), guardian: address(0), maxTradeBps: 2500, maxLossBps: 300, maxDailyLossBps: 500,
            depositCap: type(uint256).max, heimToken: address(0), holderMin: 0, calls: calls, spenders: spenders, assets: assets
        }));
        h = new VaultHandler(vault, usdg, nvda, feed, router);
        targetContract(address(h));
    }

    /// Shares never claim more than the vault holds.
    function invariant_sharesBacked() public view {
        assertLe(vault.convertToAssets(vault.totalSupply()), vault.totalAssets());
    }

    /// A compromised manager (even with Shield approving everything) extracts at most the daily loss limit
    /// of the NAV at the start of the window, plus rounding.
    function invariant_theftBoundedByDailyLimit() public view {
        uint256 nav = h.windowNav();
        assertLe(h.stolenInWindow(), nav * 500 / 10_000 + 2);
    }

    /// Every holder can always leave in kind, and gets something whenever their shares are worth something.
    function invariant_everyoneCanExit() public {
        uint256 snap = vm.snapshotState();
        for (uint256 i; i < 3; ++i) {
            address a = h.user(i);
            uint256 s = vault.balanceOf(a);
            if (s == 0) continue;
            uint256 worth = vault.convertToAssets(s);
            uint256 u0 = usdg.balanceOf(a);
            uint256 n0 = nvda.balanceOf(a);
            vm.prank(a);
            vault.redeemInKind(s, a, a);
            assertEq(vault.balanceOf(a), 0);
            if (worth > 1) assertTrue(usdg.balanceOf(a) > u0 || nvda.balanceOf(a) > n0, "exit paid nothing");
        }
        vm.revertToState(snap);
    }
}
