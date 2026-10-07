# @ghgjkbf/dsh-tank-game

Tank Trouble 风格的 DSH 全局面板小游戏插件：P1 玩家（鼠标转向、左键前进/右键后退、Space 开火、中键布雷）对 N 台 AI。移植自 [kneasle/tank-trouble](https://github.com/kneasle/tank-trouble) 的弹道/迷宫/运动语义。

## 安装

```bash
dsh plugin --profile <你的profile> add file:<本仓库克隆路径>
# 或打包后：
npm pack && dsh plugin --profile <你的profile> add ./dsh-tank-game-*.tgz
```

安装后重启 DSH，侧边栏出现"坦克大战"入口。

## 开发与验收

```bash
npm run verify   # sim 逻辑断言 + bundle 标记审查 + playwright 渲染证据
```

---
Tank Trouble 风格俯视迷宫坦克对战，作为 DSH 的等待解闷小游戏。基于开源
[kneasle/tank-trouble](https://github.com/kneasle/tank-trouble) 的核心语义重建：
单位制、弹道、迷宫生成直接移植自该项目（`maze_gen.py` / `wall.py` / `collisions.js` /
`projectiles.js`），AI 与单机化改造为本插件新增。

## 控制（锁定）

| 输入 | 动作 |
| --- | --- |
| 鼠标移动 | 车体朝向（炮管焊死在车体上，瞄准即转向） |
| 左键 | 前进 |
| 右键 | 后退 |
| Space | 开火 |
| 中键 | 布雷 |
| P / Pause 按钮 | 暂停 / 继续 |

## 面板功能

- **AI 数量**：顶栏下拉 1–8，切换即重开新局。
- **暂停**：P 键或顶栏 Pause 按钮；暂停时世界冻结、画面保留。
- **返回对话**：顶栏右上按钮退出面板，回到对话主区。
- **胜负**：玩家死亡立即结束（无论剩几台 AI）；全歼 AI 即获胜；点击画面重开。
- **公平出生**：玩家与每台 AI 的切比雪夫距离 ≥ 4 格，杜绝贴脸秒杀。

## 原版语义（照抄开源版）

- **单位 = 格**：墙厚 0.1、坦克 0.42×0.32、子弹半径 0.05、弹速 2.2 格/s、弹寿 10s、
  转速 5 rad/s、车速 2 格/s、同屏自家弹上限 5——全部与参考实现一致。
- **迷宫**：Prim 最小生成树 + density 打洞（10×7 左右，随 AI 数量偏置），外加边框，
  合并为横平竖直的墙矩形（`wall.py` 公式）。验收：连通性 100%。
- **子弹 = 预计算折线**：出膛时用 `bouncingRaycast`（膨胀墙边界线段反射）一次性算出
  整条飞行路径，之后按时间插值取位置。**物理上不可能穿墙或被吞**——弹道就是几何折线。
  命中判定照抄参考版：逆变换到车体局部系，|x| ≤ L/2+r 且 |y| ≤ W/2+r。
  弹可以弹回来打死自己（原版规则）；弹与弹相遇互相抵消。
- **坦克运动**：原版积分 `r += angV*dt*5; x += fwdV*dt*2*cos(r)`。单机版补了圆滑行碰撞
  （车外接圆 vs 墙 AABB 推出）与车-车互推——参考版是联机权威架构没有墙碰撞，单机必须有。
- **火力节奏**：玩家 0.45s 一发（同屏 5 发上限），AI 按爆发窗（2.5s 间隔 0.8s 窗）。

## AI（三件套，无补丁堆）

1. **视线通**：直接朝玩家转（误差 < 0.12 rad 才开火），距离 2.2 格外推进、1.1 格内倒车拉开。
2. **反弹瞄准（bank-shot）**：视线不通时用与实弹完全相同的 `bulletPath` 探测 16+1 个方向，
   折线离玩家 < 0.45 格即为有效发射角——探测即真实弹道，零漂移。
3. **盲猎**：对迷宫格子图 BFS，朝"玩家最后目击格"（3s 内）或随机巡逻格走；
   1.2s 位移不足 0.05 格则倒车 0.6s 重寻路。卡住就倒车，就这么简单。

## 地雷

中键布雷，1.5s 武装，触碰半径 0.45 引爆，爆炸半径 0.8 内所有坦克阵亡，12s 自消。

## 面板接入

标准 DSH 全局面板契约：`sidebar.panellist`（侧栏图标）+ `main`（key 同名）。
无构建步骤，`lib/client.js` 手写直发；host 半（`lib/index.js`）只挂健康检查路由。

## 验收

```bash
npm run verify    # = sim + verify:bundle + render:proof
```

- `tools/sim-accept.mjs`：无头验收——迷宫连通、弹道折线不越界、12 个种子 30s 内
  坦克永不穿墙、AI 巡猎移动率、AI 战斗能终结回合（18/30 in 45s）、单步性能。
- `tools/verify-bundle.mjs`：14 个关键标记在位、6 个旧架构残留标记不在位。
- `tools/render-check.mjs`：headless Chrome 真实挂载面板，canvas 像素采样验证墙与坦克已绘制、无页面错误。

## 卸载

在 DSH 配置的 bundles 列表移除 `@ghgjkbf/dsh-tank-game` 并重启。