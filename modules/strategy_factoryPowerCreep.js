/**
 * powerCreep operator factory strategy
 *
 *
 * 1-5级 的 PC 的管理策略
 * Operator Factory level= OP + F + level
 * creepName = “OPF”+level 例如 OPF1,OPF2
 *
 * _.keys(Game.powerCreeps).sort()
 */

// log(POWER_INFO)
let pro = {
    getPowerCreep(room, flag) {
        if (!flag) flag = ManagerFlags.getFlagsByPrefix("OPF").filter(e => e.pos.roomName == room.name).head()
        if (flag) {
            let pc = Game.powerCreeps[flag.getNameSplit()[1]]
            if (!pc || !pc.ticksToLive || LOCAL_SHARD_NAME != (pc.shard || LOCAL_SHARD_NAME))
                return;
            return pc;
        }
    },
    getPowerFactoryLevel(room, flag) {
        let pc = pro.getPowerCreep(room, flag)
        if (!pc) return undefined
        let power = pc.powers[PWR_OPERATE_FACTORY]
        if (power)
            return power.level
    },
    execRoom(flag) {
        // Game.powerCreeps.OPF1.memory = {role: "OPF",roomName:flag.pos.roomName,tasks:[]}
        let room = flag.room;
        if (!room || !room.my) return console.log(flag.name + ":不是自己的房间")
        if (!room.powerSpawn) return console.log(flag.name + ":没有 PowerSpawn")
        let pc = Game.powerCreeps[flag.getNameSplit()[1]]//pro.getPowerCreep(room,flag);
        if (!pc) return console.log(flag.name + ":没有创建 PowerCreep")
        // spawnCooldownTime is the timestamp when spawning becomes available.
        if (!pc.ticksToLive && (!pc.spawnCooldownTime || pc.spawnCooldownTime <= Date.now())) {
            pc.spawnPowerCreep(room.powerSpawn, "OPF", flag.pos.roomName)
        }
        if (!pc.ticksToLive) return;
        if (pc.isFree()) {
            let obj = undefined
            let mainRoom = pc.mainRoom();
            if (!mainRoom) return;
            if (pc.needRenewInRoom()) pc.addRenewMainRoomTask();
            else if (pc.needGetOps()) pc.getRoomOps();
            else if (obj = pc.needOpExt()) pc.addTask(UtilsTask.task(obj, "OpExt"))
            else if (mainRoom.storage && (obj = pc.needOpStorage(mainRoom.storage))) pc.addTask(UtilsTask.task(obj, "OpStorage"))
            else if (obj = pc.needOpSource()) pc.addTask(UtilsTask.task(obj, "OpSource"))
            else if (global.StationFactory && mainRoom.factory && pc.powers[PWR_OPERATE_FACTORY] && StationFactory.needPower(mainRoom)) pc.addTask(UtilsTask.task(mainRoom.factory, "OpFactory"))
            else if (obj = pc.needOpPowerSpawn()) pc.addTask(UtilsTask.task(obj, "OpPowerSpawn"))
            // else if (obj = pc.needOpLab()) pc.addTask(UtilsTask.task(obj, "OpLab"))
            else if (obj = pc.needOpMineral()) pc.addTask(UtilsTask.task(obj, "OpMineral"))
            else if (pc.needSaveOps()) pc.saveRoomOps();
            else if (Game.time % 60 == 0 || pc.room.find(FIND_HOSTILE_CREEPS).length) {
                let obj = mainRoom.storage || mainRoom.terminal || mainRoom.powerSpawn
                if (obj) pc.addTask(UtilsTask.task(obj, "goToNearPop"));
            }
        }
    },
    exec() {
        if (Game.time % 3 != 0) return;
        ManagerFlags.getFlagsByPrefix("OPF")
            .forEach(flag => HelperError.catchError(() => pro.execRoom(flag)));
    }
}


global.StrategyFactoryPowerCreep = pro;
