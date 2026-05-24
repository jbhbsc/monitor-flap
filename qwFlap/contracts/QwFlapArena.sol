// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract QwFlapArena is Ownable, ReentrancyGuard {
    using SafeERC20 for ERC20Burnable;

    enum Character {
        Akayan,
        Shien,
        TerryWolf,
        LeonaVolt,
        MaiTrap
    }

    enum Burst {
        Normal,
        Super,
        Max
    }

    struct PlayerRound {
        Character character;
        Burst burst;
        bool committed;
        bool won;
    }

    struct MatchData {
        address p1;
        address p2;
        uint256 stake;
        uint8 round;
        uint8 p1Wins;
        uint8 p2Wins;
        bool settled;
        mapping(uint8 => mapping(address => PlayerRound)) rounds;
    }

    ERC20Burnable public immutable kof;
    uint256 public nextMatchId = 1;
    uint256 public globalBurned;
    uint256 public bonusPool;
    mapping(uint256 => MatchData) private matches;
    mapping(address => uint256) public energy;

    event MatchCreated(uint256 indexed matchId, address indexed p1, address indexed p2, uint256 stake);
    event RoundCommitted(uint256 indexed matchId, uint8 indexed round, address indexed player);
    event RoundResolved(uint256 indexed matchId, uint8 indexed round, address winner, uint256 burned, uint256 poolAdded);
    event MatchSettled(uint256 indexed matchId, address winner, uint256 prize);

    // token 填你在 flap 平台创建出来的 $KOF 合约地址。
    constructor(address token, address owner) Ownable(owner) {
        kof = ERC20Burnable(token);
    }

    function createMatch(address opponent, uint256 stake) external nonReentrant returns (uint256 matchId) {
        require(opponent != address(0) && opponent != msg.sender, "bad opponent");
        require(stake >= 10 ether, "stake too low");

        matchId = nextMatchId++;
        MatchData storage m = matches[matchId];
        m.p1 = msg.sender;
        m.p2 = opponent;
        m.stake = stake;
        m.round = 1;

        kof.safeTransferFrom(msg.sender, address(this), stake * 3);
        kof.safeTransferFrom(opponent, address(this), stake * 3);
        emit MatchCreated(matchId, msg.sender, opponent, stake);
    }

    function commitRound(uint256 matchId, Character character, Burst burst) external {
        MatchData storage m = matches[matchId];
        require(!m.settled, "settled");
        require(msg.sender == m.p1 || msg.sender == m.p2, "not player");
        require(burst != Burst.Super || energy[msg.sender] >= 50, "need 50 energy");
        require(burst != Burst.Max || energy[msg.sender] >= 100, "need 100 energy");

        m.rounds[m.round][msg.sender] = PlayerRound({
            character: character,
            burst: burst,
            committed: true,
            won: false
        });
        emit RoundCommitted(matchId, m.round, msg.sender);
    }

    function resolveRound(uint256 matchId, uint256 vrfWord) external onlyOwner nonReentrant {
        MatchData storage m = matches[matchId];
        require(!m.settled, "settled");
        PlayerRound storage a = m.rounds[m.round][m.p1];
        PlayerRound storage b = m.rounds[m.round][m.p2];
        require(a.committed && b.committed, "not committed");

        uint256 p1Weight = 50;
        if (_counters(a.character, b.character)) p1Weight += 15;
        if (_counters(b.character, a.character)) p1Weight -= 15;
        if (a.burst == Burst.Super) p1Weight += 7;
        if (a.burst == Burst.Max) p1Weight += 12;
        if (b.burst == Burst.Super) p1Weight -= 7;
        if (b.burst == Burst.Max) p1Weight -= 12;

        bool p1Won = (vrfWord % 100) < p1Weight;
        address winner = p1Won ? m.p1 : m.p2;
        address loser = p1Won ? m.p2 : m.p1;
        Burst winnerBurst = p1Won ? a.burst : b.burst;

        uint256 burnRate = winnerBurst == Burst.Max ? 80 : winnerBurst == Burst.Super ? 60 : 40;
        uint256 burned = (m.stake * burnRate) / 100;
        uint256 poolAdded = (m.stake * 30) / 100;
        uint256 winnerPrize = (m.stake * 170) / 100;
        if (winnerBurst == Burst.Max) winnerPrize += (m.stake * 10) / 100;

        kof.burn(burned);
        globalBurned += burned;
        bonusPool += poolAdded;
        kof.safeTransfer(winner, winnerPrize);

        energy[m.p1] += 10;
        energy[m.p2] += 10;
        if (winnerBurst == Burst.Super) energy[winner] -= 50;
        if (winnerBurst == Burst.Max) energy[winner] -= 100;

        if (p1Won) m.p1Wins += 1;
        else m.p2Wins += 1;

        emit RoundResolved(matchId, m.round, winner, burned, poolAdded);
        if (m.round == 3) {
            _settle(matchId, loser);
        } else {
            m.round += 1;
        }
    }

    function _settle(uint256 matchId, address fallbackWinner) private {
        MatchData storage m = matches[matchId];
        m.settled = true;
        address winner = m.p1Wins == m.p2Wins ? fallbackWinner : m.p1Wins > m.p2Wins ? m.p1 : m.p2;
        uint256 poolBonus = bonusPool / 100;
        if (poolBonus > 0) {
            bonusPool -= poolBonus;
            kof.safeTransfer(winner, poolBonus);
        }
        emit MatchSettled(matchId, winner, poolBonus);
    }

    function _counters(Character a, Character b) private pure returns (bool) {
        return
            (a == Character.Akayan && b == Character.Shien) ||
            (a == Character.Shien && b == Character.TerryWolf) ||
            (a == Character.TerryWolf && b == Character.Akayan) ||
            (a == Character.LeonaVolt && b == Character.MaiTrap) ||
            (a == Character.MaiTrap && b == Character.Shien);
    }
}
