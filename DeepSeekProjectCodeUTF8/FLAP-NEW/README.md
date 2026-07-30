# FLAP 刮刮乐项目

这是一个链上刮刮乐 DApp，包含 Solidity 合约和静态网页。首页只面向用户参与和查看，不设置后台开奖页面。

## 核心代币

```text
质押/购买彩票代币: 0xe2EEbD01f84437B2fe52f448Ed8318B945b57777
奖池/中奖领取代币: 0xbe9d156892e55e7154bcd3cb0fea677f9d3103e1
```

当前规则是双币模式：

- 用户质押 `0xe2EEbD01f84437B2fe52f448Ed8318B945b57777` 购买彩票。
- 用户每质押 `10000` 枚质押代币获得 `1` 张刮刮乐彩票。
- 质押代币累计到 `500000` 枚后，奖池会把这 `500000` 枚质押代币全部打入黑洞地址。
- `0xe2EEbD01f84437B2fe52f448Ed8318B945b57777` 代币的营销税会产生 `0xbe9d156892e55e7154bcd3cb0fea677f9d3103e1`，营销钱包设置成奖池合约地址后，这部分 `0xbe9d` 会直接进入可派奖励余额。
- 中奖用户领取的是 `0xbe9d156892e55e7154bcd3cb0fea677f9d3103e1`。

## 奖池规则

- 奖池金额实时从链上奖池合约读取，前端会定时刷新展示。
- 奖池来源只来自营销钱包打入的 `0xbe9d156892e55e7154bcd3cb0fea677f9d3103e1`。
- 质押代币累计到 `500000` 枚后，刮刮乐彩票合约会把这批质押代币转入奖池合约，并在同一笔交易里自动调用 `processTokenBalance(0)`。
- 用户刮期开奖调用 `drawRound(roundId)` 时，也会先自动尝试处理奖池里的待处理批次，再计算本轮可派奖励。
- 自动处理成功后，完整批次的质押代币会进入黑洞；奖励池金额不受质押代币处理影响。

注意：普通 ERC20 转账不会自动执行接收方合约逻辑。因此 `0xe2EEbD01f84437B2fe52f448Ed8318B945b57777` 的营销税产生 `0xbe9d156892e55e7154bcd3cb0fea677f9d3103e1` 并进入奖池时，不需要也不会自动卖出；它本身就是中奖领取代币，会直接计入 `rewardBalance()`。

## 刮刮乐规则

- 每轮编号都从 `0001` 开始顺序发放。例如本轮第一个用户质押 `20000` 枚，会获得 `0001`、`0002` 两个编号。
- 每个地址每轮可分多次购买，累计最多 `50` 张。
- 全网每轮总票数不限制，编号会按链上交易顺序连续递增，不会重复。
- 当前测试版每轮 `2` 分钟。
- 不需要凑满 `50` 张才开奖；本轮只要有 `1` 个编号，2 分钟结束后就可以开奖。
- 开奖按本轮全部购买编号随机抽选，抽中的编号对应的用户就是中奖用户。
- 每轮开奖时，中奖者领取奖池合约里当前可派奖励，默认发放 `100%`。

## 公平性说明

- 开奖不是管理员指定中奖地址，也不是后台填中奖编号。
- `drawRound(roundId)` 是公开函数，没有 `onlyOwner` 限制，任何地址都可以在轮次结束后触发开奖交易。
- 触发开奖的人只负责发起交易，不能传入中奖编号、中奖地址或奖励金额。
- 中奖编号由合约在链上根据随机数据计算：`winningTicket = randomValue % totalTickets + 1`。
- 首页不提供后台开奖页面，只展示参与、编号、奖池和历史记录。

注意：当前随机数使用链上 `block.prevrandao`、`blockhash`、时间戳和轮次数据混合生成，适合小额营销活动。高价值奖池建议后续接入 Chainlink VRF 或其他可验证随机源。

## 文件

- `contracts/FlapPrizePool.sol`：外部奖池合约，负责处理质押代币打黑洞和奖励发放，也作为 `0xe2EE` 营销税产出 `0xbe9d` 的接收钱包。
- `contracts/FlapScratchLottery.sol`：刮刮乐彩票、轮次、质押、编号、随机开奖合约。
- `frontend/index.html`：用户首页。
- `frontend/history.html`：历史中奖编号与当轮奖池金额列表。
- `frontend/config.js`：部署后填写合约地址。
- `frontend/app.js`：钱包连接、授权、质押、编号和历史展示。
- `frontend/history.js`：只读历史页面脚本。
- `frontend/styles.css`：页面样式。

## 部署顺序

1. 准备质押/购票代币：

   ```text
   0xe2EEbD01f84437B2fe52f448Ed8318B945b57777
   ```

2. 准备奖池/中奖领取代币：

   ```text
   0xbe9d156892e55e7154bcd3cb0fea677f9d3103e1
   ```

3. 不需要准备 LP 交易对地址。当前规则不再卖出质押代币，质押代币满 `500000` 枚后直接打入黑洞。

4. 部署 `FlapPrizePool`。

   构造参数：

   ```text
   prizeToken_       = 0xe2EEbD01f84437B2fe52f448Ed8318B945b57777
   saleOutputToken_  = 0xbe9d156892e55e7154bcd3cb0fea677f9d3103e1
   wrappedNative_    = 0x0000000000000000000000000000000000000000
   prizeTokenDecimals_ = 18
   ```

   `prizeTokenDecimals_` 用来计算 50 万枚代币的最小单位。Flap 常见代币精度是 `18`，如果你创建代币时设置了其他精度，就填真实精度。

5. 部署 `FlapScratchLottery`。

   构造参数：

   ```text
   stakeToken_       = 0xe2EEbD01f84437B2fe52f448Ed8318B945b57777
   prizePool_        = 第 4 步部署的 FlapPrizePool 地址
   firstRoundStart_  = 0
   ```

6. 在 `FlapPrizePool` 调用：

   ```text
   setLottery(FlapScratchLottery 地址)
   ```


7. 回到 flap 平台，把 `0xe2EEbD01f84437B2fe52f448Ed8318B945b57777` 代币合约的营销钱包改成 `FlapPrizePool` 地址。这个营销税产生并转入奖池的是 `0xbe9d156892e55e7154bcd3cb0fea677f9d3103e1`。

8. 修改 `frontend/config.js`：

   ```js
   tokenAddress: "0xe2EEbD01f84437B2fe52f448Ed8318B945b57777",
   prizePoolAddress: "FlapPrizePool 地址",
   lotteryAddress: "FlapScratchLottery 地址",
   pairAddress: "",
   rewardSymbol: "SPCXB",
   rewardDecimals: 18,
   ```

9. 部署 `frontend` 目录到 Vercel、Netlify、Nginx 或任意静态网页服务。

## 用户操作

- 用户先点网页上的 `连接钱包`。
- 用户点 `授权`，再点 `质押参与`。
- 质押前页面显示预计编号；如果同时有人参与，最终以链上交易确认后的实际编号为准。
- 质押后页面会显示本轮实际获得的编号区间。
- 主页面左侧显示最近中奖编号和中奖地址；完整历史可打开 `frontend/history.html`。

## 链上触发

区块链合约不会自动发起交易，所以轮次结束后需要有地址触发 `drawRound(roundId)`。这不是管理员控制开奖，触发者不能决定中奖结果，只是让合约执行随机抽号。

首页的“刮开奖池号码”就是这个触发入口：上一轮倒计时结束且存在购买编号时，用户刮开涂层会拉起钱包发送 `drawRound(roundId)` 交易；交易确认后，页面再把合约返回的中奖编号刮出来展示。

奖池累计到 `500000` 枚质押代币后，刮刮乐彩票合约会在同一笔购买交易里自动触发 `processTokenBalance(0)`，把完整批次的质押代币直接打入黑洞。用户刮期开奖调用 `drawRound(roundId)` 时也会先尝试处理一次，再计算可派奖励。

不要直接把 `0xe2EEbD01f84437B2fe52f448Ed8318B945b57777` 转入奖池合约；普通 ERC20 直接转账不能自动执行卖出逻辑。自动打黑洞由用户通过刮刮乐彩票合约购买时触发。

如果奖池合约里的质押代币因代币转账限制等原因长期无法打黑洞，可以用 owner 钱包先调用 `setPrizeTokenRescueEnabled(true)` 打开紧急开关，再调用 `rescuePrizeToken(to, amount)` 把卡住的质押代币取出处理。这个开关默认关闭，避免正常情况下误取奖池代币。







