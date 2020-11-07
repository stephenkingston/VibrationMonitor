from multiprocessing import Process, Queue
import mqttBroker
import flaskServer
import webSockets

clientDataQueue = Queue()

if __name__ == "__main__":
    mqttProcess = Process(target=mqttBroker.MQTTProcess, args=(1, clientDataQueue))
    serverProcess = Process(target=flaskServer.runServer)
    websocketsProcess = Process(target=webSockets.runWebSockets, args=(1, clientDataQueue))

    mqttProcess.start()
    serverProcess.start()
    websocketsProcess.start()
