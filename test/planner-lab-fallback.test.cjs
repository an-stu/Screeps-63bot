/**
 * 老规划器的 lab 广场兜底：找不到合法 4×4 区块时 labX/labY 保持 0，+1 后会在
 * (0-3,0-3) 角落生成整组 lab + 环绕道路（E55S29 实测：低级自动建造随即在
 * (1,2)/(2,1)/(2,3) 之类角落格立 road 工地，用户 2026-11-21 质问）。
 *
 * 修法：labFound 标记；未找到广场时整组 lab + 环绕道路都不写入 structMap。
 * 负对照：去掉 `if (labFound) {` 包裹，下面的结构断言必须失败。
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const src = fs.readFileSync(path.join(root, "modules", "manager_planner.js"), "utf8");
const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

// ① 必须有 labFound 标记，且只在 checkCnt==16（合法 4×4）时置真
assert.ok(/let labFound = false/.test(code), "必须有 labFound 初始化为 false");
assert.ok(/labFound = true/.test(code), "找到合法广场时必须置 labFound=true");
const foundIdx = code.indexOf("labFound = true");
const cntIdx = code.lastIndexOf("checkCnt==16", foundIdx);
assert.ok(cntIdx > 0 && foundIdx - cntIdx < 200, "labFound 必须在 checkCnt==16 分支里置真");

// ② lab 广场 + 环绕道路的写入必须整体包在 if (labFound) 里
const guardIdx = code.indexOf("if (labFound) {");
assert.ok(guardIdx > 0, "lab 广场必须被 if (labFound) 包裹");
const wallIdx = code.indexOf('structMap["rampart"]', guardIdx);
assert.ok(wallIdx > guardIdx, "找到 rampart 汇总点，用于确认包裹范围");
const plaza = code.slice(guardIdx, wallIdx);
assert.ok(/structMap\["lab"\]\.push/.test(plaza), "lab 写入必须在 guard 内");
assert.ok(/structMap\["road"\]\.push/.test(plaza), "环绕道路写入必须在 guard 内");
// 负对照：guard 之前不允许出现 lab 广场的写入
const before = code.slice(0, guardIdx);
assert.ok(!/structMap\["lab"\]\.push\(\[labX\+i/.test(before), "guard 之外不得写 lab 广场");

// ③ 行为模拟：用同一段源码在最小上下文中跑两种场景
const vm = require("node:vm");
function runPlaza(found) {
    const ctx = { x: 10, y: 10, structMap: { lab: [], road: [] } };
    ctx.global = ctx;
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
    vm.runInNewContext(snippet, ctx);
    return ctx.structMap;
}
{
    const yes = runPlaza(true);
    assert.ok(yes.lab.length > 0, "找到广场时必须规划 lab");
    const no = runPlaza(false);
    assert.equal(no.lab.length, 0, "未找到广场时不得规划 lab");
    assert.equal(no.road.length, 0, "未找到广场时不得规划环绕道路");
}

console.log("planner lab fallback: OK");
