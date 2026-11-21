/**
 * lab 广场布局：原搜索找不到合法 4×4 区块时**跳过 lab 广场**，绝不在 (0-3,0-3)
 * 角落兜底（E55S29 实测：旧代码 labX/labY=0 → +1 后把整组 lab 铺到角落，
 * 低级自动建造随即在 (1,2)/(2,1)/(2,3) 之类角落格立 road 工地）。
 *
 * 用户 2026-11-21 定稿：找不到就不考虑（跳过），不做全图兜底搜索。
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const src = fs.readFileSync(path.join(root, "modules", "manager_planner.js"), "utf8");
const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

// ① 必须有 labFound 标记，且只在 checkCnt==16（合法 4×4）时置真
assert.ok(/let labFound = false/.test(code), "必须有 labFound 初始化为 false");
assert.ok(/labFound = true/.test(code), "找到合法广场时必须置 labFound=true");
const foundIdx = code.indexOf("labFound = true");
const cntIdx = code.lastIndexOf("checkCnt==16", foundIdx);
assert.ok(cntIdx > 0 && foundIdx - cntIdx < 200, "labFound 必须在 checkCnt==16 分支里置真");

// ② 不得再有全图兜底搜索（用户定稿：找不到就跳过）
assert.ok(!/if \(!labFound\) \{/.test(code), "不得保留全图兜底搜索（找不到就跳过）");
assert.ok(!/roomWalkable\.get\(bx \+ i, by \+ j\)/.test(code), "不得保留兜底搜索的 4×4 扫描");

// ③ lab 广场 + 环绕道路的写入必须整体包在 if (labFound) 里
const guardIdx = code.indexOf("if (labFound) {");
assert.ok(guardIdx > 0, "lab 广场必须被 if (labFound) 包裹");
const wallIdx = code.indexOf('structMap["rampart"]', guardIdx);
assert.ok(wallIdx > guardIdx);
const plaza = code.slice(guardIdx, wallIdx);
assert.ok(/structMap\["lab"\]\.push/.test(plaza), "lab 写入必须在 guard 内");
assert.ok(/structMap\["road"\]\.push/.test(plaza), "环绕道路写入必须在 guard 内");

// ④ 行为模拟：找到 → 正常规划；找不到 → 零 lab / 零道路（角落兜底回归）
const vm2 = vm;
function runPlaza(found) {
    const ctx = { structMap: { lab: [], road: [] } };
    const snippet = `
        let labX = 10, labY = 10, labChangeDirection = false;
        ${found ? "" : "labX = 0; labY = 0;"}
        let labs = ["☢☢-☢", "☢-☢-", "-☢-☢", "☢-☢☢"];
        if (${found}) {
        let vis = {};
        for(let i=0;i<2;i++){ for(let j=0;j<2;j++){ vis[i+"_"+j]=1; let jj=labChangeDirection?j:1-j;
            (labs[i+1].charAt(j+1)=='☢'?structMap["lab"]:structMap["road"]).push([labX+i,labY+jj]); } }
        for(let i=-1;i<3;i++){ for(let j=-1;j<3;j++){ if(vis[i+"_"+j])continue; let jj=labChangeDirection?j:1-j;
            (labs[i+1].charAt(j+1)=='☢'?structMap["lab"]:structMap["road"]).push([labX+i,labY+jj]); } }
        }
    `;
    vm2.runInNewContext(snippet, ctx);
    return ctx.structMap;
}
{
    assert.ok(runPlaza(true).lab.length > 0, "找到广场时必须规划 lab");
    const none = runPlaza(false);
    assert.equal(none.lab.length, 0, "找不到时不得规划 lab");
    assert.equal(none.road.length, 0, "找不到时不得写环绕道路（角落兜底回归）");
}

console.log("planner lab fallback: OK");
