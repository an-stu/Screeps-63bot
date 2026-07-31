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

function taskName(unit) {
    let tasks = unit.memory.tasks || [];
    let task = tasks[tasks.length - 1];
    return task && task.taskName || "idle";
}

function roomResources(room) {
    let resources = {};
    for (let object of [room.storage, room.terminal, room.factory]) {
        if (!object) continue;
        for (let resourceType in object.store) {
            resources[resourceType] = (resources[resourceType] || 0) + object.store[resourceType];
        }
    }
    return resources;
}

function header(title) {
    let health = Memory.codeHealth || {};
    let average = Number(health.averageCpu || 0);
    let avgTone = average <= Game.cpu.limit ? "good" : average <= Game.cpu.limit * 1.2 ? "warn" : "bad";
    return `<div style="background:${COLORS.bg};color:${COLORS.text};padding:8px 10px;border:1px solid ${COLORS.line};font:12px/1.5 monospace">`
        + `<b style="color:${COLORS.cyan};font-size:14px">▣ ${escapeHtml(title)}</b> &nbsp; tick ${Game.time}`
        + ` &nbsp; CPU ${color(Game.cpu.getUsed().toFixed(2), "blue")}/${Game.cpu.limit}`
        + ` &nbsp; avg ${color(average.toFixed(2), avgTone)}`
        + ` &nbsp; bucket ${color(Game.cpu.bucket, Game.cpu.bucket >= 6000 ? "good" : "warn")}`
        + ` &nbsp; creeps ${Object.keys(Game.creeps).length}`
        + ` &nbsp; PC ${Object.values(Game.powerCreeps).filter(pc => pc.ticksToLive).length}`
        + ` &nbsp; errors ${color(health.errorCount || 0, health.errorCount ? "bad" : "good")}</div>`;
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
        return `<tr>`
            + `<td style="${style.left};color:${COLORS[tone]}"><b>${room.name}</b></td>`
            + `<td style="${style.td}">${room.controller.level} ${bar(rclProgress, 100, "purple")}</td>`
            + `<td style="${style.td}">${number(room.energyAvailable)}/${number(room.energyCapacityAvailable)}</td>`
            + `<td style="${style.td}">${number(sumStore(room, RESOURCE_ENERGY))}</td>`
            + `<td style="${style.td}">${number(storageUsed)}/${number(storageCap)}</td>`
            + `<td style="${style.td}">${number(room.terminal && room.terminal.store.getUsedCapacity())}</td>`
            + `<td style="${style.td}">${number(sumStore(room, RESOURCE_POWER))}</td>`
            + `<td style="${style.td}">${number(sumStore(room, RESOURCE_OPS))}</td>`
            + `<td style="${style.td}">${units.length}</td>`
            + `<td style="${style.td}">${units.filter(unit => unit.spawning).length}</td>`
            + `<td style="${style.td};color:${hostiles ? COLORS.bad : COLORS.good}">${hostiles}</td>`
            + `<td style="${style.td}">${profile[room.name] === undefined ? "-" : Number(profile[room.name]).toFixed(3)}</td>`
            + `</tr>`;
    }).join("");
    let table = `<table style="${style.table}"><thead><tr>`
        + ["Room", "RCL", "Hive energy", "Total energy", "Storage", "Terminal", "Power", "OPS", "Creeps", "Spawning", "Hostiles", "profile CPU"]
            .map((name, index) => `<th style="${index ? style.th : style.th + ";text-align:left"}">${name}</th>`).join("")
        + `</tr></thead><tbody>${rows}</tbody></table>`;
    return header("Screeps Room Dashboard") + table
        + `<div style="color:${COLORS.dim};font:11px monospace">detail: dash("ROOM") · profile CPU is the latest 100-tick sample · dashboard runs only when called</div>`;
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
    let controller = room.controller;
    let summary = `<table style="${style.table};min-width:760px"><tbody>`
        + `<tr><th style="${style.th};text-align:left">Room</th><td style="${style.left}">${room.name}</td><th style="${style.th}">RCL</th><td style="${style.td}">${controller ? controller.level : "-"}</td><th style="${style.th}">Hostiles</th><td style="${style.td}">${room.find(FIND_HOSTILE_CREEPS).length}</td></tr>`
        + `<tr><th style="${style.th};text-align:left">Roles</th><td style="${style.left}" colspan="5">${pairs(roles) || "-"}</td></tr>`
        + `<tr><th style="${style.th};text-align:left">Current tasks</th><td style="${style.left}" colspan="5">${pairs(tasks) || "-"}</td></tr>`
        + `</tbody></table>`;
    let resourceTable = `<table style="${style.table};min-width:420px"><thead><tr><th style="${style.th};text-align:left">Resource</th><th style="${style.th}">Amount</th></tr></thead><tbody>${resourceRows || `<tr><td style="${style.left}">empty</td><td style="${style.td}">0</td></tr>`}</tbody></table>`;
    return header(`Room ${roomName}`) + summary + resourceTable
        + `<div style="color:${COLORS.dim};font:11px monospace">overview: dash()</div>`;
}

let dashboard = {
    show(roomName) {
        let output = roomName ? roomDetail(roomName) : overview();
        console.log(output);
        return `dashboard rendered${roomName ? ": " + roomName : ""}`;
    }
};

global.ConsoleDashboard = dashboard;
global.dash = roomName => dashboard.show(roomName);

