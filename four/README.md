# Four.meme CZ/HeYi Tweet Monitor

这个文件夹是独立实现，不会改 `flap.js`。

逻辑：

1. 只接收 `@cz_binance`、`@heyibinance` 的新动态信号。
2. 监听 Four.meme TokenManager 链上日志发现新 token，检查 token 的 Twitter/X 信息是否引用同一条动态。
3. 如果是刚创建的新币，按 flap 风格过滤：创建时间、市值、BNB 池、等待外部买入确认。
4. 满足条件后买入；默认 `DRY_RUN=true` 只打印，不发交易。
5. 买入后按 `TAKE_PROFIT_MULTIPLE` 监控，达到倍数卖一半。

## 配置

复制配置：

```powershell
Copy-Item .\four\.env.example .\four\.env
```

至少需要配置一种推特来源：

- `GMGN_X_API_URL`：推荐。打开 GMGN 的 X Tracker，在浏览器 DevTools 的 Network 里找到返回 X Tracker 列表 JSON 的请求，把完整 URL 填进来；如果该请求需要登录态，再把 `GMGN_COOKIE` 填上。
- `TWITTER_BEARER_TOKEN`：使用 X 官方 API。
- `TWEET_FILE`：测试用，每行一个 JSON，例如：

```json
{"username":"cz_binance","id":"1234567890123456789","url":"https://x.com/cz_binance/status/1234567890123456789","text":"test"}
```

默认不依赖 Four.meme 列表接口；`FOUR_LIST_URLS` 只作为可选补充。如果 Four.meme 新增了新版 TokenManager，把地址加到 `FOUR_TOKEN_MANAGERS`，多个地址用英文逗号分隔。

## 运行

在项目根目录运行：

```powershell
node .\four\index.js
```

真买前把 `four/.env` 里的 `DRY_RUN=false`，并配置 `PRIVATE_KEY`。建议先用 `DRY_RUN=true` 跑一段时间确认匹配和过滤日志。

## 参考

- Four.meme TokenManager2: `0x5c952063c7fc8610FFDB798152D69F0B9550762b`
- Four.meme Helper3: `0xF251F83e40a78868FcfA3FA4599Dad6494E46034`
- 买入方法：`buyTokenAMAP(uint256 origin,address token,uint256 funds,uint256 minAmount)`
