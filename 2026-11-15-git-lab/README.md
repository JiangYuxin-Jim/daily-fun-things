# Git 演播室 · git-lab — Day 17

> 敲命令，看分支图长出来。

## 解决什么问题

学 Git 最难的地方不是记命令，而是**脑子里没有那张图**：
`merge` 到底是快进还是三方合并？切分支后提交跑到哪去了？冲突是怎么冒出来的？

这个工具让你在浏览器里敲真实的 Git 命令，右侧的提交 DAG 实时重绘，左边 5 个关卡带你从
「第一颗提交」一路走到「冲突现场」。不用装 Git、不用怕搞坏仓库。

## 怎么玩

直接双击 `index.html`（或 `python3 -m http.server` 起个静态服务）即可，零依赖零联网。

```
git init
git add app.js
git commit -m "初始化"
git branch dev
git switch dev
git add feature.js
git commit -m "加功能"
git switch main
git merge dev          ← 快进合并，main 直接跳到 dev
```

### 5 个关卡

| # | 关卡 | 学什么 |
|---|---|---|
| 1 | 第一颗提交 | init / add / commit / branch |
| 2 | 分岔路口 | 切分支后各自前进 |
| 3 | 快进合并 | fast-forward：不产生新提交 |
| 4 | 真正的分叉 | 两个分支都有新提交 → 三方合并提交（两个父） |
| 5 | 冲突现场 | 两端改同一文件 → merge 中止 → 解决后 `merge --continue` |

- 每关有「填入本关参考命令」按钮，一键跑完看效果
- 「撤销上一步」最多回退 50 步
- 命令里出现的提交哈希是 7 位十六进制短哈希，和真 Git 一样

## 实现要点

- **`engine.js` 是纯函数 Git 模型**，不碰 DOM，可直接 `require` 进 Node 测试：
  - 提交存成「相对父提交的增量」，`treeOf()` 沿父链合并出完整快照
  - `mergeBase()` 用祖先集合 + BFS 求最低公共祖先
  - 三方合并的真三路判定：`o===t` 取任一 / `o===b` 取 theirs / `t===b` 取 ours / 否则冲突
  - `add` 会把文件内容版本号推进一版——这样两边都改同一文件时才会**真的撞出冲突**（这是最容易被糊弄掉的一点）
- **布局算法**：按拓扑序访问提交，单父提交继承父所在列，多父取第一父的列；每条 lane 独立计 y，避免节点重叠
- 合并提交用琥珀色双环渲染，HEAD 用虚线光环，分支标签贴在提交上方
- 终端支持 ↑ 复用上一条命令、命令胶囊一键填入

## 已知限制

- 不模拟工作区/暂存区分离的三态（简化成「index = 已 add 的内容」），因此没有 `git diff`、部分暂存（`add -p`）
- 不支持 rebase / reset / stash / cherry-pick / remote
- 冲突解决在模拟里简化为「清掉冲突即可 `merge --continue`」，不提供编辑冲突文件的界面
- 关卡 4/5 没有严格校验历史形状，只要出现双父提交就算通过（放宽了判定）

## 实测验证

- `node --check engine.js` / `node --check test.js` 通过
- `node test.js`：**24 项断言全绿**（线性历史、空提交拦截、快进合并、三方合并、合并基、布局无重叠、关卡判定、非法命令兜底）
- `index.html` 内联脚本 `node --check` 通过；`python3 -m http.server 8951` 探测 `GET /index.html` 返回 **200**
- 手动走查关卡 1→3 参考命令链路，分支图渲染正常
