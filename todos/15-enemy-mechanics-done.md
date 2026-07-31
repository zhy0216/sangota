# 15 · 敌人机制与敌人库

## 现状

**4 个敌人**（`src/combat/enemies.ts:3-94`）：黄巾力士、山贼、华雄（精英）、
吕布（Boss）。**6 个遭遇表**（`enemies.ts:97-106`，其中普通 4 / 精英 1 / Boss 1）。

`EnemyMove`（`src/combat/types.ts:64-77`）能表达的行为只有四样：

```ts
damage?: number;  hits?: number;  block?: number;
status?: { status: StatusId; amount: number; to: 'player' | 'self' };
```

意图选择是纯权重随机 + `maxRepeat` 防连续（`engine.ts:110-123`）。

也就是说敌人**不能**：召唤小怪、分裂、逃跑、有被动、按血线改变行为、
按回合数走固定套路、往你牌组塞牌、有护甲成长、有多阶段。

这是当前战斗**变化最少**的部分。同一个敌人打 5 遍完全一样，
和原版每个敌人都有独特机制的体感差距最大。

## 原版行为

约 60 个敌人。机制维度：

| 机制 | 例子 |
|---|---|
| **固定套路** | Hexaghost 的 7 段火焰、Guardian 的形态切换、Champion 的 Anger |
| **被动 power** | Curl Up（首次受击加甲）、Angry（受击 +力量）、Ritual（每回合 +力量）、Thorns |
| **血线触发** | Slime Boss 半血分裂、Guardian 护甲破防切形态、Champion 半血狂暴 |
| **召唤** | Reptomancer 召唤 Dagger、Bronze Automaton 召唤 Orb |
| **分裂** | Slime 死亡/半血时分裂成两个小的 |
| **逃跑** | Looter/Mugger 偷钱后逃走（不算击杀） |
| **牌组污染** | Slaver 塞 Slimed、Byrd 塞 Burn、Time Eater 的 Time Warp |
| **意图不可知** | 首回合意图未知（`?`）、Sleeping（Lagavulin 前 3 回合睡） |
| **护甲策略** | 部分敌人回合开始保留护甲、部分有 Metallicize |
| **多阶段** | Awakened One 死后复活、Donu&Deca 双体协同 |
| **规则改写** | Time Eater（每 12 张牌强制结束回合）、Collector 召唤 + buff |

原版的**遭遇表结构**也比现在复杂：每幕分「弱敌表」（前 3 场）和「强敌表」，
且**不重复同一遭遇**（`Act 1` 的弱敌表按顺序洗，不会连续两场同样的）。

## 设计方案

### 一、机制层扩容（先做）

`EnemyMove` 和 `EnemyDef` 都要扩。核心是引入**敌人被动**和**脚本化意图**。

```ts
export interface EnemyMove {
  id: string; label: string; intent: IntentKind;
  damage?: number; hits?: number; block?: number;
  status?: { status: StatusId; amount: number; to: 'player' | 'self' };
  weight: number; maxRepeat?: number;
  // 新增
  /** 往玩家牌组塞状态牌。 */
  addCards?: { defId: string; count: number; to: 'draw' | 'discard' | 'hand' };
  /** 召唤。slot 会追加到 state.enemies。 */
  summon?: { defId: string; count: number };
  /** 偷金币后逃走。 */
  steal?: number;
  escape?: boolean;
  /** 给全体友方上状态。 */
  statusAll?: { status: StatusId; amount: number };
  /** 直接扣血，无视护甲。 */
  loseHp?: number;
}

export interface EnemyDef {
  id: string; name: string; art: string;
  hp: [min: number, max: number]; height: number;
  moves: EnemyMove[];
  // 新增
  /** 战斗开始就有的被动状态（龟缩/暴怒/反刺/蓄势/重甲…）。 */
  passives?: Partial<Record<StatusId, number>>;
  /**
   * 固定意图脚本。有脚本时忽略 weight 随机。
   * 数组按回合索引取，超出后循环 loopFrom 之后的部分。
   */
  script?: { order: string[]; loopFrom?: number };
  /** 血量降到 percent 以下时触发一次。 */
  onHalfHp?: {
    /** 切换到另一套 moves/script。 */
    phase?: string;
    /** 分裂成 N 个指定敌人，各自继承当前 HP 的一半。 */
    split?: { defId: string; count: number };
    /** 一次性获得状态。 */
    gain?: Partial<Record<StatusId, number>>;
    /** 触发时的台词，显示在敌人头上。 */
    shout?: string;
  };
  /** 首回合意图显示为「？」。 */
  hiddenFirstIntent?: boolean;
  /** 是否是小怪（召唤物）：不计入「全部敌人死亡」的胜利判定？（原版计入，保留 false） */
  minion?: boolean;
}
```

### 二、内容层扩容（后做，量大）

三幕各需要一批敌人。第一幕现有 2 个普通 + 1 精英，缺口如下：

| 幕 | 普通敌人 | 精英 | Boss |
|---|---|---|---|
| 一 · 讨黄巾 | 黄巾力士 ✅、山贼 ✅、**乱民**（弱，群体 3 只）、**黄巾祭酒**（上 debuff）、**黄巾骑手**（多段） | 华雄 ✅、**张曼成**（召唤黄巾力士） | **张梁**（脚本化 5 段）、**张宝**（半血分裂成两个小的）、**管亥**（暴怒 + 高伤） |
| 二 · 战虎牢 | **西凉铁骑**（塞创伤）、**董卓亲兵**（龟缩）、**羌兵**（反刺）、**弓弩手**（远程多段） | **李儒**（塞诅咒 + 重甲）、**吕布亲卫**（双体协同） | 吕布 ✅（现有，升级成三阶段）、**华雄·怒**、**李儒·毒** |
| 三 · 征汉中 | **虎豹骑**（护甲成长）、**连弩兵**（5 段小伤）、**军师**（给友方上蓄势）、**死士**（自爆） | **夏侯渊**（脚本）、**张辽**（半血狂暴 + 逃跑威胁） | **曹操**（召唤 + 多阶段）、**司马懿**（规则改写）、**天命**（终章真 Boss） |

第一批建议只做**第一幕的 3 个新普通 + 1 个新精英 + 3 个 Boss**，
把机制全部验证一遍，再批量做二三幕。

### 三、遭遇表结构

```ts
export interface EncounterTable {
  /** 前 weakCount 场从这里抽，且抽过的不重复直到抽空。 */
  weak: Encounter[];
  weakCount: number;
  strong: Encounter[];
  elite: Encounter[];
}
```

## 实现步骤

1. `types.ts` 按上面扩 `EnemyMove` / `EnemyDef`。
2. `engine.ts`：
   - `makeEnemy`（`engine.ts:86-104`）：应用 `passives` 到 `statuses`
   - `pickIntent`（`engine.ts:110-123`）：有 `script` 时按
     `state.turn` 索引取（注意 `turn` 从 1 开始，`engine.ts:128`），
     否则走现有权重逻辑
   - `executeMove`（`engine.ts:190-206`）：实现 `addCards` / `summon` /
     `steal` / `escape` / `statusAll` / `loseHp`
   - `applyDamage`（`engine.ts:297`）：致死判定**之前**插入 `onHalfHp` 检查
     （半血触发要在这一击结算后立刻生效，而不是等下回合）
   - `escape` 的敌人 `alive = false` 但要标 `escaped = true`，
     `checkEnd`（`engine.ts:335`）不给击杀奖励，且要能触发胜利
     （所有敌人逃走也算赢）
   - `summon` 追加到 `state.enemies` 时 `slot` 用 `enemies.length`，
     `CombatScene` 的布局要能处理运行时新增（现在是启动时按 slot 一次性排布）
3. **半血分裂**（张宝）：新建两个 `EnemyState`，HP 各为父的一半（向上取整），
   父设为 `alive = false` 但不发 `death` 事件（发 `split` 事件让场景播分裂动画）。
4. **敌人被动的显示**：`CombatScene` 敌人头上除了意图，还要显示被动状态图标
   （龟缩、反刺等）。见 [12 状态库](12-status-library-done.md) 的图标工作。
5. `enemies.ts` 的 `ENCOUNTERS`（`enemies.ts:97-106`）搬进
   [09 多幕](09-acts-and-progression.md) 的 `ActDef`，并改成 `EncounterTable` 结构。
6. **弱敌表不重复**：`run.actCombatCount < weakCount` 时从 weak 抽，
   且记录 `run.usedEncounters` 避免连续重复。
7. 美术：每个新敌人一张立绘，走 `genmedia`（`nano-banana-pro` +
   `bria/background/remove`），流程和现有 4 个一样。注意
   README 里那条：**导出高度要按 HiDPI 算**，`EnemyDef.height` 是设计单位
   （现有值 212-322），所以立绘导出至少 2.5 倍于那个数。
   另外 `src/ui/spriteBounds.ts` 的 alpha 边界测量会自动处理去背留白，
   新素材只要保证是干净的 cut-out。
8. 平衡：每加一个敌人就跑 [25 无头模拟](25-headless-sim-and-tests-done.md)，
   目标是普通战 95%+ 胜率、精英 85-95%、Boss 45-70%（参考 README 现有基线）。

## 验收标准

- **龟缩**：董卓亲兵首次被攻击时获得护甲，第二次不再获得
- **暴怒**：管亥每次被攻击 +2 神力，意图数字实时反映（`intentLabel`，`engine.ts:383`）
- **脚本化**：张梁的 5 段套路在 10 次战斗里顺序完全一致，第 6 回合正确循环
- **半血分裂**：张宝在血量跌破 50% 的那一击后立刻分裂成两个，
  HP 各为剩余的一半，且分裂动画播完布局不重叠
- **召唤**：张曼成召唤 2 个黄巾力士，运行时新增的敌人能被点击、能被
  「万人敌」的 `damageAll` 命中、位置不与原有敌人重叠
- **逃跑**：山贼偷 30 金后逃走，不掉落击杀奖励；场上只剩它时逃走后战斗胜利
- **牌组污染**：西凉铁骑往抽牌堆塞 2 张「创伤」，牌堆查看器能看到
- **意图隐藏**：`hiddenFirstIntent` 敌人首回合显示「？」，第二回合起正常
- 敌人被动图标在立绘上方正确显示、悬停有说明
- 同 seed 下所有敌人行为（含脚本、分裂、召唤、逃跑）完全可复现

## 依赖

- [12 状态库](12-status-library-done.md)——被动全部依赖那 18 种状态
- [14 诅咒与状态牌](14-curses-and-status-cards-done.md)——`addCards` 的内容
- [13 关键词](13-card-keywords-done.md)——`addCards` 的底层实现
- [16 意图系统](16-intent-system-done.md)——新意图类型（召唤、逃跑、未知、睡眠）的显示
- [09 多幕](09-acts-and-progression.md)——二三幕敌人的归属
- [25 无头模拟](25-headless-sim-and-tests-done.md)——每个新机制都要能在无头环境跑通

---

## 勘误 · 阶段四（归档后追记）

**上面「精英 85-95% 胜率」这条验收标准已经作废，作废的过程没有被记下来。**

`sim/balance.sim.ts` 的 `BANDS` 在阶段四把 trash 和 elite 从**胜率**改成了
**体力消耗**（`metric: 'cost', lo: 0.4, hi: 0.55`），首领保持胜率不动。
改的理由站得住，写在 `BANDS` 上方的注释里：模拟里玩家满血、单挑、无丹药，
精英胜率被钉死在 99-100%，这条带**任何调参都满足不了**——README 阶段二的
表里华雄就是 100%/100%。所以「精英要多难」这个问题，能回答的数是体力消耗，
不是胜率。

问题不在改指标，在于交接报告把「换了尺子」讲成了「量进带了」，而本条
验收标准随 todos/15 一起归档，于是没有任何地方记录它被替换过。
按原文那条带复核当前输出：16 行精英全部 ≥95%，落在 85-95% 里的是**零行**。

**当前真正在执行的验收标准**（以 `sim/balance.sim.ts` 的 `BANDS` 为准）：

| tier | 指标 | 带 |
|---|---|---|
| 杂兵 · 弱 | 体力消耗 | 5%–20% |
| 杂兵 · 强 | 体力消耗 | 15%–35% |
| 精英 | 体力消耗 | 40%–55% |
| 首领 | 胜率 | 45%–70% |

`npm run sim` 会打印带外行数与总行数（`bandTable` 的标题），三张表分开算，
不要只读其中一张。
