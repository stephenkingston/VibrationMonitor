function getData()
{
    let a = (Math.random() - 0.5) * 4;
    return a;
}

var layout1 = {
  title: {
    text:'VIBRATION CHANNEL 1',
    font: {
      family: 'Bahnschrift',
      size: 18,
    },
    xref: 'paper',
    x: 0.05,
  },
  xaxis: {
    title: {
      text: 'Time (seconds)',
      font: {
        family: 'Tahoma',
        size: 15,
        color: '#7f7f7f'
      }
    },
  },
  yaxis: {
    title: {
      text: 'Acceleration (×g) m/s²',
      font: {
        family: 'Tahoma',
        size: 15,
        color: '#7f7f7f'
      }
    }
  },
  margin: {
    l: 70,
    r: 40,
    b: 60,
    t: 60
  },
};

var config = {responsive: true}

Plotly.newPlot('channel1', [{
    y:[getData()],
	type: 'line'
}], layout1, config);

var counter = 0;

setInterval(function(){
	Plotly.extendTraces('channel1', {y:[[getData()]]}, [0]);
	counter++;

	if (counter > 250)
	{
		Plotly.relayout('channel1', {
			xaxis: {
			    title: {
                text: 'Time (seconds)',
                font: {
                    family: 'Tahoma',
                    size: 15,
                    color: '#7f7f7f'
                    }
                },
				range: [counter - 250, counter]
			}
		});
	}
}, 10);

/* Channel 2 */

var layout2 = {
  title: {
    text:'VIBRATION CHANNEL 2',
    font: {
      family: 'Bahnschrift',
      size: 18,
    },
    xref: 'paper',
    x: 0.05,
  },
  xaxis: {
    title: {
      text: 'Time (seconds)',
      font: {
        family: 'Tahoma',
        size: 15,
        color: '#7f7f7f'
      }
    },
  },
  yaxis: {
    title: {
      text: 'Acceleration (×g) m/s²',
      font: {
        family: 'Tahoma',
        size: 15,
        color: '#7f7f7f'
      }
    }
  },
    margin: {
    l: 70,
    r: 40,
    b: 60,
    t: 60
  },
};

Plotly.newPlot('channel2', [{
    y:[getData()],
	type: 'line'
}], layout2, config);

var counter2 = 0;

setInterval(function(){
	Plotly.extendTraces('channel2', {y:[[getData()]]}, [0]);
	counter2++;

	if (counter2 > 250)
	{
		Plotly.relayout('channel2', {
			xaxis: {
			    title: {
                text: 'Time (seconds)',
                font: {
                    family: 'Tahoma',
                    size: 15,
                    color: '#7f7f7f'
                    }
                },
				range: [counter2 - 250, counter2]
			}
		});
	}
}, 10);


/* Channel 3 */

var layout3 = {
  title: {
    text:'VIBRATION CHANNEL 3',
    font: {
      family: 'Bahnschrift',
      size: 18,
    },
    xref: 'paper',
    x: 0.05,
  },
  xaxis: {
    title: {
      text: 'Time (seconds)',
      font: {
        family: 'Tahoma',
        size: 15,
        color: '#7f7f7f'
      }
    },
  },
  yaxis: {
    title: {
      text: 'Acceleration (×g) m/s²',
      font: {
        family: 'Tahoma',
        size: 15,
        color: '#7f7f7f'
      }
    }
  },
    margin: {
    l: 70,
    r: 40,
    b: 60,
    t: 60
  },
};

Plotly.newPlot('channel3', [{
    y:[getData()],
	type: 'line'
}], layout3, config);

var counter3 = 0;

setInterval(function(){
	Plotly.extendTraces('channel3', {y:[[getData()]]}, [0]);
	counter3++;

	if (counter3 > 250)
	{
		Plotly.relayout('channel3', {
			xaxis: {
			    title: {
                text: 'Time (seconds)',
                font: {
                    family: 'Tahoma',
                    size: 15,
                    color: '#7f7f7f'
                    }
                },
				range: [counter3 - 250, counter3]
			}
		});
	}
}, 10);

/* WebSockets */

var ws = new WebSocket("ws://127.0.0.1:5678/");

ws.onmessage = function (event) {
        console.log(event.data);
};

ws.connected = function () {
    console.log("WebSockets: Connected")
}



