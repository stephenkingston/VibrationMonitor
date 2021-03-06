from multiprocessing import Process, Queue
import UDPServer
import flaskServer
import webSockets


class commandPropagator:
    channel1CommandProp = Queue()
    channel2CommandProp = Queue()
    channel3CommandProp = Queue()

    clientDataQueue1 = Queue()
    clientDataQueue2 = Queue()
    clientDataQueue3 = Queue()
    commandQueue = Queue()


prop = commandPropagator()

if __name__ == "__main__":
    udpProcess_channel1 = Process(target=UDPServer.UDPProcess,
                                  args=(UDPServer.UDP_PORT_NO_1,
                                        prop.clientDataQueue1))
    udpProcess_channel2 = Process(target=UDPServer.UDPProcess,
                                  args=(UDPServer.UDP_PORT_NO_2,
                                        prop.clientDataQueue2))
    udpProcess_channel3 = Process(target=UDPServer.UDPProcess,
                                  args=(UDPServer.UDP_PORT_NO_3,
                                        prop.clientDataQueue3))

    serverProcess = Process(target=flaskServer.runServer)
    websocketProcess1 = Process(target=webSockets.runWebSockets,
                                args=(webSockets.WEBSOCKETS_PORT1, prop.clientDataQueue1,
                                      prop.channel1CommandProp, 'static/record_channel1.csv'))
    websocketProcess2 = Process(target=webSockets.runWebSockets,
                                args=(webSockets.WEBSOCKETS_PORT2, prop.clientDataQueue2,
                                      prop.channel2CommandProp, 'static/record_channel2.csv'))
    websocketProcess3 = Process(target=webSockets.runWebSockets,
                                args=(webSockets.WEBSOCKETS_PORT3, prop.clientDataQueue3,
                                      prop.channel3CommandProp, 'static/record_channel3.csv'))
    websocketCommands = Process(target=webSockets.runWebSocketsCommands,
                                args=(webSockets.WEBSOCKETS_COMMAND_PORT, prop))

    udpProcess_channel1.start()
    udpProcess_channel2.start()
    udpProcess_channel3.start()
    serverProcess.start()
    websocketProcess1.start()
    websocketProcess2.start()
    websocketProcess3.start()
    websocketCommands.start()
