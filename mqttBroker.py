import paho.mqtt.client as mqtt
import time

BrokerHost = "localhost"
BrokerPort = 1883

client = mqtt.Client("AccelerometerData")
sensorDataTopic = "AccelData"


def receiveMessage(clientx, queue, message):
    print(message.topic, message.payload)
    queue.put(message.payload)


def connected(clientx, userdata, flags, rc):
    if clientx.is_connected():
        print("Connected to MQTT Broker.")


def disconnected(clientx, userdata, rc):
    print("MQTT Broker disconnected. Attempting to reconnect...")
    clientx.connect(BrokerHost)


def MQTTProcess(a, queueObj):
    print("Attempting to connect to MQTT Broker...")
    try:
        client.connect(BrokerHost)
    except Exception as e:
        print("MQTT connection to broker failed. Retrying...")
        print(e)
        MQTTProcess(1, queueObj)
        time.sleep(20)

    time.sleep(1)
    client.user_data_set(queueObj)
    client.subscribe(sensorDataTopic)
    client.on_message = receiveMessage
    client.on_connect = connected

    client.loop_forever()



