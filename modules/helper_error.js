

let pro_err={
    // lastTick:-1,
    errList:[],
    print:0,
    capture (error,message) {
        let data = error && error.stack || String(error)
        if(message)data = "\n"+message+"\n"+data
        pro_err.errList.push(data+"\n\n**************\n")
    },
    catchError (func,message){
        try{
            return func()
        }catch (e) {
            // if(Game.time!=pro_err.lastTick)pro_err.errList = []
            // if(Game.creeps[message])Game.creeps[message].suicide()
            pro_err.capture(e,message)
        }
    },
    runEach (list, func, getMessage = value => value && value.name) {
        for (let value of list) {
            try {
                func(value)
            } catch (error) {
                pro_err.capture(error, getMessage(value))
            }
        }
    },
    runEachProfiled (list, func, getKey, output) {
        for (let value of list) {
            let start = Game.cpu.getUsed();
            try {
                func(value)
            } catch (error) {
                pro_err.capture(error, value && value.name)
            }
            let key = getKey(value);
            output[key] = (output[key] || 0) + Game.cpu.getUsed() - start;
        }
    },
    /**
     * 落盘错误并限流打印。
     *
     * 原实现在 pro_err.print === 0 时 `throw new Error(tmp)`，而调用点
     * （main.js:292）位于 HelperCpuUsed.exec / recordLongTerm / updateCodeHealth /
     * Memory.stats 之前——一抛就把这些收尾逻辑整 tick 跳过，CPU 遥测与 stats 出现
     * 空洞；另有 `if(!tmp.length)` 分支在此处恒不可达（此时 tmp.length >= 1）。
     * 现在统一为「记录 + 限流 console.log」，不再抛出，因此调用点不需要挪动。
     */
    throwAllError () {
        if(!pro_err.errList.length)return;
        let tmp = pro_err.errList;
        pro_err.errList = [];
        Memory.codeHealth = Memory.codeHealth || {};
        Memory.codeHealth.lastErrorTick = Game.time;
        Memory.codeHealth.errorCount = (Memory.codeHealth.errorCount || 0) + tmp.length;
        Memory.codeHealth.lastError = String(tmp[0]).slice(0, 800);
        // 限流：每 10 次错误打印一次，避免刷屏
        pro_err.print += 1;
        if(pro_err.print > 10) pro_err.print = 1;
        if(pro_err.print === 1) console.log(tmp);
    },
}

global.HelperError=pro_err
