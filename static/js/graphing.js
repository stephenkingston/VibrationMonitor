function getData()
{
    return Math.random()
}

Plotly.plot('chart', [{
	y:[getData()],
	type: 'line'
}]);

let counter = 0;

setInterval(function(){
	Plotly.extendTraces('chart', {y:[[getData()]]}, [0]);
	counter++;

	if (counter > 500)
	{
		Plotly.relayout('chart', {
			xaxis: {
				range: [counter - 500, counter]
			}
		});
	}
}, 10);


/* WebSockets */

//var socket = io();
//io.connect("ws://127.0.0.1:5000");
//
//socket.on('connect', function(){
//    socket.emit('message', 'SocketIO: User has connected!');
//    console.log("SocketIO: Connected");
//});
//
//
//socket.on('message', function(data){
//        console.log(data);
//});
//socket.on('disconnect', function(){});

var ws = new WebSocket("ws://127.0.0.1:5678/");

ws.onmessage = function (event) {
        console.log(event.data);
};

ws.connected = function () {
    console.log("WebSockets: Connected")
}



