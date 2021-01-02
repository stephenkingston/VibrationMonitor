import socket
import time

UDP_IP_ADDRESS = "192.168.0.150"
UDP_PORT_NO_1 = 6789
serverSock = ''


def UDPProcess(a, queueObj):
    global serverSock
    try:
        serverSock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        serverSock.bind((UDP_IP_ADDRESS, UDP_PORT_NO_1))
    except Exception as e:
        print("UDP Server Start Failed. Retrying...")
        print(e)
        UDPProcess(1, queueObj)
        time.sleep(20)
    print("Started UDP Server Process..")

    while True:
        data, address = serverSock.recvfrom(4096)
        send_str = ''
        # print(data)
        for i in range(0, int(len(data)/6)):
            z_reg = (data[(i * 6) + 4] | data[(i * 6) + 5] << 8)
            if z_reg < 32768:
                z_g = (z_reg/32768) * 16
                send_str = send_str + str(z_g) + ","
            else:
                z_g = ((z_reg-0x10000)/32768) * 16
                send_str = send_str + str(z_g) + ","
        send_str = send_str.rstrip(",")
        queueObj.put(send_str)
        send_str = ''


