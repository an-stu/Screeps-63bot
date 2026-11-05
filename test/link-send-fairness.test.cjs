const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const src = fs.readFileSync(path.join(root, "modules/station_carry.js"), "utf8");

/**
 * 矿点 link 的发送必须公平轮转（2026-11-05 E55S39 实测）。
 *
 * hub link 容量 800 = 一个矿点 link 的存量，所以一个 pass 只能发一个矿点：
 * 发完 hub 就不是 empty，`centerLink.store.isEmpty()` 会把后面的矿点全挡掉。
 * 原来按 `_.values()` 的**固定键序**遍历 ⇒ 排前面的矿点永远先发，后面的矿点
 * 只在「它刚好不满」的间隙才轮得到 —— 对一个 10/tick 一直在灌的矿点来说这个
 * 间隙几乎不存在。
 *
 * 现场：E55S39 (39,20) 矿点两个 link 连卡 30+ tick 800/800、容器 2000 满、
 * keeper 抱着 400 站在 (38,20) 往地上倒，地面 12.9k→13.6k 在涨；同房 (14,8)
 * 的两个 link 每轮 800→400→800 地周转。全账号 7 个 RCL8 房同一形态。
 *
 * 本测试只拷 `transformLink` 的**行为**：两个矿点都满、hub 每轮被清空时，
 * 两轮之内两个矿点都必须各发到一次。负对照 = 去掉排序（回到固定键序），
 * 第二个矿点永远轮不到。
 */

const m = src.match(/\n {4}transformLink\(room\) \{[\s\S]*?\n {4}\},/);
assert.ok(m, "station_carry.transformLink 必须存在");
const fnSrc = m[0];

function makeLink(energy) {
    return {
        store: {
            energy,
            getFreeCapacity: () => 800 - energy,
            isEmpty: () => energy === 0,
            isFull: () => energy === 800,
        },
        cooldown: 0,
        transferEnergy(target) {
            let amt = Math.min(this.store.energy, 800 - target.store.energy);
            if (amt <= 0) return -8;
            this.store.energy -= amt;
            target.store.energy += amt;
            return 0;
        },
    };
}

/** 造一个「两矿点 × 2 link + hub + 升级 link」的房间，返回可观察的实体表。 */
function buildRoom() {
    const world = {
        hub: makeLink(0),
        upgrade: makeLink(100),        // 非空 ⇒ 不会走升级 link 那条分支
        A: { link: makeLink(800), link2: makeLink(800), container: { store: { energy: 2000 } } },
        B: { link: makeLink(800), link2: makeLink(800), container: { store: { energy: 2000 } } },
    };
    const room = {
        name: "T1",
        memory: {
            stationUpgrade: { link: "upgrade" },
            stationCarry: { link: "hub", edgeLink: null },
            stationSources: {
                // 键序固定：A 永远在 B 前面（这就是原实现的遍历顺序）
                A: { id: "sA", link: "A_link", link2: "A_link2", container: "A_ct" },
                B: { id: "sB", link: "B_link", link2: "B_link2", container: "B_ct" },
            },
        },
    };
    const byId = {
        hub: world.hub,
        upgrade: world.upgrade,
        A_link: world.A.link, A_link2: world.A.link2, A_ct: world.A.container,
        B_link: world.B.link, B_link2: world.B.link2, B_ct: world.B.container,
    };
    return { world, room, byId };
}

function makeCtx(byId, sourceOverride) {
    const ctx = {
        console,
        Game: { time: 1000, getObjectById: id => byId[id] },
        STRUCTURE_LINK: "link",
        STRUCTURE_CONTAINER: "container",
        RESOURCE_ENERGY: "energy",
        OUTER_EDGE_LINK_SEND: 400,
        StationUpgrade: { stationName: "stationUpgrade" },
        StationSources: { stationName: "stationSources" },
        _: { values: obj => Object.keys(obj).map(k => obj[k]) },
    };
    ctx.pro = { stationName: "stationCarry" };
    ctx.global = ctx;
    const body = (sourceOverride || fnSrc).replace(/,?\s*$/, "");
    vm.runInNewContext("var obj = {" + body + "};", ctx, { filename: "station_carry-transformLink.js" });
    ctx.transformLink = ctx.obj.transformLink;
    return ctx;
}

function run() {
    const { world, room, byId } = buildRoom();
    const ctx = makeCtx(byId);
    const sentBy = [];

    // 第 1 轮：两个矿点都满、hub 空 ⇒ 应该有一个矿点发出去
    ctx.transformLink(room);
    if (world.A.link.store.energy < 800) sentBy.push("A");
    if (world.B.link.store.energy < 800) sentBy.push("B");
    assert.equal(sentBy.length, 1, "一个 pass 只允许一个矿点发送（hub 只有 800 容量）");
    assert.equal(world.hub.store.energy, 800, "发出的能量必须真的进了 hub link");

    // 模拟搬运爬把 hub 抽空（现场实测 hub 每 ~10 tick 被清一次）
    world.hub.store.energy = 0;

    // 第 2 轮：必须是**另一个**矿点拿到这次机会
    const before = sentBy[0];
    ctx.Game.time = 1007;
    ctx.transformLink(room);
    const second = world.A.link.store.energy < 800 && before != "A" ? "A"
        : world.B.link.store.energy < 800 && before != "B" ? "B" : null;
    assert.equal(second, before == "A" ? "B" : "A",
        "第二个矿点必须在下一轮拿到发送机会（否则它的 keeper 只能往地上倒）");

    // 负对照：去掉排序（= 原来的固定键序），第二个矿点永远轮不到 —— 用它证明
    // 上面那条断言真的在测「轮转」而不是碰巧。
    const nc = buildRoom();
    const ncCtx = makeCtx(nc.byId, fnSrc.replace(/\n\s*mines\.sort\([^\n]*\);/, "\n"));
    ncCtx.Game.time = 1000;
    ncCtx.transformLink(nc.room);
    nc.world.hub.store.energy = 0;
    ncCtx.Game.time = 1007;
    ncCtx.transformLink(nc.room);
    assert.ok(nc.world.B.link.store.energy === 800,
        "负对照：固定键序下第二个矿点两轮都发不出去（这条断言红了说明轮转真的在起作用）");

    console.log("OK link-send-fairness");
}

run();
