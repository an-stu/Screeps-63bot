/**
 *
 * HelperCpuUsed.show()
 *
 *
 */
global.cpuEcharts=(divName,data,data2)=>{
    return `
<div id="${divName}" style="height: 400px;width:1200px;color:#000"/>
<script>
eval($.ajax({url:"https://fastly.jsdelivr.net/npm/echarts@5/dist/echarts.min.js",async:false}).responseText);
function showCpuUsed(divName,data,data2){
var chartDom = document.getElementById(divName);
var myChart = echarts.init(chartDom, 'dark');

data = data.map(e=>e>0?e:0);
if(data[0]>data[data.length-1]*1.3){
    data = data.slice(1);
    data2 = data2.slice(1);
}

var option = {
  xAxis: {
    type: 'category'
  },
  yAxis: {
    type: 'value'
  },
  tooltip: {
    trigger: 'axis',
    axisPointer: {
      type: 'cross',
      animation: false
    }
  },
  yAxis: [
    {
      name: 'cpuUsed',
      type: 'value'
    },
    {
      name: 'bucket',
      max: 10000,
      min:0,
      type: 'value'
    }
  ],
  dataZoom: [
    {
      show: true
    }
  ],
  animation:false,
  series: [
    {
      data: data,
      type: 'line'
    },
    {
      data: data2,
      yAxisIndex: 1,
      type: 'line'
    }
  ]
};

option.backgroundColor= '#2b2b2b';
myChart.setOption(option);
};
var data = ${JSON.stringify(data)};
var data2 = ${JSON.stringify(data2)};
showCpuUsed('${divName}',data,data2)
</script>
`.replace(/[\r\n]/g, "")
// .replace("script>","c>")
}
// smooth: true,
// step: 'middle',

/**
 * Low-overhead CPU sampler.
 *
 * Sampling every tick and repeatedly slicing a 20,000-item array creates
 * avoidable allocations and garbage-collection work. Keep a small ring buffer
 * instead; sorting the ring into chronological order is only needed when the
 * user explicitly asks for a chart.
 */
let pro={
    sampleInterval: 5,
    maxSamples: 600,
    longTermBucketTicks: 100,
    longTermMaxBuckets: 100,
    cpu: new Array(600),
    bucket: new Array(600),
    cursor: 0,
    size: 0,
    shouldRun(interval, offset = 0) {
        return (Game.time + offset) % interval === 0;
    },
    series(data) {
        if (this.size < this.maxSamples) return data.slice(0, this.size);
        return data.slice(this.cursor).concat(data.slice(0, this.cursor));
    },
    average(data, count = 20) {
        let samples = Math.min(count, this.size);
        if (!samples) return 0;
        let total = 0;
        for (let i = 0; i < samples; i++) {
            let index = (this.cursor - 1 - i + this.maxSamples) % this.maxSamples;
            total += data[index] || 0;
        }
        return total / samples;
    },
    recordLongTerm(cpu) {
        let telemetry = Memory.cpuTelemetry;
        if(!telemetry || telemetry.version != 1){
            telemetry = Memory.cpuTelemetry = {
                version: 1,
                startTick: Game.time,
                lastTick: 0,
                samples: 0,
                sum: 0,
                min: cpu,
                max: cpu,
                overLimit: 0,
                bucketStart: Game.cpu.bucket,
                bucketEnd: Game.cpu.bucket,
                buckets: []
            };
        }
        if(telemetry.lastTick == Game.time)return;
        telemetry.lastTick = Game.time;
        telemetry.samples++;
        telemetry.sum += cpu;
        telemetry.min = Math.min(telemetry.min, cpu);
        telemetry.max = Math.max(telemetry.max, cpu);
        if(cpu > Game.cpu.limit)telemetry.overLimit++;
        telemetry.bucketEnd = Game.cpu.bucket;

        let id = Math.floor(Game.time / pro.longTermBucketTicks);
        let bucket = telemetry.buckets[telemetry.buckets.length - 1];
        if(!bucket || bucket.id != id){
            bucket = {id:id, samples:0, sum:0, max:0, overLimit:0};
            telemetry.buckets.push(bucket);
            if(telemetry.buckets.length > pro.longTermMaxBuckets)telemetry.buckets.shift();
        }
        bucket.samples++;
        bucket.sum += cpu;
        bucket.max = Math.max(bucket.max, cpu);
        if(cpu > Game.cpu.limit)bucket.overLimit++;
    },
    longTermSummary() {
        let telemetry = Memory.cpuTelemetry;
        if(!telemetry || !telemetry.samples)return {};
        let aggregate = count => {
            let samples = 0, sum = 0, max = 0, overLimit = 0;
            for(let index=telemetry.buckets.length-1;index>=0 && samples<count;index--){
                let bucket = telemetry.buckets[index];
                samples += bucket.samples;
                sum += bucket.sum;
                max = Math.max(max, bucket.max);
                overLimit += bucket.overLimit;
            }
            return {samples:samples, average:samples?sum/samples:0, max:max, overLimit:overLimit};
        };
        return {
            startTick: telemetry.startTick,
            samples: telemetry.samples,
            average: telemetry.sum / telemetry.samples,
            min: telemetry.min,
            max: telemetry.max,
            overLimit: telemetry.overLimit,
            bucketDelta: telemetry.bucketEnd - telemetry.bucketStart,
            last1000: aggregate(1000),
            last10000: aggregate(10000)
        };
    },
    show(){
        let output = cpuEcharts(Game.time, this.series(this.cpu), this.series(this.bucket));
        if (typeof console.logUnsafe == "function") console.logUnsafe(output);
        else console.log("CPU samples: " + this.size + ", average: " + this.average(this.cpu, this.size).toFixed(2));
    },
    exec (){
        if (!this.shouldRun(this.sampleInterval)) return;
        this.cpu[this.cursor] = Game.cpu.getUsed();
        this.bucket[this.cursor] = Game.cpu.bucket;
        this.cursor = (this.cursor + 1) % this.maxSamples;
        this.size = Math.min(this.size + 1, this.maxSamples);
    }
}

global.HelperCpuUsed=pro;

// if(cpu15t.length==15){
//     let avg = 0;
//     let pow2 = 0;
//     let pow3 = 0;
//     let max = cpu15t[0]
//     let min = cpu15t[0]
//     for(let i=0;i<15;i++){
//         let num = cpu15t[i];
//         max = Math.max(max,num)
//         min = Math.min(min,num)
//         avg += num;
//         pow2 += num*num;
//         pow3 += num*num*num;
//     }
//     avg/=15
//     pow2/=15
//     pow3/=15
//     let sigma = Math.sqrt(pow2 - avg*avg)
//     let skew = (pow3 - 3*avg*sigma*sigma - avg*avg*avg)/(sigma*sigma*sigma)
//     log(max,min,avg,sigma,skew)
