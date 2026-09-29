/**
 Module: WarDamageCal
 Author: fangxm
 Date:   2020.02.04
 Usage:

 要计算tower该不该打一个creep或者creep该不该逃跑：
 let towerDamage = possibleTowerDamage(room, creep.pos);
 let break = wouldBreakDefend(creep.body, creep.pos, 你的用户名, towerDamage)
 if (break) {
     ...
 }

 这个模块是计算伤害的工具模块
 */

/**
 * 打死一只敌人需要多高的**每 tick 伤害**：把它的血（含 TOUGH 部件额外血量）
 * 摊到 BREAK_TICKS 个 tick 上，再叠加它每 tick 能奶回来的量。
 *
 * BREAK_TICKS=12 是标定值：source keeper 约 5000 血 + 17 个 TOUGH（1700），
 * 算出来 559/tick，对应 19 个 ATTACK 部件；加上抗压所需的部件后总量刚好
 * 落在 50 部件上限内，跟之前手工调好的 {ATTACK:22, HEAL:11, MOVE:17} 一致。
 */
const BREAK_TICKS = 12;

/**
 * TOUGH 部件对入射伤害的减免。
 *
 * 这个函数以前**根本没定义**却在 possibleDamage 里被调用，那条路径一走到就
 * 抛 ReferenceError。
 *
 * 未 boost 的 TOUGH 只是血更厚（100 血/部件），**不减伤**，所以按规则原样返回。
 * boost 后的减伤这里没有建模（保守起见按不减伤算，会高估受到伤害、偏保守），
 * 因为本模块现有的调用方都只看「会不会破防」，高估不会导致误判成安全。
 */
function hitsOnTough(body, damage) {
    return damage;
}

let pro = {
    /**
     * 打死一只敌人所需的每 tick 伤害（见 BREAK_TICKS 的说明）。
     *
     * 这是 `e.possibleToughBeHitsDamage(sumHeal)` 的替代实现 —— 那个方法
     * **整个代码库里根本不存在**，谁调用谁抛 TypeError：
     *   - station_sources.js 的 getOuterHarDefenseBodyConfig
     *   - strategy_defenserHighWay.js 的 getDefenseHighWayData
     * 实际后果：只要房间里看得见敌人，外矿 defenser 就**完全生不出来**
     * （W34N55 常年只剩 1 只，另一只只在「刚好没敌人」那一瞬才生得出来）。
     */
    possibleBreakDamage(creep, sumHeal) {
        let toughHits = ((creep.bodyCounts && creep.bodyCounts[TOUGH]) || 0) * 100;
        let hits = creep.hitsMax || creep.hits || 0;
        return Math.ceil((toughHits + hits) / BREAK_TICKS) + (sumHeal || 0);
    },
    /**
     * 计算点到tower的伤害
     * @param {number} dist 点到tower的距离
     */
    calTowerDamage(dist) {
        if (dist <= 5) return 600;
        else if (dist <= 20) return 600 - (dist - 5) * 30;
        else return 150;
    },

    /**
     * 计算在一个房间内一个点的tower伤害总值
     * @param {Room} room tower所在房间
     * @param {RoomPosition} pos 要计算伤害的点
     */
    possibleTowerDamage(room, pos) {
        return _.sum(room.towers, tower => {
            if (tower.store.energy < 10) return 0;
            let ratio = 1;
            if (tower.effects && tower.effects.length) tower.effects.forEach(effect => {
                if (effect.effect == PWR_OPERATE_TOWER) ratio = POWER_INFO[effect.effect].effect[effect.level];
            });
            return calTowerDamage(tower.pos.getRangeTo(pos)) * ratio;
        });
    },

    /**
     * 计算一个creep在某个位置可能受到的伤害
     * @param {BodyPartDefinition[]} body 该creep的body
     * @param {RoomPosition} pos 要计算伤害的位置
     * @param {string} username 用户名
     * @param {boolean} heal 是否计算治疗值，默认为true
     * @param {number} towerDamage tower在该位置的伤害，默认为0
     * @param {boolean} risk 计不计算威胁值（攻击范围之外的creep），默认为false
     */
    possibleDamage(body, pos, username, heal = true, towerDamage = 0, risk = false) {
        let attackers = pos.findInRange(FIND_CREEPS, risk ? 50 : 3,
            { filter: creep => creep.owner.username != username && (creep.bodyCounts[ATTACK] || creep.bodyCounts[RANGED_ATTACK]) });

        let possibleDamage = _.sum(attackers, attacker => possibleCreepDamage(attacker.body, pos.getRangeTo(attacker), risk)) + (towerDamage || 0);
        possibleDamage = hitsOnTough(body, possibleDamage);
        let possibleHeal = 0;
        if (heal) {
            let healers = pos.findInRange(FIND_CREEPS, 3, { filter: creep => creep.owner.username == username && creep.bodyCounts[HEAL] });
            possibleHeal = possibleHealHits(pos, healers);
        }
        return possibleDamage - possibleHeal;
    },

    /**
     * 计算一个creep在某个位置是否会被破防
     * @param {BodyPartDefinition[]} body 该creep的body
     * @param {RoomPosition} pos 要计算的位置
     * @param {string} username 用户名
     * @param {number} towerDamage tower在该位置的伤害，默认为0
     * @param {boolean} risk 计不计算威胁值（攻击范围之外的creep），默认为false
     */
    wouldBreakDefend(body, pos, username, towerDamage = 0, risk = false) {
        return possibleDamage(body, pos, username, true, towerDamage, risk) > 0;
    }
}

global.WarDamageCal = pro;

