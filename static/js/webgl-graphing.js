var uploadButton = document.getElementById("uploadCSV");
var downloadButton = document.getElementById("downloadCSV");
var recordButton = document.getElementById("recordCSV");

downloadButton.disabled = true;
uploadButton.disabled = true;

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
    let flagCount = 0;

    let x = 0;

    function update(points_all) {
        if (flagCount == 0)
        {
            x = performance.now();
            flagCount = 1;
        }
        else
            flagCount++;

        let points = points_all.split(',');

        points.forEach((point, index) => {
            dataSin.push({ x: pointCount, y: (+point) });
            pointCount++;
        });
        chart1.update();
        //chart2.update();
        //chart3.update();
        if (flagCount === 20)
        {
            console.log(performance.now());
            console.log(performance.now() - x);
        }
    }

    chart1.options.realTime = true;
    chart2.options.realTime = true;

    /* WebSockets */

    var ws_channel1 = new WebSocket("ws://127.0.0.1:5678/");
    var ws_commandChannel = new WebSocket("ws://127.0.0.1:5679");

    ws_channel1.onmessage = function (event) {
        if (readSlider.checked)
        {
             update(event.data);
        }
    };

    ws_channel1.onopen = function () {
        console.log("WebSockets Channel 1: Connected");
    }

    ws_commandChannel.onopen = function () {
        console.log("CommandChannel: Connected");
        ws_commandChannel.send("Hello Server");
    }

    ws_commandChannel.onmessage = function (event) {
          if (event.data === "Started Recording")
          {
               recordButton.innerText = "Recording...";
               recordingState = true;
               recordButton.disabled = false;
               downloadButton.disabled = true;
          }
          else if (event.data === "Stopped Recording")
          {
               recordButton.innerText = "Record";
               recordingState = false;
               recordButton.disabled = false;
               downloadButton.disabled = false;
          }
          console.log(event.data);
    };

    setInterval( function() { sendCommandToServer("Hello"); }, 10000 );

    function sendCommandToServer(message) {
        console.log("message");
        if (ws_commandChannel.readyState === WebSocket.OPEN)
        {
            ws_commandChannel.send(message);
        }
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


recordButton.addEventListener('click', (event) => {
    if (recordingState == false)
    {
        recordButton.disabled = true;
        ws_commandChannel.send("record");
    }
    else
    {
        recordButton.disabled = true;
        ws_commandChannel.send("stop");
    }
});
//const ev = setInterval(update, 20);

//    document.getElementById('stop-btn').addEventListener('click', function () {
//        clearInterval(ev);
//    });
//    document.getElementById('follow-btn').addEventListener('click', function () {
//        chart.options.realTime = true;
//    });
}