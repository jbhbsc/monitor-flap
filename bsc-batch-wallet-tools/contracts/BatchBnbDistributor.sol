// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
}

contract BatchBnbDistributor {
    address public owner;

    error LengthMismatch();
    error EmptyRecipients();
    error TotalMismatch();
    error NotOwner();
    error BadReceiver();
    error TransferFailed(uint256 index, address recipient, uint256 amount);
    error RescueFailed();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    receive() external payable {}

    function distributeBnb(address[] calldata recipients, uint256[] calldata amounts) external payable {
        uint256 length = recipients.length;
        if (length == 0) revert EmptyRecipients();
        if (length != amounts.length) revert LengthMismatch();

        uint256 total;
        for (uint256 i; i < length; ++i) {
            total += amounts[i];
        }
        if (total != msg.value) revert TotalMismatch();

        for (uint256 i; i < length; ++i) {
            (bool ok, ) = recipients[i].call{value: amounts[i]}("");
            if (!ok) revert TransferFailed(i, recipients[i], amounts[i]);
        }
    }

    function distributeToken(address token, address[] calldata recipients, uint256[] calldata amounts) external {
        uint256 length = recipients.length;
        if (length == 0) revert EmptyRecipients();
        if (length != amounts.length) revert LengthMismatch();

        for (uint256 i; i < length; ++i) {
            bool ok = IERC20(token).transferFrom(msg.sender, recipients[i], amounts[i]);
            if (!ok) revert TransferFailed(i, recipients[i], amounts[i]);
        }
    }

    function rescueBNB(address payable to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert BadReceiver();
        uint256 value = amount == 0 ? address(this).balance : amount;
        (bool ok, ) = to.call{value: value}("");
        if (!ok) revert RescueFailed();
    }

    function rescueToken(address token, address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert BadReceiver();
        uint256 value = amount == 0 ? IERC20(token).balanceOf(address(this)) : amount;
        bool ok = IERC20(token).transfer(to, value);
        if (!ok) revert RescueFailed();
    }
}
