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

let pro = {
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

