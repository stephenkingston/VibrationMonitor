main();

function main() {
    const channel1 = document.getElementById('channel1');
    const channel2 = document.getElementById('channel2');
    const channel3 = document.getElementById('channel3');

    const dataSin = [];
    const dataCos = [];
    const chart1 = new TimeChart(channel1, {
        // debugWebGL: true,
        //forceWebGL1: true,
        baseTime: Date.now() - performance.now(),
        series: [
            {
                name: 'Channel 1 Accelerometer',
                data: dataSin,
                color: 'blue',
            },
        ],
        xRange: { min: 0, max: 5 * 1000 },
        yRange: { min: -2, max: +2},
        realTime: true,
        zoom: {
            x: {
                autoRange: true,
                minDomainExtent: 50,
            },
            y: {
                autoRange: true,
                minDomainExtent: 1,
            }
        },
    });

    const chart2 = new TimeChart(channel2, {
        // debugWebGL: true,
        //forceWebGL1: true,
        baseTime: Date.now() - performance.now(),
        series: [
            {
                name: 'Channel 2 Accelerometer',
                data: dataSin,
                color: 'blue',
            },
        ],
        xRange: { min: 0, max: 5 * 1000 },
        yRange: { min: -2, max: +2},
        realTime: true,
        zoom: {
            x: {
                autoRange: true,
                minDomainExtent: 50,
            },
            y: {
                autoRange: true,
                minDomainExtent: 1,
            }
        },
    });

    const chart3 = new TimeChart(channel3, {
        // debugWebGL: true,
        //forceWebGL1: true,
        baseTime: Date.now() - performance.now(),
        series: [
            {
                name: 'Channel 3 Accelerometer',
                data: dataSin,
                color: 'blue',
            },
        ],
        xRange: { min: 0, max: 5 * 1000 },
        yRange: { min: -2, max: +2},
        realTime: true,
        zoom: {
            x: {
                autoRange: true,
                minDomainExtent: 50,
            },
            y: {
                autoRange: true,
                minDomainExtent: 1,
            }
        },
    });

    let pointCount = 0;

    let x = performance.now() - 2000;
    function update() {
        const time = performance.now();
        for (; x < time * 2; x += 1) {
            const y_random = (Math.random() - 0.5) * 2;
            //const y_sin = Math.sin(x * 0.002) * 320;
            dataSin.push({ x, y: y_random });

            const y_random2 = Math.random() * 500 + 100;
            //const y_cos = Math.cos(x * 0.002) * 200;
            //dataCos.push({ x, y: y_random2 });
        }
        chart1.update();
        chart2.update();
        chart3.update();
    }

    chart1.options.realTime = true;
    chart2.options.realTime = true;
    const ev = setInterval(update, 5);
//    document.getElementById('stop-btn').addEventListener('click', function () {
//        clearInterval(ev);
//    });
//    document.getElementById('follow-btn').addEventListener('click', function () {
//        chart.options.realTime = true;
//    });
}