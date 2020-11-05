import paho.mqtt.client as mqtt
import time

BrokerHost = "localhost"
BrokerPort = 1883

client = mqtt.Client("AccelerometerData")
sensorDataTopic = "TEMPERATURE"


def receiveMessage(clientx, userdata, message):
    print(message.topic, message.payload)


def MQTTProcess():
    print("Attempting to connect to MQTT Broker...")
    client.connect(BrokerHost)
    time.sleep(1)
    client.subscribe(sensorDataTopic)
    client.publish(sensorDataTopic, "Hi there!")
    client.on_message = receiveMessage
    if client.is_connected():
        print("Connected to MQTT Broker.")
    client.loop_forever()



