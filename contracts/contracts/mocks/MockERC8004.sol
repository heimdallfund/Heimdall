// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";

/// @notice Minimal ERC-8004 Identity Registry for tests (same function names and signatures as the official one).
contract MockIdentityRegistry is ERC721 {
    uint256 public next;
    mapping(uint256 => string) internal _uri;
    mapping(uint256 => address) internal _wallet;
    event Registered(uint256 indexed agentId, string agentURI, address indexed owner);

    constructor() ERC721("AgentIdentity", "AGENT") {}

    function register(string calldata agentURI) external returns (uint256 agentId) {
        agentId = next++;
        _mint(msg.sender, agentId);
        _uri[agentId] = agentURI;
        _wallet[agentId] = msg.sender;
        emit Registered(agentId, agentURI, msg.sender);
    }
    function tokenURI(uint256 agentId) public view override returns (string memory) { _requireOwned(agentId); return _uri[agentId]; }
    function getAgentWallet(uint256 agentId) external view returns (address) { return _wallet[agentId]; }
}

/// @notice Minimal ERC-8004 Reputation Registry for tests: giveFeedback / getSummary with the official signatures.
contract MockReputationRegistry {
    struct Fb { address client; int128 value; uint8 decimals; string tag1; bool revoked; }
    MockIdentityRegistry public immutable identity;
    mapping(uint256 => Fb[]) internal _fb;
    event NewFeedback(uint256 indexed agentId, address indexed clientAddress, uint64 feedbackIndex, int128 value, uint8 valueDecimals, string indexed indexedTag1, string tag1, string tag2, string endpoint, string feedbackURI, bytes32 feedbackHash);

    constructor(MockIdentityRegistry id) { identity = id; }

    function giveFeedback(uint256 agentId, int128 value, uint8 valueDecimals, string calldata tag1, string calldata tag2, string calldata endpoint, string calldata feedbackURI, bytes32 feedbackHash) external {
        require(identity.ownerOf(agentId) != msg.sender, "self-feedback");
        _fb[agentId].push(Fb(msg.sender, value, valueDecimals, tag1, false));
        emit NewFeedback(agentId, msg.sender, uint64(_fb[agentId].length), value, valueDecimals, tag1, tag1, tag2, endpoint, feedbackURI, feedbackHash);
    }

    function getSummary(uint256 agentId, address[] calldata clients, string calldata tag1, string calldata) external view returns (uint64 count, int128 summaryValue, uint8 summaryValueDecimals) {
        require(clients.length > 0, "clients required");
        int256 total;
        Fb[] storage f = _fb[agentId];
        for (uint256 i; i < f.length; ++i) {
            bool fromClient;
            for (uint256 j; j < clients.length; ++j) if (f[i].client == clients[j]) fromClient = true;
            if (!fromClient || f[i].revoked) continue;
            if (bytes(tag1).length != 0 && keccak256(bytes(tag1)) != keccak256(bytes(f[i].tag1))) continue;
            total += f[i].value;
            count++;
        }
        if (count > 0) summaryValue = int128(total / int256(uint256(count)));
    }
}
