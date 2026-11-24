// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// Test-only: a token with every owner power Token Check looks for, and a tiny pool to trade it. Used by the Shield
/// test suite through simulation state overrides (code is placed at fixed addresses, never deployed).
contract ScamTokenMock {
    address constant OWNER = 0x00000000000000000000000000000000000000AA;
    address constant POOL = 0x00000000000000000000000000000000000000bb;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(address => bool) public blocked;
    uint256 public totalSupply;
    uint256 public sellTax; // percent
    bool public paused;
    uint256 public bombAt; // slot 6: when non-zero, selling fails from this unix time on (set by the test)
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    function symbol() external pure returns (string memory) { return "SCAM"; }
    function name() external pure returns (string memory) { return "Scam"; }
    function decimals() external pure returns (uint8) { return 18; }
    function owner() external pure returns (address) { return OWNER; }
    modifier onlyOwner() { require(msg.sender == OWNER, "owner"); _; }

    function mint(address to, uint256 a) external onlyOwner { _mint(to, a); }
    function poolMint(address to, uint256 a) external { require(msg.sender == POOL, "pool"); _mint(to, a); }
    function blacklist(address w) external onlyOwner { blocked[w] = true; }
    function pause() external onlyOwner { paused = true; }
    function setSellTax(uint256 t) external onlyOwner { require(t <= 100, "tax"); sellTax = t; }

    function _mint(address to, uint256 a) internal { totalSupply += a; balanceOf[to] += a; emit Transfer(address(0), to, a); }
    function approve(address s, uint256 a) external returns (bool) { allowance[msg.sender][s] = a; emit Approval(msg.sender, s, a); return true; }
    function transfer(address to, uint256 a) external returns (bool) { _move(msg.sender, to, a); return true; }
    function transferFrom(address f, address to, uint256 a) external returns (bool) {
        if (allowance[f][msg.sender] != type(uint256).max) allowance[f][msg.sender] -= a;
        _move(f, to, a); return true;
    }
    function _move(address f, address to, uint256 a) internal {
        require(!paused, "paused");
        require(!blocked[f], "blocked");
        if (to == POOL && bombAt != 0) require(block.timestamp < bombAt, "closed");
        uint256 fee = to == POOL ? a * sellTax / 100 : 0;
        balanceOf[f] -= a;
        balanceOf[to] += a - fee;
        emit Transfer(f, to, a - fee);
        if (fee > 0) { balanceOf[OWNER] += fee; emit Transfer(f, OWNER, fee); }
    }
}

contract ScamPoolMock {
    ScamTokenMock constant TOKEN = ScamTokenMock(0x00000000000000000000000000000000000000cc);
    function buy() external payable { TOKEN.poolMint(msg.sender, msg.value * 1000); }
    function sell(uint256 a) external {
        uint256 before = TOKEN.balanceOf(address(this));
        TOKEN.transferFrom(msg.sender, address(this), a);
        uint256 got = TOKEN.balanceOf(address(this)) - before;
        payable(msg.sender).transfer(got / 1000);
    }
    receive() external payable {}
}
