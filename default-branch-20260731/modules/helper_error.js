

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
    throwAllError () {
        if(pro_err.errList.length){
            let tmp = pro_err.errList;
            pro_err.errList = [];
            Memory.codeHealth = Memory.codeHealth || {};
            Memory.codeHealth.lastErrorTick = Game.time;
            Memory.codeHealth.errorCount = (Memory.codeHealth.errorCount || 0) + tmp.length;
            Memory.codeHealth.lastError = String(tmp[0]).slice(0, 800);
            if(!tmp.length){
                pro_err.print=0;
            }
            if(pro_err.print){
                pro_err.print+=1;
                if(pro_err.print>10)pro_err.print=0;
                console.log(tmp);
            }
            else{
                pro_err.print+=1;
                throw new Error(tmp);
            }
        }
    },
}

global.HelperError=pro_err
