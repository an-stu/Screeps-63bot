

let pro_err={
    // lastTick:-1,
    errList:[],
    print:0,
    catchError (func,message){
        try{
            return func()
        }catch (e) {
            // if(Game.time!=pro_err.lastTick)pro_err.errList = []
            // if(Game.creeps[message])Game.creeps[message].suicide()
            let data = e.stack
            if(message)data = "\n"+message+"\n"+e.stack
            pro_err.errList.push(data+"\n\n**************\n")
        }
    },
    throwAllError () {
        if(pro_err.errList.length){
            let tmp = pro_err.errList;
            pro_err.errList = [];
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
