import sys

def listener(event):
    print('Received key event:', event)

event = sys.stdin.read()
listener(event)
