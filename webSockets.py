import asyncio
import websockets
from functools import partial
import os


async def getFileHandle(file_path):
    try:
        os.remove(file_path)
    except Exception as e:
        pass
    writeFlag = False
    file_handle = open(file_path, 'a')
    return file_handle


async def commandhandler(websocket, path, commandQueue):
    print("Started CommandHandler server..")
    while True:
        command = await websocket.recv()
        print(command)
        if command == "record":
            commandQueue.put("record")
            await websocket.send("Started Recording")
        if command == "stop":
            commandQueue.put("stop")
            await websocket.send("Stopped Recording")


async def channel1handler(websocket, path, commandQueue, dataQueue):
    print("Started Channel1 server..")
    filename1 = 'static/record_channel1.csv'
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
                pass
        await asyncio.sleep(0.0001)


def runWebSockets(a, commandQueue, channel1queue):
    filename1 = 'record_channel1.csv'
    filename2 = 'record_channel2.csv'
    filename3 = 'record_channel3.csv'
    try:
        os.remove(filename1)
        os.remove(filename2)
        os.remove(filename3)
    except Exception as e:
        pass

    file_handle2 = open("static/" + filename2, 'a')
    file_handle3 = open("static/" + filename3, 'a')

    channel1QueueHandler = partial(channel1handler, commandQueue=commandQueue, dataQueue=channel1queue)
    commandQueueHandler = partial(commandhandler, commandQueue=commandQueue)
    channel1Server = websockets.serve(channel1QueueHandler, "127.0.0.1", 5678)
    commandServer = websockets.serve(commandQueueHandler, "127.0.0.1", 5679)
    asyncio.get_event_loop().run_until_complete(channel1Server)
    asyncio.get_event_loop().run_until_complete(commandServer)
    asyncio.get_event_loop().run_forever()
