// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 * @title HashRegistry
 * @dev A simple contract to record and verify file hashes for proof of existence.
 */
contract HashRegistry {
    // Mapping from hash to the timestamp it was recorded
    mapping(bytes32 => uint256) public registry;

    // Event emitted when a new hash is recorded
    event HashRecorded(bytes32 indexed hash, address indexed recorder, uint256 timestamp);

    /**
     * @dev Records a hash in the registry.
     * @param _hash The SHA-256 hash to record.
     */
    function recordHash(bytes32 _hash) public {
        // Ensure the hash hasn't been recorded before to maintain first-proof integrity
        require(registry[_hash] == 0, "Hash already recorded");
        
        registry[_hash] = block.timestamp;
        
        emit HashRecorded(_hash, msg.sender, block.timestamp);
    }

    /**
     * @dev Verifies if a hash exists and returns its recording timestamp.
     * @param _hash The hash to check.
     * @return The timestamp when the hash was recorded (0 if not found).
     */
    function verifyHash(bytes32 _hash) public view returns (uint256) {
        return registry[_hash];
    }
}
