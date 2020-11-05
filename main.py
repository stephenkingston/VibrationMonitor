import multiprocessing
import mqttBroker
import flaskServer

if __name__ == "__main__":
    mqttProcess = multiprocessing.Process(target=mqttBroker.MQTTProcess)
    serverProcess = multiprocessing.Process(target=flaskServer.runServer)

    mqttProcess.start()
    serverProcess.start()
