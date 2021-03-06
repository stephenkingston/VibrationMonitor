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

    const channelOne = [];
	const channelTwo = [];
	const channelThree = [];
    const dataCos = [];
    const chart1 = new TimeChart(channel1, {
        // debugWebGL: true,
        //forceWebGL1: true,
        baseTime: Date.now() - performance.now(),
        series: [
            {
                name: 'Channel 1 Accelerometer',
                data: channelOne,
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
                data: channelTwo,
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
                data: channelThree,
                color: 'blue',
            },
        ],
        xRange: { min: 0, max: 5*1000 }, //5 * 1000
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

    let points1Count = 0;
	let points2Count = 0;
	let points3Count = 0;
    let flagCount = 0;

    let x = 0;

    function updateChart1(points_all) {
        let points = points_all.split(',');

        points.forEach((point, index) => {
            channelOne.push({ x: points1Count, y: (+point) });
            points1Count++;
        });
        chart1.update();
    }

    function updateChart2(points_all) {
        let points = points_all.split(',');

        points.forEach((point, index) => {
            channelTwo.push({ x: points2Count, y: (+point) });
            points2Count++;
        });
        chart2.update();
    }

    function updateChart3(points_all) {
        let points = points_all.split(',');

        points.forEach((point, index) => {
            channelThree.push({ x: points3Count, y: (+point) });
            points3Count++;
        });
        chart3.update();
    }

    chart1.options.realTime = true;
    chart2.options.realTime = true;
	chart3.options.realTime = true;

    /* WebSockets */

    var ws_channel1 = new WebSocket("ws://127.0.0.1:1111/");
	var ws_channel2 = new WebSocket("ws://127.0.0.1:2222/");
	var ws_channel3 = new WebSocket("ws://127.0.0.1:3333/");
    var ws_commandChannel = new WebSocket("ws://127.0.0.1:4444");

    ws_channel1.onmessage = function (event) {
        if (readSlider.checked)
        {
             updateChart1(event.data);
        }
    };
	
	ws_channel2.onmessage = function (event) {
        if (readSlider.checked)
        {
             updateChart2(event.data);
        }
    };
	
	ws_channel3.onmessage = function (event) {
        if (readSlider.checked)
        {
             updateChart3(event.data);
        }
    };

    ws_channel1.onopen = function () {
        console.log("WebSockets Channel 1: Connected");
    }
	ws_channel2.onopen = function () {
        console.log("WebSockets Channel 2: Connected");
    }
	ws_channel3.onopen = function () {
        console.log("WebSockets Channel 3: Connected");
    }

    ws_commandChannel.onopen = function () {
        console.log("CommandChannel: Connected");
        ws_commandChannel.send("Hello Server");
    }

    ws_channel1.onclose = function () {
        console.log("WebSockets Channel 1: Disconnected, Reconnecting...");
        setTimeout(function() {
          ws_channel1 = new WebSocket("ws://127.0.0.1:1111/");
        }, 1000);
    }
	ws_channel2.onclose = function () {
        console.log("WebSockets Channel 2: Disconnected, Reconnecting...");
        setTimeout(function() {
          ws_channel2 = new WebSocket("ws://127.0.0.1:2222/");
        }, 1000);
    }
	ws_channel3.onclose = function () {
        console.log("WebSockets Channel 3: Disconnected, Reconnecting...");
        setTimeout(function() {
          ws_channel3 = new WebSocket("ws://127.0.0.1:3333/");
        }, 1000);
    }

    ws_commandChannel.onclose = function () {
        console.log("CommandChannel: Disconnected, Reconnecting...");
        setTimeout(function() {
          ws_commandChannel = new WebSocket("ws://127.0.0.1:4444/");
        }, 1000);
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

    setInterval( function() { sendCommandToServer("Looking good from client!"); }, 100000 );

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