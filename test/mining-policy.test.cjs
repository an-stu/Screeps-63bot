/**
 * 采集政策（用户 2026-11-07）：
 *   · **只采单价 > 能量单价一半的矿**（动态价格闸，取代静态 U/K/Z 黑名单）——
 *     按当日 shard3 快照（能量均价 16.0），U 10.2 / K 16.3 / Z 18.7 / O 22.1 /
 *     H 36.5 / L 135 / X 304 全部在线上 ⇒ 当前七种全采；某矿跌破线自动回到只买不采。
 *   · **有矿就采**：采集侧不再设存量上限（旧 mineStop 20000 / U/K/Z 永不采 全废除）。
 *   · **多余 mineral >2 万直接挂卖单**（autoSellMineral 的 keep 150000 → 20000，
 *     全局 _resCnt 买入线滞回保留，防 autoBuyMineral 自买自卖）。
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const src = fs.readFileSync(path.join(root, "modules", "station_minetral.js"), "utf8")
    .replace(/\r\n/g, "\n");
const marketSrc = fs.readFileSync(path.join(root, "modules", "strategy_market.js"), "utf8")
    .replace(/\r\n/g, "\n");

function load(priceMap, mineralSettings, historyMap, overrides) {
    const ctx = {
        console: { log() {} },
        Creep: function () {},
        CreepPrototype_stub: null,
        Memory: { mineralSettings: mineralSettings || {}, marketSettings: {}, rooms: {} },
        Game: { time: 100000, cpu: { bucket: 10000 }, shard: { name: "shard3" }, getObjectById: () => null },
        RESOURCE_ENERGY: "energy",
        RESOURCE_UTRIUM: "U", RESOURCE_KEANIUM: "K", RESOURCE_ZYNTHIUM: "Z",
        RESOURCE_HYDROGEN: "H", RESOURCE_OXYGEN: "O", RESOURCE_LEMERGIUM: "L",
        RESOURCE_CATALYST: "X",
        STRUCTURE_CONTAINER: "container", STRUCTURE_EXTRACTOR: "extractor",
        WORK: "work", MOVE: "move", CARRY: "carry",
        BODYPART_COST: { work: 100, move: 50, carry: 50 },
        FIND_CONSTRUCTION_SITES: 3,
        UtilsTask: {
            task: (obj, name, reg) => ({ taskName: name, id: obj && obj.id }),
            taskData: (name) => ({ taskName: name }),
            taskOutView: (id, room, x, y, name, reg) => ({ taskName: name, id }),
        },
        ManagerCreeps: { calcBodyPart: (map) => Object.keys(map) },
        StationHive: { trySpawn: () => "ok" },
        StationCarry: { roomMassStoreCnt: () => 0 },
        StrategyMarketPrice: {
            getResTypeHistory: (r) => (priceMap && priceMap[r]) || 0,
            getHistory: (r) => (historyMap && historyMap[r]) || [],
        },
    };
    Object.assign(ctx, overrides);
    ctx.global = ctx;
    vm.runInNewContext(src, ctx, { filename: "station_minetral.js" });
    assert.ok(ctx.global.StationMineral, "StationMineral 未导出");
    return ctx.global.StationMineral;
}

{
    // ① 价格闸：矿价 > 能量价一半才采
    const S = load({ energy: 16.0, U: 10.2, K: 16.3, Z: 18.7, O: 22.1, H: 36.5, L: 135, X: 304 });
    for (let r of ["U", "K", "Z", "O", "H", "L", "X"]) {
        assert.equal(S.getMiningPolicy(r).mine, true, r + " 均价高于能量一半（8.0）⇒ 必须采（当日全采）");
    }
    assert.equal(S.getMiningPolicy("U").mine, true, "U 10.2 > 8.0 ⇒ 采（旧黑名单废除）");
    // 跌破线 ⇒ 只买不采
    const S2 = load({ energy: 16.0, U: 7.9 });
    assert.equal(S2.getMiningPolicy("U").mine, false, "U 7.9 ≤ 8.0 ⇒ 不采（严格大于语义）");
    const S2b = load({ energy: 16.0, U: 8.0 });
    assert.equal(S2b.getMiningPolicy("U").mine, false, "恰好等于一半 ⇒ 不采（大于而非大于等于）");
}

{
    // ② 缺价格数据 ⇒ 默认采（有矿就采，市场冷启动不空转）
    const S = load({});
    assert.equal(S.getMiningPolicy("U").mine, true, "无价格数据默认采");
    assert.equal(S.getMiningPolicy("X").mine, true, "能量无价也默认采");
}

{
    // ②b 波动矿兜底（0.78.218）：价格地图把 stddev>avg 的波动日全滤掉后，
    //    H 掉回 DEFAULT_PRICE（1.1）⇒ 误判「不值一采」。政策用**原始** 14 天
    //    历史成交量加权价兜底取 max —— 只有所有信号都说便宜才停采。
    //    线上现场：H 挂单 100+ / 14 天均价 36+，地图却只有默认值 1.1。
    const H_HISTORY = [
        { avgPrice: 30, volume: 5000 }, { avgPrice: 40, volume: 6000 }, { avgPrice: 39, volume: 4000 },
    ];
    const S = load({ energy: 17.9, H: 1.1 }, null, { H: H_HISTORY });
    assert.equal(S.getMiningPolicy("H").mine, true,
        "H 地图价 1.1（默认值）但原始历史 36+ ⇒ 必须采（36.5 > 17.9/2）");
    // 所有信号都说便宜（原始历史也是 1.x）⇒ 才停采
    const S2 = load({ energy: 17.9, H: 1.1 }, null, { H: [{ avgPrice: 1.2, volume: 100 }] });
    assert.equal(S2.getMiningPolicy("H").mine, false, "地图 1.1 + 原始历史 1.2 都低于线 ⇒ 停采");
}

{
    // ③ 存量上限默认 Infinity（有矿就采），Memory.mineralSettings 可应急设上限
    const S = load({ energy: 16, U: 10 });
    assert.equal(S.getMiningPolicy("U").stop, Infinity, "默认不设存量上限");
    const S2 = load({ energy: 16, U: 10 }, { U: { stop: 5000 } });
    assert.equal(S2.getMiningPolicy("U").stop, 5000, "mineralSettings[U].stop 应急上限仍生效");
}

{
    // ④ 孵化和在岗矿工都遵守显式应急上限，库存下降后能自动恢复。
    const Creep = function () {};
    const mineral = { id: "mine", mineralAmount: 10000, ticksToRegeneration: 0 };
    const container = { id: "box", pos: { isEqualTo: () => true }, store: { U: 200, getFreeCapacity: () => 1800 } };
    const station = { id: mineral.id, container: container.id, resType: "U", roomName: "E53S21", creeps: [], spawnTime: 0 };
    const room = { name: "E53S21", memory: { stationMineral: station }, mineral, extractor: {}, getEnergyCapacityAvailable: () => 800 };
    const creep = { room, ticksToLive: 600, headTask: () => ({ id: mineral.id, roomName: room.name }) };
    let spawnCalls = 0;
    let harvestCalls = 0;
    let stock = 4800;
    creep.harvest = target => { assert.equal(target, mineral); harvestCalls++; };
    const overrides = {
        Creep,
        Game: { time: 100000, getObjectById: id => ({ mine: mineral, box: container })[id] },
        StationHive: { trySpawn: () => { spawnCalls++; } },
        StationCarry: { roomMassStoreCnt: () => stock },
    };
    const attempt = (settings, expected) => {
        const S = load({ energy: 16, U: 10 }, settings, null, overrides);
        spawnCalls = harvestCalls = 0;
        S.trySpawnHarKeeper(room);
        Creep.prototype.harvestMineralKeeper.call(creep);
        assert.deepEqual([spawnCalls, harvestCalls], [expected, expected]);
    };
    const cap = { U: { stop: 5000 } };
    attempt(cap, 0); // 仓储 + 容器正好到上限
    stock++;
    attempt(cap, 0);
    stock -= 2;
    attempt(cap, 1);
    attempt({ U: { stop: 0 } }, 0);
    stock = 50000;
    attempt({}, 1);
    attempt({ U: { stop: "" } }, 1);

    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
    assert.ok(!code.includes("buyOnlyMinerals"), "静态 U/K/Z 黑名单必须删除");
    assert.ok(!code.includes("mineStop"), "静态 mineStop 必须删除");
}

{
    // ⑤ autoSellMineral：mineralKeep 默认 2 万（多余 mineral >2 万直接挂卖单）
    const code = marketSrc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
    assert.ok(/mineralKeep\) \|\| 20000/.test(code), "autoSellMineral 保留量默认必须是 20000");
    // 全局买入线滞回必须保留（防 autoBuyMineral 自买自卖）
    assert.ok(code.includes("ManagerRooms.getNormalRoom().length * 6000 + 10000"),
        "全局存量买入线（滞回）必须保留");
}

console.log("mining-policy: passed");
