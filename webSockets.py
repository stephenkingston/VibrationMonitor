import asyncio
import websockets
from functools import partial
import os

WEBSOCKETS_PORT1 = 1111
WEBSOCKETS_PORT2 = 2222
WEBSOCKETS_PORT3 = 3333
WEBSOCKETS_COMMAND_PORT = 4444


async def getFileHandle(file_path):
    try:
        os.remove(file_path)
    except Exception as e:
        pass
    file_handle = open(file_path, 'a')
    return file_handle


async def commandHandler(websocket, path, c1prop, c2prop ,c3prop):
    print("Started CommandHandler server..")
    while True:
        command = await websocket.recv()
        print(command)
        if command == "record":
            c1prop.put("record")
            c2prop.put("record")
            c3prop.put("record")
            await websocket.send("Started Recording")
        if command == "stop":
            c1prop.put("stop")
            c2prop.put("stop")
            c3prop.put("stop")
            await websocket.send("Stopped Recording")


async def channelHandler(websocket, path, filepath, commandQueue, dataQueue):
    print("Started Channel server..")
    filename1 = filepath
    file_handle1 = None
    writeFlag = False

    while True:
        while not dataQueue.empty():
            if not commandQueue.empty():
                command = commandQueue.get()
                if command == "record":
                    writeFlag = True
                    file_handle1 = await getFileHandle(filename1)
                elif command == "stop":
                    file_handle1.close()
                    writeFlag = False
            try:
                data = dataQueue.get()
                if writeFlag:
                    file_handle1.write(data)
                await websocket.send(data)
            except Exception as e:
                print(e)
        await asyncio.sleep(0.0001)


def runWebSockets(port, dataQueue, commandPropQueue, filepath):
    try:
        os.remove(filepath)
    except Exception as e:
        print(e)
        pass

    channelQueueHandler = partial(channelHandler, filepath=filepath, commandQueue=commandPropQueue, dataQueue=dataQueue)
    channel1Server = websockets.serve(channelQueueHandler, "127.0.0.1", port)
    asyncio.get_event_loop().run_until_complete(channel1Server)
    asyncio.get_event_loop().run_forever()


def runWebSocketsCommands(a, command1prop, command2prop, command3prop):
    commandQueueHandler = partial(commandHandler, c1prop=command1prop, c2prop=command2prop, c3prop=command3prop)
    commandServer = websockets.serve(commandQueueHandler, "127.0.0.1", WEBSOCKETS_COMMAND_PORT)
    asyncio.get_event_loop().run_until_complete(commandServer)
    asyncio.get_event_loop().run_forever()
