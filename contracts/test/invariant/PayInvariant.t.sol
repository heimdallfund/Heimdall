// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/src/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {HeimdallPay} from "../../contracts/HeimdallPay.sol";

/// USDG-like token: the issuer can freeze addresses (transfers to or from them revert).
contract FreezableToken is ERC20 {
    mapping(address => bool) public frozen;
    constructor() ERC20("Global Dollar", "USDG") {}
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address to, uint256 amt) external { _mint(to, amt); }
    function setFrozen(address a, bool f) external { frozen[a] = f; }
    function _update(address from, address to, uint256 v) internal override {
        require(!frozen[from] && !frozen[to], "address frozen");
        super._update(from, to, v);
    }
}

/// Drives HeimdallPay through random sequences of every user action, time jumps and issuer freezes.
contract PayHandler is Test {
    HeimdallPay public pay;
    FreezableToken public usdg;
    address[4] public actors = [address(0x1001), address(0x1002), address(0x1003), address(0x1004)];
    address public fees = address(0xFEE);
    uint256 public ghostIn;   // USDG escrowed by createJob
    uint256 public ghostOut;  // USDG that left the contract (pushes + withdrawOwed)

    constructor(HeimdallPay pay_, FreezableToken usdg_) {
        pay = pay_;
        usdg = usdg_;
        for (uint256 i; i < 4; ++i) {
            usdg.mint(actors[i], 1e15);
            vm.prank(actors[i]);
            usdg.approve(address(pay), type(uint256).max);
        }
    }

    function _actor(uint256 s) internal view returns (address) { return actors[s % 4]; }
    function _job(uint256 s) internal view returns (uint256) { return s % pay.jobCount(); }

    function _track(function() internal f) internal {
        uint256 b = usdg.balanceOf(address(pay));
        f();
        uint256 a = usdg.balanceOf(address(pay));
        if (a > b) ghostIn += a - b; else ghostOut += b - a;
    }

    function createJob(uint256 c, uint256 p, uint256 arb, uint96 amount, uint32 dl, uint32 rw, uint16 af) external {
        address client = _actor(c);
        address provider = _actor(p);
        address arbiter = arb % 5 == 4 ? address(0) : _actor(arb);
        if (provider == client || arbiter == client || arbiter == provider) return;
        if (usdg.frozen(client)) return;
        amount = uint96(bound(amount, 1e6, 1e10));
        uint64 deadline = uint64(block.timestamp + bound(dl, 1, 30 days));
        uint32 review = uint32(bound(rw, 1 hours, 30 days));
        uint16 arbFee = arbiter == address(0) ? 0 : uint16(bound(af, 0, 1000));
        uint256 before = usdg.balanceOf(address(pay));
        vm.prank(client);
        pay.createJob(provider, arbiter, amount, deadline, review, arbFee, bytes32(0));
        ghostIn += usdg.balanceOf(address(pay)) - before;
    }

    function _out(uint256 before) internal { ghostOut += before - usdg.balanceOf(address(pay)); }

    function release(uint256 s) external {
        if (pay.jobCount() == 0) return;
        uint256 id = _job(s);
        HeimdallPay.Job memory j = pay.getJob(id);
        if (j.status != HeimdallPay.Status.Open && j.status != HeimdallPay.Status.Submitted) return;
        uint256 b = usdg.balanceOf(address(pay));
        vm.prank(j.client); pay.release(id);
        _out(b);
    }

    function submit(uint256 s) external {
        if (pay.jobCount() == 0) return;
        uint256 id = _job(s);
        HeimdallPay.Job memory j = pay.getJob(id);
        if (j.status != HeimdallPay.Status.Open || block.timestamp > j.deadline) return;
        vm.prank(j.provider); pay.submit(id, bytes32("r"));
    }

    function dispute(uint256 s) external {
        if (pay.jobCount() == 0) return;
        uint256 id = _job(s);
        HeimdallPay.Job memory j = pay.getJob(id);
        if (j.status != HeimdallPay.Status.Submitted || j.arbiter == address(0) || pay.autoReleasable(id)) return;
        vm.prank(j.client); pay.dispute(id, "x");
    }

    function refund(uint256 s) external {
        if (pay.jobCount() == 0) return;
        uint256 id = _job(s);
        HeimdallPay.Job memory j = pay.getJob(id);
        if (j.status != HeimdallPay.Status.Open || block.timestamp <= j.deadline) return;
        uint256 b = usdg.balanceOf(address(pay));
        pay.refund(id);
        _out(b);
    }

    function cancel(uint256 s) external {
        if (pay.jobCount() == 0) return;
        uint256 id = _job(s);
        HeimdallPay.Job memory j = pay.getJob(id);
        if (j.status != HeimdallPay.Status.Open && j.status != HeimdallPay.Status.Submitted) return;
        uint256 b = usdg.balanceOf(address(pay));
        vm.prank(j.provider); pay.cancel(id);
        _out(b);
    }

    function claim(uint256 s) external {
        if (pay.jobCount() == 0) return;
        uint256 id = _job(s);
        if (!pay.autoReleasable(id)) return;
        uint256 b = usdg.balanceOf(address(pay));
        pay.claim(id);
        _out(b);
    }

    function resolve(uint256 s, uint16 bps) external {
        if (pay.jobCount() == 0) return;
        uint256 id = _job(s);
        HeimdallPay.Job memory j = pay.getJob(id);
        if (j.status != HeimdallPay.Status.Disputed) return;
        uint256 b = usdg.balanceOf(address(pay));
        vm.prank(j.arbiter); pay.resolve(id, uint16(bound(bps, 0, 10_000)));
        _out(b);
    }

    function settleExpired(uint256 s) external {
        if (pay.jobCount() == 0) return;
        uint256 id = _job(s);
        HeimdallPay.Job memory j = pay.getJob(id);
        if (j.status != HeimdallPay.Status.Disputed || block.timestamp < uint256(j.disputedAt) + pay.DISPUTE_TIMEOUT()) return;
        uint256 b = usdg.balanceOf(address(pay));
        pay.settleExpiredDispute(id);
        _out(b);
    }

    function withdrawOwed(uint256 a) external {
        address who = a % 5 == 4 ? fees : _actor(a);
        if (pay.owed(who) == 0 || usdg.frozen(who)) return;
        uint256 b = usdg.balanceOf(address(pay));
        vm.prank(who); pay.withdrawOwed();
        _out(b);
    }

    function warp(uint32 dt) external { vm.warp(block.timestamp + bound(dt, 1, 20 days)); }

    function toggleFreeze(uint256 a) external {
        address who = a % 5 == 4 ? fees : _actor(a);
        usdg.setFrozen(who, !usdg.frozen(who));
    }

    function allActors() external view returns (address[5] memory r) {
        for (uint256 i; i < 4; ++i) r[i] = actors[i];
        r[4] = fees;
    }
}

contract PayInvariantTest is Test {
    HeimdallPay pay;
    FreezableToken usdg;
    PayHandler h;

    function setUp() public {
        usdg = new FreezableToken();
        pay = new HeimdallPay(usdg, address(this), address(0xFEE));
        h = new PayHandler(pay, usdg);
        targetContract(address(h));
    }

    /// Escrow is always fully backed: open, submitted and disputed jobs plus deferred payouts equal the balance.
    function invariant_escrowBacked() public view {
        uint256 live;
        uint256 n = pay.jobCount();
        for (uint256 i; i < n; ++i) {
            HeimdallPay.Job memory j = pay.getJob(i);
            if (j.status == HeimdallPay.Status.Open || j.status == HeimdallPay.Status.Submitted || j.status == HeimdallPay.Status.Disputed) live += j.amount;
        }
        assertEq(usdg.balanceOf(address(pay)), live + pay.totalOwed());
    }

    /// totalOwed is exactly the sum of every individual IOU.
    function invariant_owedSums() public view {
        address[5] memory a = h.allActors();
        uint256 sum;
        for (uint256 i; i < 5; ++i) sum += pay.owed(a[i]);
        assertEq(sum, pay.totalOwed());
    }

    /// Nothing is created or lost: in - out == balance.
    function invariant_conservation() public view {
        assertEq(h.ghostIn() - h.ghostOut(), usdg.balanceOf(address(pay)));
    }
}
