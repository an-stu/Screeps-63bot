/**
 * RawMemory 段遥测镜像（Grafana Cloud Infinity 直读，无需本地进程）。
 *
 * 背景：/api/user/memory 的返回值全部是 gz: 压缩串，Grafana Infinity 数据源
 * 无法解压；而 /api/user/memory-segment 返回原始字符串。因此每 10 tick 把
 * 运行遥测写进段 90，云端直接按 JSON 查询。
 *
 * 段内容：
 *   { v: 1,
 *     latest: { t, ver, cpu, avg, bucket, creeps, pc, err, gcl, gclL, gpl, gplL,
 *               srcFull, srcTotal,
 *               phases: [{k,v}], roles: [{k,v}], rooms: [{k,v}], res: [{k,v}] },
 *     cols: ["t","cpu","avg","bucket","creeps","pc","err"],
 *     rows: [[t,cpu,avg,bucket,creeps,pc,err], ...] }
 *
 * 成本控制：rows 上限 600 行（6000 tick 历史），整段约 30-40KB，每 10 tick
 * 写一次；资源汇总只扫 storage / terminal / factory / labs。写段失败绝不影响
 * 主循环。
 */
const SEGMENT_ID = 90;
const INTERVAL = 10;
const MAX_ROWS = 600;
const RING_COLS = ["t", "cpu", "avg", "bucket", "creeps", "pc", "err"];

let state = null;

function round(v, d) {
    if (typeof v != "number" || !isFinite(v)) return null;
    let p = Math.pow(10, d);
    return Math.round(v * p) / p;
}

function pairs(obj) {
    let out = [];
    if (!obj) return out;
    for (let k in obj) {
        let v = obj[k];
        if (typeof v == "number" && isFinite(v)) out.push({ k: k, v: round(v, 3) });
    }
    out.sort((a, b) => b.v - a.v);
    return out;
}

function collectResources() {
    let totals = {};
    let add = store => {
        if (!store) return;
        for (let k in store) {
            let v = store[k];
            if (typeof v == "number" && v > 0) totals[k] = (totals[k] || 0) + v;
        }
    };
    for (let name in Game.rooms) {
        let room = Game.rooms[name];
        if (!room || !room.my) continue;
        add(room.storage && room.storage.store);
        add(room.terminal && room.terminal.store);
        add(room.factory && room.factory.store);
        if (room.labs) for (let i = 0; i < room.labs.length; i++) add(room.labs[i].store);
    }
    return totals;
}

function loadState() {
    if (state) return state;
    state = { rows: [] };
    try {
        let text = RawMemory.segments[SEGMENT_ID];
        if (typeof text == "string" && text) {
            let parsed = JSON.parse(text);
            if (parsed && Array.isArray(parsed.rows)) state.rows = parsed.rows.slice(-MAX_ROWS);
        }
    } catch (e) { /* 段内容损坏时从头开始，不阻塞主循环 */ }
    return state;
}

function exec() {
    try {
        // 首个 tick 先激活段（激活下一 tick 生效），避免首个写周期丢写
        if (!global.__telSegmentOn) {
            RawMemory.setActiveSegments([SEGMENT_ID]);
            global.__telSegmentOn = Game.time;
        }
        if (Game.time % INTERVAL != 0) return;
        let st = loadState();
        let h = Memory.codeHealth || {};
        let s = Memory.stats || {};
        let phases = h.phases || {};
        let latest = {
            t: Game.time,
            ver: RUNTIME_PROFILE.version,
            cpu: round(h.cpu, 2), avg: round(h.averageCpu, 2),
            bucket: h.bucket, creeps: h.creeps, pc: h.powerCreeps,
            err: h.errorCount || 0,
            gcl: round(s.gcl, 2), gclL: s.gclLevel,
            gpl: round(s.gpl, 2), gplL: s.gplLevel,
            phases: pairs(phases),
            roles: pairs(phases.unitRoles),
            rooms: pairs(phases.roomDetails),
            res: pairs(collectResources()),
            srcFull: h.fullSourceContainers, srcTotal: h.totalSourceContainers,
        };
        st.rows.push([Game.time, latest.cpu, latest.avg, latest.bucket, latest.creeps, latest.pc, latest.err]);
        if (st.rows.length > MAX_ROWS) st.rows.splice(0, st.rows.length - MAX_ROWS);
        RawMemory.segments[SEGMENT_ID] = JSON.stringify({ v: 1, latest: latest, cols: RING_COLS, rows: st.rows });
    } catch (e) {
        // 遥测写入失败不能影响主循环
    }
}

global.HelperTelemetrySegment = { exec: exec, SEGMENT_ID: SEGMENT_ID };
module.exports = global.HelperTelemetrySegment;
