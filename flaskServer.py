from flask import Flask, render_template
from flask_socketio import SocketIO, emit


app = Flask(__name__)
app.config['SECRET_KEY'] = 'secret!'
socketIO = SocketIO(app)


@socketIO.on('message')
def onMessage(message):
    print('Message: ' + str(message))
    # emit('message', "Hi, received.")
    socketIO.emit('message', "SocketIO received")


@app.route("/home")
@app.route("/")
def home():
    return render_template("index.html")


def runServer():
    socketIO.run(app)


def sendDatapointToClient(message):
    socketIO.emit('message', "SocketIO received 222", namespace='/test')
    print("Sent!!")
    print(socketIO)
