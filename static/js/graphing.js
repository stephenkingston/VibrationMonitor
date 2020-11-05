function getData()
	{
		return Math.random();
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


/* MQTT */

// Create a client instance
client = new Paho.MQTT.Client("127.0.0.1", 9001, "clientId");

client.onConnectionLost = onConnectionLost;
client.onMessageArrived = onMessageArrived;
const options = {
                    timeout:3,
                    onSuccess:onConnect
                };
client.connect(options);

function onConnect() {
  // Once a connection has been made, make a subscription and send a message.
  console.log("onConnect");
  client.subscribe("World");
  message = new Paho.MQTT.Message("Characters");
  message.destinationName = "World";
  client.send(message);
}

function onConnectionLost(responseObject) {
  if (responseObject.errorCode !== 0) {
    console.log("onConnectionLost:"+responseObject.errorMessage);
  }
}

function onMessageArrived(message) {
  console.log("onMessageArrived:"+message.payloadString);
}