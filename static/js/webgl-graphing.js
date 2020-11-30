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
        xRange: { min: 0, max: 50 }, //5 * 1000
        yRange: { min: -10, max: +20},
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

    function update(points_all) {
        const time = performance.now();
        console.log(points_all);
        let points = points_all.split(',');

        points.forEach((point, index) => {
            dataSin.push({ x: pointCount, y: (+point) });
            pointCount++;
        });
        console.log(dataSin);
        chart1.update();
        chart2.update();
        chart3.update();
    }

    chart1.options.realTime = true;
    chart2.options.realTime = true;

    /* WebSockets */

    var ws = new WebSocket("ws://127.0.0.1:5678/");

    ws.onmessage = function (event) {
            console.log(event.data);
            update(bin2string(event.data));
    };

    ws.connected = function () {
        console.log("WebSockets: Connected")
    }

    function bin2string(array){
	var result = "";
	for(var i = 0; i < array.length; ++i)
	{
	    if (i === 0 || i === 1 || i === array.length - 1)
	    {}
	    else
	    {
	        result+= array[i];
	    }
	}
	return result;
    }
//const ev = setInterval(update, 20);

//    document.getElementById('stop-btn').addEventListener('click', function () {
//        clearInterval(ev);
//    });
//    document.getElementById('follow-btn').addEventListener('click', function () {
//        chart.options.realTime = true;
//    });
}