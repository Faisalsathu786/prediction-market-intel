// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title  PredictionMarket
 * @notice Decentralized prediction market on Arc Testnet.
 *         Users bet USDC (Arc native token) on YES/NO outcomes.
 *         Creator resolves the market; winners claim proportional share.
 *
 * Arc Testnet: Chain ID 5042002 | RPC: https://rpc.testnet.arc.network
 * Explorer:    https://testnet.arcscan.app
 */
contract PredictionMarket {

    // ─── Enums ───────────────────────────────────────────────────
    enum MarketState { Open, Closed, Resolved }
    enum Outcome     { None, Yes, No }

    // ─── Structs ─────────────────────────────────────────────────
    struct Market {
        uint256 id;
        address creator;
        string  question;
        string  category;       // "politics" | "crypto" | "sports" | "macro"
        uint256 createdAt;
        uint256 deadline;       // betting closes at this timestamp
        MarketState state;
        Outcome     result;
        uint256 yesPool;        // total USDC on YES (wei units)
        uint256 noPool;         // total USDC on NO  (wei units)
        uint256 creatorFee;     // basis points (e.g. 200 = 2%)
    }

    struct Position {
        uint256 yesAmount;
        uint256 noAmount;
        bool    claimed;
    }

    // ─── State ───────────────────────────────────────────────────
    uint256 public marketCount;
    uint256 public constant PROTOCOL_FEE_BPS = 100; // 1% protocol fee
    address public owner;
    uint256 public protocolFees; // accumulated protocol fees

    mapping(uint256 => Market)                          public markets;
    mapping(uint256 => mapping(address => Position))    public positions;
    mapping(uint256 => address[])                       private betters;

    // ─── Events ──────────────────────────────────────────────────
    event MarketCreated(
        uint256 indexed marketId,
        address indexed creator,
        string  question,
        string  category,
        uint256 deadline
    );
    event BetPlaced(
        uint256 indexed marketId,
        address indexed better,
        Outcome outcome,
        uint256 amount
    );
    event MarketResolved(
        uint256 indexed marketId,
        Outcome result,
        uint256 yesPool,
        uint256 noPool
    );
    event WinningsClaimed(
        uint256 indexed marketId,
        address indexed better,
        uint256 amount
    );
    event MarketClosed(uint256 indexed marketId);

    // ─── Errors ──────────────────────────────────────────────────
    error NotOwner();
    error NotCreator();
    error MarketNotOpen();
    error MarketNotClosed();
    error MarketNotResolved();
    error DeadlinePassed();
    error DeadlineNotPassed();
    error InvalidOutcome();
    error AlreadyClaimed();
    error ZeroBet();
    error InvalidFee();
    error InvalidDeadline();
    error NoWinnings();

    // ─── Modifiers ───────────────────────────────────────────────
    modifier onlyOwner()   { if (msg.sender != owner) revert NotOwner(); _; }

    modifier marketExists(uint256 id) {
        require(id > 0 && id <= marketCount, "Market does not exist");
        _;
    }

    // ─── Constructor ─────────────────────────────────────────────
    constructor() {
        owner = msg.sender;
    }

    // ─── Create Market ───────────────────────────────────────────
    /**
     * @notice Create a new prediction market.
     * @param question   Human-readable question e.g. "Will BTC hit $100K before July 2025?"
     * @param category   Category tag: politics | crypto | sports | macro
     * @param deadline   Unix timestamp when betting closes
     * @param creatorFee Basis points for creator reward (max 500 = 5%)
     */
    function createMarket(
        string calldata question,
        string calldata category,
        uint256 deadline,
        uint256 creatorFee
    ) external returns (uint256 marketId) {
        if (deadline <= block.timestamp)      revert InvalidDeadline();
        if (creatorFee > 500)                 revert InvalidFee();

        marketCount++;
        marketId = marketCount;

        markets[marketId] = Market({
            id:         marketId,
            creator:    msg.sender,
            question:   question,
            category:   category,
            createdAt:  block.timestamp,
            deadline:   deadline,
            state:      MarketState.Open,
            result:     Outcome.None,
            yesPool:    0,
            noPool:     0,
            creatorFee: creatorFee
        });

        emit MarketCreated(marketId, msg.sender, question, category, deadline);
    }

    // ─── Place Bet ───────────────────────────────────────────────
    /**
     * @notice Place a bet. Send USDC (native Arc token) with the tx.
     * @param marketId  Target market
     * @param outcome   1 = YES, 2 = NO
     */
    function placeBet(uint256 marketId, Outcome outcome)
        external
        payable
        marketExists(marketId)
    {
        if (msg.value == 0)                              revert ZeroBet();
        if (outcome != Outcome.Yes && outcome != Outcome.No) revert InvalidOutcome();

        Market storage m = markets[marketId];
        if (m.state != MarketState.Open)                 revert MarketNotOpen();
        if (block.timestamp >= m.deadline)               revert DeadlinePassed();

        Position storage pos = positions[marketId][msg.sender];

        // Track unique betters
        if (pos.yesAmount == 0 && pos.noAmount == 0) {
            betters[marketId].push(msg.sender);
        }

        if (outcome == Outcome.Yes) {
            pos.yesAmount += msg.value;
            m.yesPool     += msg.value;
        } else {
            pos.noAmount  += msg.value;
            m.noPool      += msg.value;
        }

        emit BetPlaced(marketId, msg.sender, outcome, msg.value);
    }

    // ─── Close Market ────────────────────────────────────────────
    /**
     * @notice Close betting (can be called by creator after deadline).
     */
    function closeMarket(uint256 marketId)
        external
        marketExists(marketId)
    {
        Market storage m = markets[marketId];
        if (msg.sender != m.creator && msg.sender != owner) revert NotCreator();
        if (m.state != MarketState.Open)  revert MarketNotOpen();
        if (block.timestamp < m.deadline) revert DeadlineNotPassed();

        m.state = MarketState.Closed;
        emit MarketClosed(marketId);
    }

    // ─── Resolve Market ──────────────────────────────────────────
    /**
     * @notice Resolve the market with final outcome.
     *         Only creator or protocol owner can resolve.
     * @param marketId Target market
     * @param result   1 = YES won, 2 = NO won
     */
    function resolveMarket(uint256 marketId, Outcome result)
        external
        marketExists(marketId)
    {
        Market storage m = markets[marketId];
        if (msg.sender != m.creator && msg.sender != owner) revert NotCreator();
        if (m.state == MarketState.Resolved) revert MarketNotClosed();
        if (result != Outcome.Yes && result != Outcome.No)  revert InvalidOutcome();

        m.state  = MarketState.Resolved;
        m.result = result;

        emit MarketResolved(marketId, result, m.yesPool, m.noPool);
    }

    // ─── Claim Winnings ──────────────────────────────────────────
    /**
     * @notice Claim winnings after market is resolved.
     *         Payout = (yourBet / winningPool) * totalPool - fees
     */
    function claimWinnings(uint256 marketId)
        external
        marketExists(marketId)
    {
        Market storage m = markets[marketId];
        if (m.state != MarketState.Resolved) revert MarketNotResolved();

        Position storage pos = positions[marketId][msg.sender];
        if (pos.claimed) revert AlreadyClaimed();

        uint256 winningBet = m.result == Outcome.Yes ? pos.yesAmount : pos.noAmount;
        if (winningBet == 0) revert NoWinnings();

        pos.claimed = true;

        uint256 winningPool = m.result == Outcome.Yes ? m.yesPool : m.noPool;
        uint256 totalPool   = m.yesPool + m.noPool;

        // Gross payout (proportional share of total pool)
        uint256 grossPayout = (winningBet * totalPool) / winningPool;

        // Deduct protocol fee
        uint256 protocolCut = (grossPayout * PROTOCOL_FEE_BPS) / 10_000;
        // Deduct creator fee
        uint256 creatorCut  = (grossPayout * m.creatorFee) / 10_000;

        uint256 netPayout   = grossPayout - protocolCut - creatorCut;

        protocolFees += protocolCut;

        // Pay creator fee
        if (creatorCut > 0) {
            (bool ok,) = m.creator.call{value: creatorCut}("");
            require(ok, "Creator fee transfer failed");
        }

        // Pay winner
        (bool sent,) = msg.sender.call{value: netPayout}("");
        require(sent, "Payout transfer failed");

        emit WinningsClaimed(marketId, msg.sender, netPayout);
    }

    // ─── Withdraw Protocol Fees ──────────────────────────────────
    function withdrawProtocolFees() external onlyOwner {
        uint256 amount = protocolFees;
        protocolFees = 0;
        (bool ok,) = owner.call{value: amount}("");
        require(ok, "Withdraw failed");
    }

    // ─── View Helpers ────────────────────────────────────────────

    /// @notice Get full market info
    function getMarket(uint256 marketId)
        external
        view
        marketExists(marketId)
        returns (Market memory)
    {
        return markets[marketId];
    }

    /// @notice Get user position in a market
    function getPosition(uint256 marketId, address user)
        external
        view
        returns (Position memory)
    {
        return positions[marketId][user];
    }

    /// @notice Get all betters in a market
    function getBetters(uint256 marketId)
        external
        view
        marketExists(marketId)
        returns (address[] memory)
    {
        return betters[marketId];
    }

    /// @notice Get implied probability (YES%) scaled to 10000
    function getImpliedProbability(uint256 marketId)
        external
        view
        marketExists(marketId)
        returns (uint256 yesBps, uint256 noBps)
    {
        Market storage m = markets[marketId];
        uint256 total = m.yesPool + m.noPool;
        if (total == 0) return (5000, 5000); // 50/50 default
        yesBps = (m.yesPool * 10_000) / total;
        noBps  = 10_000 - yesBps;
    }

    /// @notice Get all market IDs (paginated)
    function getMarketIds(uint256 offset, uint256 limit)
        external
        view
        returns (uint256[] memory ids)
    {
        uint256 end = offset + limit;
        if (end > marketCount) end = marketCount;
        ids = new uint256[](end - offset);
        for (uint256 i = offset; i < end; i++) {
            ids[i - offset] = i + 1;
        }
    }

    receive() external payable {}
}
