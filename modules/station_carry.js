
global.STORE_IN = 0;
global.STORE_CACHE = 1;
global.STORE_OUT = 2;//只存储能量

/**
 * 主房边缘 link（外矿卸货口，见 StationSources.ensureOuterEdgeLink）攒到多少能量
 * 才发给主房 link 网。
 *
 * 取值要小：link 容量 800，而外矿搬运爬一趟 1250+ —— 一次只塞得进 800，剩下的
 * 要靠 link 把货发走才卸得下（见 harvestEnergyOuterCarryRoadBuilder 的有界等待）。
 * 阈值太大，尾量会长期滞留在 link 里，搬运爬每次都得多等一轮甚至回退 storage。
 */
const OUTER_EDGE_LINK_SEND = 200;


Creep.prototype.registerStationCarryDrop = function () {
    let room = Game.rooms[this.memory["roomName"]]
    room.dropUsed = room.dropUsed || {}
    let id = this.headTask().id;
    room.dropUsed[id] = true
};


let pro = {
    stationName: "stationCarry",
    isRoomMassStore(room, obj) {
        if (room.storage && room.storage.id == obj.id) return true
        if (room.terminal && room.terminal.id == obj.id) return true
        // if(room.factory&&room.factory.id==obj.id) return true
        return false;
    },
    roomMassStoreCnt(room, resType) {
        let cnt = 0;
        if (room.storage) cnt += room.storage.store.getUsedCapacity(resType);
        if (room.terminal) cnt += room.terminal.store.getUsedCapacity(resType);
        // if(room.factory) cnt += room.factory.store.getUsedCapacity(resType);
        return cnt;
    },
    generatorMassStoreCarry(room, resType, resCount, regFun) {
        let tasks = []
        for (let target of [room.storage, room.terminal]) {//,room.factory
            if (!target) continue;
            let currentCnt = Math.min(target.store[resType] || 0, resCount);
            resCount -= currentCnt
            if (currentCnt) tasks.push(UtilsTask.task(target, "carryRes", regFun, { resType: resType, resCount: currentCnt }))
            if (resCount <= 0) break;
        }
        return tasks;
    },
    /**
     * @param bodyBudget 可选：**本 tick 真能花出去**的能量上限（见
     *        `StrategyHighLevel.spawnTickBudget`）。不给就按本房满容量算 ——
     *        那正是 2026-11-01 W26N58 的坑：RCL6 容量 2,300，hive 被 keeper /
     *        外矿搬运反复抽到 600~1,750，按 2,300 算出的体型
     *        `StationHive.trySpawn` 一律付不起、静默 `return undefined`，
     *        于是「闸门放行、就是不生」，从外面看和闸门没通过完全一样。
     */
    getCarrierBodyConfig(room, bodyBudget) {
        let totalEnergy = room.getEnergyCapacityAvailable(room);
        let body = [CARRY, CARRY, MOVE];
        let bodyEnergy = Utils.getBodyEnergyNeed(body)
        let num = 0
        // 仅当 keeper 和 carrier 都缺失（房间挨饿/bootstrap 阶段）时，按实际可用能量
        // 定身体并保证最小 300 能量；正常运行用完整的按容量配置
        let starving = room.creeps("harvestEnergyKeeper", false).length == 0
            && room.creeps("carrier", false).length == 0;
        let budget = starving ? Math.max(300, Math.min(totalEnergy, room.energyAvailable)) : totalEnergy;
        // 体型只能按「付得起」定：上限夹到本 tick 可花的能量，下限保 300（2 组）。
        if (bodyBudget !== undefined) budget = Math.max(300, Math.min(budget, bodyBudget));
        for (let i = 1; i * bodyEnergy <= budget; i++) {
            if (num >= 17) break;
            num += 1
        }
        if (starving) num = Math.max(2, num); // 最小 2 组 = 300 能量
        return ManagerCreeps.calcBodyPart({ [CARRY]: num < 17 ? num * 2 : num * 2 - 1, [MOVE]: num });//
    },
    generatorCarryStorageEnergyTask(room, energyCnt = 6600) {
        if (room.storage && room.storage.store[RESOURCE_ENERGY] > 2000) {
            return [UtilsTask.task(room.storage, "carryRes", undefined, {
                resType: RESOURCE_ENERGY, resCount: energyCnt
            })]
        }
        let resCnt = pro.roomMassStoreCnt(room, RESOURCE_ENERGY);
        if (resCnt > Math.max(energyCnt, 2000)) {
            return pro.generatorMassStoreCarry(room, RESOURCE_ENERGY, Math.min(energyCnt, resCnt))
        }
        return []
    },
    generatorPickTask(room, onlyEnergy = false) { // 可能有bug\
        // 拿全部的
        room.dropUsed = room.dropUsed || {}
        let tasks = room.find(FIND_TOMBSTONES).concat(room.find(FIND_RUINS))
            .filter(e => !room.dropUsed[e.id])
            .map(drops => {
                if (drops.store.getUsedCapacity(onlyEnergy ? RESOURCE_ENERGY : undefined)) {
                    if (onlyEnergy)
                        return [UtilsTask.task(drops, "carryRes", "registerStationCarryDrop", {
                            resType: RESOURCE_ENERGY
                        })]
                    else
                        return _.keys(drops.store).map(e =>
                            UtilsTask.task(drops, "carryRes", "registerStationCarryDrop", {
                                resType: e
                            })
                        )
                }
                return null
            }).filter(e => e);
        return room.find(FIND_DROPPED_RESOURCES)
            .filter(e => !room.dropUsed[e.id])
            .filter(e => (e.resourceType != RESOURCE_ENERGY || e.amount > 100) && (onlyEnergy ? e.resourceType == RESOURCE_ENERGY : true)).map(dropRes => {
                return [UtilsTask.task(dropRes, "pickupRes", "registerStationCarryDrop", {
                    resType: dropRes.resourceType
                })]
            }).concat(tasks);
        // return
    },
    transformLink(room) {
        if (!room.memory[StationUpgrade.stationName] || !room.memory[pro.stationName]) return;
        let upgradeLink = Game.getObjectById(room.memory[StationUpgrade.stationName][STRUCTURE_LINK])
        let centerLink = Game.getObjectById(room.memory[pro.stationName][STRUCTURE_LINK])

        // 外矿卸货口 link（主房边缘，见 StationSources.ensureOuterEdgeLink）：
        // 它是个**中转站**，容量只有 800 而外矿搬运爬一趟 1250+，所以要**最先**
        // 把它清空 —— 它空着，下一只搬运爬到了才能卸干净、立刻掉头回去。优先级
        // 排在矿点 link 之前就是这个道理（矿点 link 背后还有容器做缓冲）。
        // 目的地：storage 旁的 hub link（-> 由搬运爬送进 storage），hub 满了退
        // 到升级 link（那也是本房正在消耗的能量）。都满就留在 link 里等下一轮。
        let edgeLink = Game.getObjectById(room.memory[pro.stationName].edgeLink);
        if (edgeLink && edgeLink.structureType == STRUCTURE_LINK) {
            let edgeSendAble = edgeLink.store[RESOURCE_ENERGY] >= OUTER_EDGE_LINK_SEND;
            if (edgeSendAble) {
                let dest;
                if (centerLink && centerLink.store.getFreeCapacity(RESOURCE_ENERGY) > 100) dest = centerLink;
                else if (upgradeLink && upgradeLink.store.getFreeCapacity(RESOURCE_ENERGY) > 100) dest = upgradeLink;
                if (dest) {
                    edgeLink.transferEnergy(dest);
                    if (dest == centerLink) centerLink = null;
                    else upgradeLink = null;
                }
            }
        }

        // 矿点 link 的发送必须**公平轮转**（2026-11-05 E55S39 实测）。
        //
        // 「一次只能发一个矿点」是物理约束，不是偷懒：hub link 容量 800，正好等于
        // 一个矿点 link 的存量，发完它就不再是 empty，后面的矿点本轮只能等。
        // 而 `_.values()` 的顺序是固定的（按 Memory 里的键序），于是**排在前面的
        // 矿点永远先发**，后面的矿点只能碰「它刚好不满」的间隙 —— 那个间隙对
        // 一个 10/tick 一直在灌的矿点来说几乎不存在。
        //
        // 实测 E55S39（RCL8、6 link、两只 keeper 两个矿点）：
        //   · (14,8) 的两个 link 每轮 800 → 400 → 800 地周转；
        //   · (39,20) 的两个 link **连续 30+ tick 卡 800/800**、容器 2000/2000 满，
        //     keeper 站在 (38,20) 抱着 400 没处放，只能往地上倒；
        //   · 那个矿点地面 12.9k → 13.6k 在涨（10/tick 产出全丢，还在衰减）。
        // 全账号同形态的还有 E48S41 / E55S31 / W31N55 / W32N56 / W33N55 / E41S32
        // —— 都是「所有矿点 link 800 + hub 776 + 地面在涨」。
        //
        // 按「上次发送时刻」升序轮转（从没发过的 lastLinkSend 视为 0，排最前），
        // 谁都不会被饿死；仍是「一个 pass 只发一个」，吞吐上限没变，改的只是
        // 谁拿到这一次机会。写 Memory 的是一个 tick 数，每 pass 一次，代价可忽略。
        let mines = _.values(room.memory[StationSources.stationName])
            .filter(e => e && typeof e == "object" && e.id);
        mines.sort((a, b) => (a.lastLinkSend || 0) - (b.lastLinkSend || 0));
        for (let e of mines) {
            let link = Game.getObjectById(e["link"]);
            let link2 = Game.getObjectById(e["link2"]);
            let minFreeSend = 100
            if (link && link2) {
                if (link.store.getFreeCapacity(RESOURCE_ENERGY) > minFreeSend || link.cooldown)
                    link = link2
            }
            let container = Game.getObjectById(e[STRUCTURE_CONTAINER]);
            if (!link) continue;
            let sendAble = link.store.getFreeCapacity(RESOURCE_ENERGY) <= minFreeSend
            if (!sendAble) continue;
            if (upgradeLink && sendAble && upgradeLink.store.isEmpty()) {
                link.transferEnergy(upgradeLink);
                upgradeLink = null
                continue;
            }

            if (centerLink && sendAble && centerLink.store.isEmpty()) {
                if (container && container.store[RESOURCE_ENERGY] > ((link && link2 && (link.store.isFull() && link2.store.isFull())) ? 0 : 800)) {
                    link.transferEnergy(centerLink);
                    centerLink = null
                    e.lastLinkSend = Game.time;
                }
            }
        }

        if (upgradeLink && upgradeLink.store.isEmpty() && centerLink && !centerLink.store.isEmpty()) {
            centerLink.transferEnergy(upgradeLink);
        }
        // room.
    },
    update(room) {
        if (!room.my) return delete room.memory[pro.stationName];
        let objs = room.memory[pro.stationName] || {};
        let centerLink = null;
        if (room.storage) room.link.forEach(e => {
            if (e.pos.isNearTo(room.storage)) {
                centerLink = e
            }
        })

        if (centerLink) {
            objs[STRUCTURE_LINK] = centerLink.id
        }

        room.memory[pro.stationName] = objs;
    },
    generatorFillNukerTask(room) {
        room.used = room.used || {};
        if (room.storage && room.nuker && !room.used[room.nuker.id]) {
            let gNeed = room.nuker.store.getFreeCapacity(RESOURCE_GHODIUM);
            if (gNeed > 0 && room.storage.store[RESOURCE_GHODIUM] >= 1650) {
                let ops = { resType: RESOURCE_GHODIUM, resCount: gNeed }
                return [UtilsTask.task(room.nuker, "fillRes", "registerUsed", ops),
                UtilsTask.task(room.storage, "carryRes", "registerUsed", ops)]
            }
            let enNeed = room.nuker.store.getFreeCapacity(RESOURCE_ENERGY);
            if (enNeed) {
                let nukerRatio = ((room.nuker.cooldown || 0) - 3000) / NUKER_COOLDOWN;
                let enTotal = room.nuker.store.getCapacity(RESOURCE_ENERGY);
                if (room.storage.store[RESOURCE_ENERGY] > 50000 && nukerRatio < (enNeed / enTotal)) {
                    let ops = { resType: RESOURCE_ENERGY, resCount: enNeed }
                    return [UtilsTask.task(room.nuker, "fillRes", "registerUsed", ops),
                    UtilsTask.task(room.storage, "carryRes", "registerUsed", ops)]
                }
            }
        }
        return [];
    },
    /**
     * change by an_w
     * @param {Room} room
     * @param {string} ResType
     * @param {number} resCount
     */
    generatorFillTerminalTask(room) {
        // get type and amount from flag
        room.used = room.used || {};
        let ResType = "OH"
        let resCount = 50000
        if (room.storage && room.terminal && !room.used[room.terminal.id] && room.terminal.store.getUsedCapacity(ResType) < resCount) {
            let need = room.terminal.store.getFreeCapacity(ResType);
            if (need > 0 && room.storage.store[ResType] >= resCount) {
                let ops = { resType: ResType, resCount: resCount }
                return [UtilsTask.task(room.terminal, "fillRes", "registerUsed", ops),
                UtilsTask.task(room.storage, "carryRes", "registerUsed", ops)]
            }
        }
        return [];
    },
    /**
     *
     * @param room
     * @param continuous 是不是持续工作的
     * @return {[]}
     */
    /**
     * 集中烧 power：`powerSpawn.processPower()`。
     *
     * 用户 2026-10-20：「打开之后烧，要确保能量足够充足；先一直积累，到足够一次烧大部分
     * 的时候使用，使用完一次又继续积累；可以在 W32N56 尝试。」
     *
     * 账：每烧 1 power 吃 **50 能量**。全账号 power 有一百多万，能量才是瓶颈，
     * 所以必须**攒一批烧一批**（滞回），不能见 power 就烧。
     *
     * 旋钮（都在 Memory.marketSettings，改完立刻生效）：
     *   powerSpawnRoom    试点房，默认 W32N56；设成 "" 即关闭
     *   powerSpawnHigh    开烧门槛（默认 500 power）
     *   powerSpawnLow     停烧水位（默认 100 power）
     *   powerSpawnEnergy  本房能量下限（默认 100000，低于它一律不烧；用户 2026-10-21 要求抬高）
     *   powerBurning      运行时状态（代码自己写，别手改）
     */
    tryProcessPower(room) {
        let ms = Memory.marketSettings || (Memory.marketSettings = {});
        let s = room.powerSpawn;
        if (!s || !s.store) return;
        let low = Number(ms.powerSpawnLow) >= 0 ? Number(ms.powerSpawnLow) : 100;
        let floor = Number(ms.powerSpawnEnergy) > 0 ? Number(ms.powerSpawnEnergy) : 100000;
        let power = pro.roomMassStoreCnt(room, RESOURCE_POWER);
        // 能量口径 = **storage 单口径**（2026-11-07，0.78.214）：terminal 是市场储备、
        // 不给可选消耗背书（与 POWER_SPAWN_ENERGY_FLOOR / roomEnergyAbundant /
        // StationDefense.repairWallAffordable 同源）。旧的质量口径（storage+terminal）
        // 在市场房 terminal 堆货时会把 storage 见底的房也算成「可烧」—— 正是
        // 2026-10-08「W33N55 storage 0 + terminal 41636 照烧」那个 bug 的残留形态，
        // 也是 E41S23 worker 挂机排查（0.78.213）里修墙预算被抽穿的族源。
        let energy = room.storage ? (room.storage.store[RESOURCE_ENERGY] || 0) : 0;
        let target = ms.powerSpawnRoom === undefined ? "W32N56" : ms.powerSpawnRoom;
        let isTarget = !!target && room.name == target;
        // **没有 OPERATE_POWER 效果的房间：正常烧**（用户 2026-10-21：
        // 「其余房间如果没有这个 op power 的 pc 就正常烧」）—— 一次 1 power + 50 能量。
        // 只受本房 power/能量下限约束，避免把房抽干；可用 powerSpawnOtherRooms=false 关掉。
        let fx0 = s.effects && s.effects.find(e => e.power == PWR_OPERATE_POWER);
        if (!fx0) {
            if (!isTarget && ms.powerSpawnOtherRooms === false) return;
            if (power <= low) return;
            // 非试点房开闸线 = 停烧线 + 5 万恢复带（滞回，与 strategy_highLevel 的
            // POWER_SPAWN_ENERGY_OPEN 同源同旋钮 powerSpawnOpenEnergy）：
            // 10 万~15 万是修墙/经济的独占恢复带 —— 烧制的连续抽水（50/tick）会把
            // storage 钉在 10 万闸门正下方，worker 永远凑不齐完整修墙 trip
            // （0.78.214 E41S23 实测：storage 99.4~100.1k 闪断带，41 tick 闪烧 12 发）。
            if (isTarget) {
                if (energy < floor) return;
            } else {
                let open = Number(ms.powerSpawnOpenEnergy) > 0 ? Number(ms.powerSpawnOpenEnergy) : floor + 50000;
                if (energy < open) return;
            }
            s.processPower();
            return;
        }
        // **烧制窗口 = OPERATE_POWER 生效期间**（用户 2026-10-21）：
        // 有 op power 时一次 processPower = 1+level 个 power（实测 4 级 = 5 个），
        // 所以「烧完一个效果」= 效果 duration × (1+level) 个 power。
        let fx = fx0;
        if (power <= low || energy <= floor) { ms.powerBurning = false; ms.powerBurnCredit = 0; return; }
        ms.powerBurning = true;

        // ★ 配速（用户 2026-10-21：「剩下的部分不要作废，尽可能烧完整一个周期」）：
        // 一次 processPower = (1+等级) 个 power = need 能量。若剩余能量不足以把这个效果
        // 按满速烧完，就按「剩余能量 / 剩余 tick」摊薄 —— 隔几个 tick 烧一次，
        // 把整段效果期均匀用掉，而不是满速烧到能量下限就停、让效果剩下的时间作废。
        let perCall = 1 + (fx.level || 0);
        let need = perCall * 50;
        let remain = Math.max(1, fx.ticksRemaining || 1);
        let budgetPerTick = Math.max(0, energy - floor) / remain;
        // 预算足（≥ 一次的量）时 credit 会一直为正 ⇒ 每 tick 都烧，与旧行为一致
        ms.powerBurnCredit = (ms.powerBurnCredit || 0) + budgetPerTick;
        if (ms.powerBurnCredit < need) return;
        ms.powerBurnCredit -= need;
        // powerSpawn 自己的 store 里必须有 ≥50 能量 + ≥1 power；不够时返回 ERR，不影响主循环
        s.processPower();
    },
    generatorFillPowerSpawnTask(room, continuous = false) {
        // 集中烧 power 的决策也挂在这里：这是每个房每轮都会走到的位置
        pro.tryProcessPower(room);
        room.used = room.used || {};
        let tasks = []
        // 能量口径与 tryProcessPower 同步为 storage 单口径（2026-11-07，0.78.214）：
        // 灌能闸若用 storage+terminal 质量口径，市场房 terminal 存货会让烧制在
        // storage 跌穿修墙储备（repairWallAffordable，10 万）时仍开闸送料，
        // power spawn 照烧 50 能量/tick ⇒ worker 无墙可修 ⇒ 挂机循环。
        let energyCnt = room.storage ? (room.storage.store[RESOURCE_ENERGY] || 0) : 0;
        let powerCnt = pro.roomMassStoreCnt(room, RESOURCE_POWER);
        // powerSpawn 只是喷嘴：power 容量 100、能量 5000，**每 tick 吃 1 power + 50 能量**。
        // 所以只要「本房是烧 power 的试点房」且存量够开闸，就要往里送料，
        // 否则它空着、processPower 每 tick 都白调（实测 W26N58 之前一直 +0 GPL）。
        let msC = Memory.marketSettings || {};
        let burnRoom = (msC.powerSpawnRoom === undefined ? "W32N56" : msC.powerSpawnRoom) == room.name;
        let highC = Number(msC.powerSpawnHigh) > 0 ? Number(msC.powerSpawnHigh) : 500;
        let floorC = Number(msC.powerSpawnEnergy) > 0 ? Number(msC.powerSpawnEnergy) : 100000;
        let wantBurn = burnRoom && (!!msC.powerBurning || (powerCnt >= highC && energyCnt >= floorC));
        // **灌料闸门必须与烧制闸门同源**（2026-11-10，0.78.229）。
        //
        // `tryProcessPower` 的开闸线是 `powerSpawnOpenEnergy`（缺省 floor+50000 = 15 万），
        // 而这里的非试点分支写死过 `energyCnt > 170000`：两道闸之间留着 15~17 万的
        // **死区**，落进去的房间会「被授权烧制、却不给补料」——
        //   · powerSpawn 的 5,000 能量缓冲（100 tick）烧完就归零；
        //   · processPower 需要 ≥50 能量，于是从此每 tick 白调、返回错误；
        //   · storage 卡在闸门正下方不再上涨（本房既没烧掉、也没攒起来），
        //     再也翻不过 17 万 ⇒ **两只闸互锁，永久停摆**（MEMORY 第 3 条）。
        // 实测 2026-11-10：W33N53 storage 168,694 / powerSpawn 能量 31→1181 反复，
        // W33N55 storage 168,762 / powerSpawn 能量 **1**、power 59 —— 两个房的
        // `roomMassStoreCnt(power)` 都是 5,9xx（差 100 不到 6000），能量差 1.3k 不到 17 万，
        // 两条非试点分支同时擦边落空。烧掉的 5,000 缓冲就是它们「确实在烧」的铁证。
        //
        // 修法只统一口径，**不动任何阈值本身**：非试点房的补料线 = 烧制开闸线
        // （`powerSpawnOpenEnergy` 或 floor+50000）。用户 2026-10-21 定的
        // 「10 万以下不烧 / 15 万以上才烧」原封不动；试点房（`powerSpawnRoom`）走
        // 自己的 `energyCnt > 30000` 分支，也不动。
        let openC = Number(msC.powerSpawnOpenEnergy) > 0 ? Number(msC.powerSpawnOpenEnergy) : floorC + 50000;
        // ★ 2026-11-11（0.78.237）：`powerCnt` 的下限也必须与烧制侧同源 ——
        // 0.78.229 只统一了**能量**口径，power 口径仍留着「灌料要 > 1000、烧制只要
        // > powerSpawnLow(100)」的叉子。而 `StrategyHighLevel.processPowerSpawn`
        // （第二条烧制路径，每房每 tick 都跑）更宽松：ps 里有 ≥1 power 就烧。
        // ⇒ storage ≥ 15 万、全房 power 落在 **1~1000** 的房会「被烧、不给补」：
        //   ps 的 100 power 库存 100 tick 烧空，此后 processPower 恒 ERR、
        //   5,000 能量缓冲一起晾在泵里，直到全房 power 重新 > 1000 才解冻。
        // 现场（19:50）：W32N56 6,079 / W33N55 6,048 / W34N52 6,001 / W33N53 5,953
        // 正在往下烧，四房都在 6,000 这条线上，掉进 1000 以下只是时间问题。
        // 改法只把 clause1 的 power 下限降到 0（「有 power 就灌」），能量闸一个没动：
        // 能烧 ⇒ 必能补，这是 MEMORY 第 3 条「同一决策的两层阈值必须同源」的直接要求。
        let fillGate = wantBurn
            ? (energyCnt > 30000 && powerCnt > 0)
            : (energyCnt >= openC && powerCnt > 0 || energyCnt > 100000 && powerCnt > 6000
                // fillGate 在下面 powerSpawn 存在性检查**之前**求值：RCL<8 或
                // powerSpawn 被拆时 room.powerSpawn 为 undefined，裸取 .effects
                // 会抛 TypeError 打断整个派发 pass。
                || energyCnt > 100000 && powerCnt > 100 && room.powerSpawn && room.powerSpawn.effects && room.powerSpawn.effects.length);
        if (room.level >= 8 && room.storage && room.terminal && room.powerSpawn
            && (!room.used[room.powerSpawn.id] || continuous) && fillGate) {
            let powerNeed = room.powerSpawn.store.getFreeCapacity(RESOURCE_POWER);

            let s = room.powerSpawn;
            let fastCarry = 70;
            if (s.effects && s.effects.length) {
                fastCarry -= (s.effects.head().level - 1) * 10
            }
            let enNeed = room.powerSpawn.store.getFreeCapacity(RESOURCE_ENERGY);

            if (StationCarry.roomMassStoreCnt(room, RESOURCE_POWER) > powerNeed && powerNeed >= fastCarry || enNeed > 1650) {
                // **没有「去取货」任务时绝不要挂 `fillAllTask`（2026-11-01 实测）。**
                //
                // 这个闸门用的是 `powerNeed >= fastCarry`，而下面取货那一行是 `> fastCarry`，
                // 松了一格：powerSpawn 缺 70 power（正好一格运力）、能量只缺 200 时，闸门放行
                // 却一条取货任务都不生成，返回的任务表里**只剩一个 fillAllTask**。
                // 空手爬执行 fillAllTask 会立刻 popTask（store 空 → 见 prototype_creep.js:760），
                // 下一 tick `fillPowerSpawnContinuous` 又生成一次 ⇒ **无限循环，永不取货**。
                //
                // 实测现场 W32N56（烧 power 试点房、`powerBurning=true` 但本房能量
                // 99,123 < `powerSpawnEnergy` 100,000 ⇒ powerSpawn 根本不 process）：
                // 全房唯一那只 carrier 在 (15,41) 钉了 40+ 分钟（能量恒 0、ttl 一直往下掉、
                // 每 tick 只做一次空的 goTo(storage)），于是 hub link 卡在 776 没人搬 ⇒
                // 两个矿点 link 800/800 + 容器 2000/2000 全满 ⇒ keeper 满仓溢出到地面
                // （8/tick 在涨，约 16/tick 被衰减掉）。
                // 判据：**任务表里没有取货任务就等于没活干**，让调用方 popTask 把爬放出去。
                let carries = []
                if (enNeed > 800) carries = carries.concat(StationCarry.generatorMassStoreCarry(room, RESOURCE_ENERGY, enNeed, "registerUsed"))
                if (powerNeed > fastCarry) carries = carries.concat(StationCarry.generatorMassStoreCarry(room, RESOURCE_POWER, powerNeed))
                if (carries.length) {
                    tasks.unshift(UtilsTask.task(room.powerSpawn, "fillAllTask", "registerUsed"))
                    tasks = tasks.concat(carries)
                }
            }
        }
        return tasks;
    },
};



global.StationCarry = pro;
