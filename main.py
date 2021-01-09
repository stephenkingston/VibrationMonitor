from multiprocessing import Process, Queue
import UDPServer
import flaskServer
import webSockets

clientDataQueue = Queue()
commandQueue = Queue()

if __name__ == "__main__":
    udpProcess = Process(target=UDPServer.UDPProcess, args=(1, clientDataQueue))
    serverProcess = Process(target=flaskServer.runServer)
    websocketsProcess = Process(target=webSockets.runWebSockets, args=(1, commandQueue, clientDataQueue))

    udpProcess.start()
    serverProcess.start()
    websocketsProcess.start()
