// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

/// @title Event Fixture
/// @notice Test fixture only — emits a spread of indexed-event shapes for the
/// ethereum-radio indexer's integration tests, including indexed dynamic
/// types (string/bytes), whose topics are keccak256(value) rather than the
/// raw value, unlike indexed value types.
contract EventFixture {
	event ValueLogged(
		address indexed sender,
		uint256 indexed value,
		uint256 timestamp
	);
	event NamedLogged(address indexed sender, string indexed name, string data);
	event DataLogged(
		address indexed sender,
		bytes indexed payloadHash,
		bytes payload
	);
	event Combo(
		address indexed sender,
		uint256 indexed value,
		string indexed name,
		uint256 timestamp
	);

	function logValue(uint256 value) external {
		emit ValueLogged(msg.sender, value, block.timestamp);
	}

	function logName(string calldata name, string calldata data) external {
		emit NamedLogged(msg.sender, name, data);
	}

	function logData(bytes calldata payload) external {
		emit DataLogged(msg.sender, payload, payload);
	}

	function logCombo(uint256 value, string calldata name) external {
		emit Combo(msg.sender, value, name, block.timestamp);
	}
}
