# 拳皇 Blaze Arena / qwFlap

这是一个 BSC DAPP 前端原型，文件全部在 `qwFlap/` 下，直接打开 `index.html` 即可预览。

## 文件

- `index.html`：街机对战页面
- `styles.css`：次世代天台、霓虹、角色立绘和响应式布局
- `config.js`：填写你在 flap 平台创建的 `$KOF` 代币合约地址
- `app.js`：钱包连接、BSC 切换、三回合对战、能量/MAX、焚币池模拟
- `contracts/QwFlapArena.sol`：三回合对战合约草案，构造函数接收外部 `$KOF` 地址

## 预览

在浏览器打开：

```text
D:\vs-code\qwFlap\index.html
```

## 上链对接

你会在 flap 平台创建 `$KOF` 代币，所以这里不再生成代币合约。拿到 flap 创建出来的代币地址后，填到 `config.js`：

```js
window.QWFLAP_CONFIG = {
  kofTokenAddress: "0x你的flap代币地址",
  arenaContractAddress: "0x部署后的对战合约地址",
};
```

部署 `QwFlapArena.sol` 时，构造函数的 `token` 参数也填同一个 flap 代币地址。

当前前端的对战结算是本地模拟，方便先确认视觉、流程、参数和文案；真实发起对局、锁仓押注、VRF 判定需要接入合约方法和 Chainlink VRF。

## 角色映射

根据你给的 3x3 图片，DAPP 内使用“参考原型 + 原创替身”的方式：

- 左上 K' → 银焰·K
- 上中 Ash Crimson → 苍袖·Ash
- 右上 Rugal/黑豹 Boss 原型 → 黑狮·卢卡
- 中左 草薙京 → 赤炎·京
- 正中 八神庵 → 紫炎·庵
- 中右 皮衣银发格斗家 → 饿狼·特瑞
- 左下 坂崎由莉 → 极拳·尤莉
- 下中 不知火舞 → 忍姬·舞
- 右下 麻宫雅典娜 → 电神·雅典娜

页面资产是原创 SVG 风格化立绘，没有直接使用图片里的素材。
