from owrx.config import Config
from owrx.color import ColorCache
from datetime import datetime, timedelta
from ipaddress import ip_address
import threading
import re

import logging

logger = logging.getLogger(__name__)


class TooManyClientsException(Exception):
    pass


class BannedClientException(Exception):
    pass


class ClientRegistry(object):
    sharedInstance = None
    creationLock = threading.Lock()

    @staticmethod
    def getSharedInstance():
        with ClientRegistry.creationLock:
            if ClientRegistry.sharedInstance is None:
                ClientRegistry.sharedInstance = ClientRegistry()
        return ClientRegistry.sharedInstance

    def __init__(self):
        self.clients = []
        self.bans = {}
        self.chat = {}
        self.chatCount = 1
        self.chatColors = ColorCache()
        self.chatLock = threading.Lock()
        Config.get().wireProperty("max_clients", self._checkClientCount)
        super().__init__()

    def broadcast(self):
        n = self.clientCount()
        for c in self.clients:
            c.write_clients(n)

    def addClient(self, client):
        pm = Config.get()
        if self.isBanned(client.conn.handler):
            raise BannedClientException()
        elif len(self.clients) >= pm["max_clients"]:
            raise TooManyClientsException()
        self.clients.append(client)
        self.broadcast()

    def clientCount(self):
        return len(self.clients)

    def removeClient(self, client):
        try:
            if client in self.chat:
                del self.chat[client]
            self.clients.remove(client)
        except ValueError:
            pass
        self.broadcast()

    def _checkClientCount(self, new_count):
        for client in self.clients[new_count:]:
            logger.debug("closing one connection...")
            client.close()

    # Broadcast chat message to all connected clients.
    def broadcastChatMessage(self, client, text: str, name: str = None):
        # If chat disabled, ignore messages
        pm = Config.get()
        if not pm["allow_chat"]:
            return
        # Make sure there are no race conditions
        with self.chatLock:
            if name is not None:
                # Names can only include alphanumerics
                name = re.sub("\W+", "", name)
                # Cannot have duplicate names
                if client not in self.chat or name != self.chat[client]["name"]:
                    for c in self.chat:
                        if name == self.chat[c]["name"]:
                            name = None
                            break
            # If we have seen this client chatting before...
            if client in self.chat:
                # Rename existing client as needed, keep color
                curname = self.chat[client]["name"]
                color   = self.chat[client]["color"]
                if not name or name == curname:
                    name = curname
                else:
                    self.chatColors.rename(curname, name)
                    self.chat[client]["name"] = name
            else:
                # Create name and color for a new client
                name  = "User%d" % self.chatCount if not name else name
                color = self.chatColors.getColor(name)
                self.chat[client] = { "name": name, "color": color }
                self.chatCount = self.chatCount + 1

        # Broadcast message to all clients
        for c in self.clients:
            c.write_chat_message(name, text, color)

    # Broadcast administrative message to all connected clients.
    def broadcastAdminMessage(self, text: str):
        for c in self.clients:
            c.write_log_message(text)

    # Get client IP address from the handler.
    def getIp(self, handler):
        ip = handler.client_address[0]
        # If address private and there is X-Forwarded-For header...
        if ip_address(ip).is_private and hasattr(handler, "headers"):
            if "x-forwarded-for" in handler.headers:
                ip = handler.headers['x-forwarded-for'].split(',')[0]
        # Done
        return ip

    # List all active and banned clients.
    def listAll(self):
        result = []
        # List active clients
        for c in self.clients:
            entry = {
                "ts"   : c.conn.startTime,
                "ip"   : self.getIp(c.conn.handler),
                "ban"  : False
            }
            if c.sdr is not None:
                entry["sdr"]  = c.sdr.getName()
                entry["band"] = c.sdr.getProfileName()
            result.append(entry)
        # Flush out stale bans
        self.expireBans()
        # List banned clients
        for ip in self.bans:
            result.append({
                "ts"  : self.bans[ip],
                "ip"  : ip,
                "ban" : True
            })
        # Done
        return result

    # Ban a client, by IP, for given number of minutes.
    def banIp(self, ip: str, minutes: int):
        self.expireBans()
        self.bans[ip] = datetime.now() + timedelta(minutes=minutes)
        banned = []
        for c in self.clients:
            if ip == self.getIp(c.conn.handler):
                banned.append(c)
        for c in banned:
            try:
                c.close()
            except:
                logger.exception("exception while banning %s" % ip)

    # Unban a client, by IP.
    def unbanIp(self, ip: str):
        if ip in self.bans:
            del self.bans[ip]

    # Check if given IP is banned at the moment.
    def isBanned(self, handler):
        ip = self.getIp(handler)
        return ip in self.bans and datetime.now() < self.bans[ip]

    # Delete all expired bans.
    def expireBans(self):
        now = datetime.now()
        old = [ip for ip in self.bans if now >= self.bans[ip]]
        for ip in old:
            del self.bans[ip]
