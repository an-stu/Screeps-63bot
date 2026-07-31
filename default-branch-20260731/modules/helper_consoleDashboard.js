/**
 * On-demand console dashboard. It never runs from the tick loop.
 *
 * Usage:
 *   dash()             // owned-room overview
 *   dash("E49S31")     // one room: resources, roles and tasks
 */

const COLORS = {
    bg: "#111827", panel: "#182235", line: "#334155", text: "#e5e7eb",
    dim: "#94a3b8", good: "#34d399", warn: "#fbbf24", bad: "#fb7185",
    blue: "#60a5fa", purple: "#c084fc", cyan: "#22d3ee"
};

const style = {
    table: `border-collapse:collapse;background:${COLORS.bg};color:${COLORS.text};font:12px/1.35 monospace;min-width:980px`,
    th: `padding:5px 8px;border:1px solid ${COLORS.line};background:${COLORS.panel};color:${COLORS.cyan};text-align:right`,
    td: `padding:4px 8px;border:1px solid ${COLORS.line};text-align:right;white-space:nowrap`,
    left: `padding:4px 8px;border:1px solid ${COLORS.line};text-align:left;white-space:nowrap`
};

function escapeHtml(value) {
    return String(value === undefined ? "-" : value)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function number(value) {
    value = Number(value || 0);
    if (Math.abs(value) >= 1000000) return (value / 1000000).toFixed(2) + "M";
    if (Math.abs(value) >= 1000) return (value / 1000).toFixed(1) + "k";
    return String(Math.round(value * 100) / 100);
}

function color(value, tone) {
    return `<span style="color:${COLORS[tone] || tone}">${escapeHtml(value)}</span>`;
}

function bar(value, max, tone = "good") {
    let ratio = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
    let width = Math.round(ratio * 10);
    return `<span style="color:${COLORS[tone]}">${"█".repeat(width)}</span><span style="color:${COLORS.line}">${"░".repeat(10 - width)}</span>`;
}

function sumStore(room, resourceType) {
    let total = 0;
    for (let object of [room.storage, room.terminal, room.factory]) {
        if (object) total += object.store.getUsedCapacity(resourceType) || 0;
    }
    return total;
}

function unitsForRoom(roomName) {
    return Object.values(Game.creeps).filter(creep => creep.memory.roomName == roomName);
}

function aggregate(units, keyFn) {
    let output = {};
    for (let unit of units) {
        let key = keyFn(unit) || "idle";
        output[key] = (output[key] || 0) + 1;
    }
    return output;
}

function pairs(map) {
    return Object.keys(map).sort((a, b) => map[b] - map[a] || a.localeCompare(b))
        .map(key => `${escapeHtml(key)} ${color(map[key], "blue")}`).join(" &nbsp; ");
}

function plainPairs(map) {
    return Object.keys(map).sort((a, b) => map[b] - map[a] || a.localeCompare(b))
        .map(key => `${key}:${map[key]}`).join(", ");
}

function taskName(unit) {
    let tasks = unit.memory.tasks || [];
    let task = tasks[tasks.length - 1];
    return task && task.taskName || "idle";
}

function roomResources(room) {
    let resources = {};
    for (let object of [room.storage, room.terminal, room.factory]) {
        if (!object) continue;
        // Store prototypes contain enumerable helper methods in this codebase;
        // own keys are the actual resource types.
        for (let resourceType of Object.keys(object.store)) {
            resources[resourceType] = (resources[resourceType] || 0) + object.store[resourceType];
        }
    }
    return resources;
}

function header(title) {
    let health = Memory.codeHealth || {};
    let average = Number(health.averageCpu || 0);
    let longTerm = health.cpuLongTerm || {};
    let avgTone = average <= Game.cpu.limit ? "good" : average <= Game.cpu.limit * 1.2 ? "warn" : "bad";
    return `<div style="background:${COLORS.bg};color:${COLORS.text};padding:8px 10px;border:1px solid ${COLORS.line};font:12px/1.5 monospace">`
        + `<b style="color:${COLORS.cyan};font-size:14px">▣ ${escapeHtml(title)}</b> &nbsp; tick ${Game.time}`
        + ` &nbsp; CPU ${color(Game.cpu.getUsed().toFixed(2), "blue")}/${Game.cpu.limit}`
        + ` &nbsp; avg ${color(average.toFixed(2), avgTone)}`
        + (longTerm.last1000 ? ` &nbsp; ~1k ${color(Number(longTerm.last1000.average).toFixed(2), longTerm.last1000.average <= Game.cpu.limit ? "good" : "warn")}` : "")
        + (longTerm.last10000 ? ` &nbsp; ~10k ${color(Number(longTerm.last10000.average).toFixed(2), longTerm.last10000.average <= Game.cpu.limit ? "good" : "warn")}` : "")
        + ` &nbsp; bucket ${color(Game.cpu.bucket, Game.cpu.bucket >= 6000 ? "good" : "warn")}`
        + ` &nbsp; creeps ${Object.keys(Game.creeps).length}`
        + ` &nbsp; PC ${Object.values(Game.powerCreeps).filter(pc => pc.ticksToLive).length}`
        + ` &nbsp; errors <span title="last error tick: ${escapeHtml(health.lastErrorTick || "none")}">${color(health.errorCount || 0, health.lastErrorTick && health.lastErrorTick > Game.time - 20 ? "bad" : "good")}</span></div>`;
}

function moduleStatus() {
    let profile = global.RUNTIME_PROFILE || {};
    let features = Object.keys(global.CPU_FEATURES || {});
    let enabled = features.filter(name => isCpuFeatureEnabled(name));
    let dormant = features.filter(name => !isCpuFeatureEnabled(name));
    let detailsStyle = `background:${COLORS.panel};color:${COLORS.text};border:1px solid ${COLORS.line};padding:5px 8px;font:12px/1.5 monospace;max-width:900px`;
    return `<details style="${detailsStyle}"><summary style="cursor:pointer;color:${COLORS.cyan}">▸ Modules & feature gates</summary>`
        + `<div>uploaded ${color(profile.uploadedModules || "-", "blue")} · restored snapshot ${color(profile.restoredSnapshotModules || "-", "good")}</div>`
        + `<div>enabled: ${escapeHtml(enabled.join(", ") || "none")}</div>`
        + `<div style="color:${COLORS.dim}">dormant: ${escapeHtml(dormant.join(", ") || "none")}</div>`
        + `<div style="color:${COLORS.warn}">excluded: ${escapeHtml((profile.intentionallyExcluded || []).join(", ") || "none")}</div></details>`;
}

function overview() {
    let profile = (Memory.codeHealth && Memory.codeHealth.phases && Memory.codeHealth.phases.roomDetails) || {};
    let rooms = Object.values(Game.rooms).filter(room => room.controller && room.controller.my)
        .sort((a, b) => a.name.localeCompare(b.name));
    let rows = rooms.map(room => {
        let units = unitsForRoom(room.name);
        let hostiles = room.find(FIND_HOSTILE_CREEPS).length;
        let rclProgress = room.controller.level == 8 ? 100 : room.controller.progress / room.controller.progressTotal * 100;
        let storageUsed = room.storage ? room.storage.store.getUsedCapacity() : 0;
        let storageCap = room.storage ? room.storage.store.getCapacity() : 0;
        let tone = hostiles ? "bad" : room.energyAvailable < room.energyCapacityAvailable * 0.25 ? "warn" : "good";
        let roles = aggregate(units, unit => unit.memory.role || "unknown");
        let tasks = aggregate(units, taskName);
        let hover = `Terminal ${number(room.terminal && room.terminal.store.getUsedCapacity())} | Power ${number(sumStore(room, RESOURCE_POWER))} | OPS ${number(sumStore(room, RESOURCE_OPS))} | Roles ${plainPairs(roles)} | Tasks ${plainPairs(tasks)}`;
        return `<tr>`
            + `<td style="${style.left};color:${COLORS[tone]}"><details><summary style="cursor:pointer"><b>${room.name}</b></summary><div style="color:${COLORS.dim};padding:4px 0;white-space:normal;max-width:360px">${escapeHtml(hover)}</div></details></td>`
            + `<td style="${style.td}">${room.controller.level} ${bar(rclProgress, 100, "purple")}</td>`
            + `<td style="${style.td}">${number(room.energyAvailable)}/${number(room.energyCapacityAvailable)}</td>`
            + `<td style="${style.td}">${number(sumStore(room, RESOURCE_ENERGY))}</td>`
            + `<td style="${style.td}">${number(storageUsed)}/${number(storageCap)}</td>`
            + `<td style="${style.td}">${units.length} <span style="color:${COLORS.dim}">(+${units.filter(unit => unit.spawning).length})</span></td>`
            + `<td style="${style.td};color:${hostiles ? COLORS.bad : COLORS.good}">${hostiles}</td>`
            + `<td style="${style.td}">${profile[room.name] === undefined ? "-" : Number(profile[room.name]).toFixed(3)}</td>`
            + `</tr>`;
    }).join("");
    let table = `<table style="${style.table};min-width:760px"><thead><tr>`
        + ["Room ⓘ", "RCL", "Hive energy", "Total energy", "Storage", "Creeps (+spawn)", "Hostiles", "profile CPU"]
            .map((name, index) => `<th style="${index ? style.th : style.th + ";text-align:left"}">${name}</th>`).join("")
        + `</tr></thead><tbody>${rows}</tbody></table>`;
    return header("Screeps Room Dashboard") + table + moduleStatus()
        + `<div style="color:${COLORS.dim};font:11px monospace">click a room name for secondary resources/roles/tasks · detail: dash("ROOM") · profile CPU is the latest 100-tick sample</div>`;
}

function roomDetail(roomName) {
    let room = Game.rooms[roomName];
    if (!room) return header("Room Detail") + `<div style="color:${COLORS.bad}">No vision for ${escapeHtml(roomName)}</div>`;
    let units = unitsForRoom(roomName);
    let roles = aggregate(units, unit => unit.memory.role || "unknown");
    let tasks = aggregate(units, taskName);
    let resources = roomResources(room);
    let resourceRows = Object.keys(resources).sort((a, b) => resources[b] - resources[a])
        .map(resourceType => `<tr><td style="${style.left}">${escapeHtml(resourceType)}</td><td style="${style.td};color:${COLORS.good}">${number(resources[resourceType])}</td></tr>`).join("");
    let unitRows = units.sort((a, b) => (a.memory.role || "").localeCompare(b.memory.role || "") || a.name.localeCompare(b.name))
        .map(unit => {
            let current = (unit.memory.tasks || []).slice(-1)[0] || {};
            let ttlTone = unit.spawning || unit.ticksToLive > 250 ? "good" : unit.ticksToLive > 80 ? "warn" : "bad";
            let target = current.roomName || current.flagName || current.id || "-";
            let shortTarget = target.length > 16 ? target.slice(0, 13) + "…" : target;
            let taskDetail = `room ${current.roomName || "-"} · id ${current.id || "-"} · pos ${current.x === undefined ? "-" : current.x + "," + current.y} · register ${current.regFun || "-"}`;
            return `<tr><td style="${style.left}">${escapeHtml(unit.name)}</td>`
                + `<td style="${style.left}">${escapeHtml(unit.memory.role || "unknown")}</td>`
                + `<td style="${style.td}">${color(unit.spawning ? "spawn" : unit.ticksToLive, ttlTone)}</td>`
                + `<td style="${style.left}"><details><summary style="cursor:pointer">${escapeHtml(current.taskName || "idle")}</summary><div style="color:${COLORS.dim};white-space:normal;max-width:420px">${escapeHtml(taskDetail)}</div></details></td>`
                + `<td style="${style.left}">${escapeHtml(shortTarget)}</td>`
                + `<td style="${style.td}">${number(unit.store.getUsedCapacity())}/${number(unit.store.getCapacity())}</td></tr>`;
        }).join("");
    let controller = room.controller;
    let summary = `<table style="${style.table};min-width:760px"><tbody>`
        + `<tr><th style="${style.th};text-align:left">Room</th><td style="${style.left}">${room.name}</td><th style="${style.th}">RCL</th><td style="${style.td}">${controller ? controller.level : "-"}</td><th style="${style.th}">Hostiles</th><td style="${style.td}">${room.find(FIND_HOSTILE_CREEPS).length}</td></tr>`
        + `<tr><th style="${style.th};text-align:left">Roles</th><td style="${style.left}" colspan="5">${pairs(roles) || "-"}</td></tr>`
        + `<tr><th style="${style.th};text-align:left">Current tasks</th><td style="${style.left}" colspan="5">${pairs(tasks) || "-"}</td></tr>`
        + `</tbody></table>`;
    let resourceTable = `<table style="${style.table};min-width:420px"><thead><tr><th style="${style.th};text-align:left">Resource</th><th style="${style.th}">Amount</th></tr></thead><tbody>${resourceRows || `<tr><td style="${style.left}">empty</td><td style="${style.td}">0</td></tr>`}</tbody></table>`;
    let unitTable = `<table style="${style.table};min-width:880px"><thead><tr>`
        + ["Creep", "Role", "TTL", "Current task", "Target", "Store"].map((name, index) => `<th style="${index < 2 || index == 3 || index == 4 ? style.th + ";text-align:left" : style.th}">${name}</th>`).join("")
        + `</tr></thead><tbody>${unitRows || `<tr><td style="${style.left}" colspan="6">no creeps assigned to this room</td></tr>`}</tbody></table>`;
    let sectionStyle = `background:${COLORS.panel};color:${COLORS.cyan};border:1px solid ${COLORS.line};padding:5px 8px;font:12px monospace;max-width:880px`;
    let collapsibleTasks = `<details style="${sectionStyle}"><summary style="cursor:pointer">▸ Creep task details (${units.length})</summary>${unitTable}</details>`;
    let collapsibleResources = `<details style="${sectionStyle}"><summary style="cursor:pointer">▸ Resource details (${Object.keys(resources).length} types)</summary>${resourceTable}</details>`;
    return header(`Room ${roomName}`) + summary + collapsibleTasks + collapsibleResources
        + `<div style="color:${COLORS.dim};font:11px monospace">overview: dash()</div>`;
}

let dashboard = {
    show(roomName) {
        let output = roomName ? roomDetail(roomName) : overview();
        // Since the Screeps console security update, console.log escapes HTML.
        // All dynamic values above are escaped before using the explicit rich
        // output API. Older servers receive a compact readable text fallback.
        if(typeof console.logUnsafe == "function")console.logUnsafe(output);
        else console.log(output.replace(/<[^>]*>/g, " ").replace(/\s+/g, " "));
        return `dashboard rendered${roomName ? ": " + roomName : ""}`;
    }
};

global.ConsoleDashboard = dashboard;
global.dash = roomName => dashboard.show(roomName);
