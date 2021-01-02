import asyncio
import websockets
from functools import partial


async def randomNumbers(websocket, path, queueObj):
    print("Started WebSockets server..")
    while True:
        while not queueObj.empty():
            try:
                await websocket.send(queueObj.get())
            except Exception as e:
                pass
        await asyncio.sleep(0.03)


def runWebSockets(a, queueObject):
    functionWithQueue = partial(randomNumbers, queueObj=queueObject)
    startServer = websockets.serve(functionWithQueue, "127.0.0.1", 5678)
    asyncio.get_event_loop().run_until_complete(startServer)
    asyncio.get_event_loop().run_forever()
