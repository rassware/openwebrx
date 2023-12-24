from owrx.storage import Storage
from owrx.config import Config
from owrx.color import ColorCache
from csdr.module import LineBasedModule
from pycsdr.types import Format
from datetime import datetime
import pickle
import os
import re
import json

import logging

logger = logging.getLogger(__name__)


class TextParser(LineBasedModule):
    def __init__(self, filePrefix: str = None, service: bool = False):
        self.service   = service
        self.frequency = 0
        self.data      = bytearray(b'')
        self.filePfx   = filePrefix
        self.file      = None
        self.maxLines  = 10000
        self.cntLines  = 0
        super().__init__()

    def __del__(self):
        # Close currently open file, if any
        self.closeFile()

    def closeFile(self):
        if self.file is not None:
            try:
                logger.debug("Closing log file '%s'." % self.fileName)
                self.file.close()
                self.file = None
                # Delete excessive files from storage
                logger.debug("Performing storage cleanup...")
                Storage().cleanStoredFiles()

            except Exception as exptn:
                logger.debug("Exception closing file: %s" % str(exptn))
                self.file = None

    def newFile(self, fileName):
        self.closeFile()
        try:
            self.fileName = Storage().getFilePath(fileName + ".txt")
            logger.debug("Opening log file '%s'..." % self.fileName)
            self.file = open(self.fileName, "wb", buffering = 0)
            self.cntLines = 0

        except Exception as exptn:
            logger.debug("Exception opening file: %s" % str(exptn))
            self.file = None

    def writeFile(self, data):
        # If no file open, create and open a new file
        if self.file is None and self.filePfx is not None:
            self.newFile(Storage().makeFileName(self.filePfx+"-{0}", self.frequency))
        # If file open now...
        if self.file is not None:
            # Write new line into the file
            try:
                self.file.write(data)
            except Exception:
                pass
            # No more than maxLines per file
            self.cntLines = self.cntLines + 1
            if self.cntLines >= self.maxLines:
                self.closeFile()

    def getInputFormat(self) -> Format:
        return Format.CHAR

    def getOutputFormat(self) -> Format:
        return Format.CHAR

    def setDialFrequency(self, frequency: int) -> None:
        self.frequency = frequency

    # Compose name of this decoder, made of client/service and frequency
    def myName(self):
        return "%s%s" % (
            "Service" if self.service else "Client",
            " at %dkHz" % (self.frequency // 1000) if self.frequency>0 else ""
        )

    # Get current UTC time in a standardized format
    def getUtcTime(self) -> str:
        return datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')

    # By default, do not parse
    def parse(self, msg: bytes):
        return None

    def run(self):
        logger.debug("%s starting..." % self.myName())
        super().run()
        logger.debug("%s exiting..." % self.myName())

    def process(self, line: bytes) -> any:
        # No result yet
        out = None

        try:
            #logger.debug("%s: %s" % (self.myName(), str(line)))
            # If running as a service with a log file...
            if self.service and self.filePfx is not None:
                # Write message into open log file, including end-of-line
                self.writeFile(line)
                self.writeFile(b"\n")
            # Let parse() function do its thing
            out = self.parse(line)

        except Exception as exptn:
            logger.debug("%s: Exception parsing: %s" % (self.myName(), str(exptn)))

        # Return parsed result, ignore result in service mode
        return out if not self.service else None


class RdsParser(TextParser):
    def __init__(self, service: bool = False):
        # Data will be accumulated here
        self.rds = { "mode": "RDS" }
        # Construct parent object
        super().__init__(filePrefix="RDS", service=service)

    def parse(self, msg: bytes):
        # Expect JSON data in text form
        data = json.loads(msg)
        # Delete constantly changing group ID
        if "group" in data:
            del data["group"]
        # Only update if there is new data
        if data.items() <= self.rds.items():
            return None
        else:
            self.rds.update(data)
            return self.rds

    def setDialFrequency(self, frequency: int) -> None:
        super().setDialFrequency(frequency)
        # Clear RDS data when frequency changed
        self.rds = { "mode": "RDS", "frequency": frequency }


class IsmParser(TextParser):
    def __init__(self, service: bool = False):
        # Colors will be assigned via this cache
        self.colors = ColorCache()
        # Construct parent object
        super().__init__(filePrefix="ISM", service=service)

    def parse(self, msg: bytes):
        # Do not parse in service mode
        if self.service:
            return None
        # Expect JSON data in text form
        out = json.loads(msg)
        # Add mode name and a color to identify the sender
        out["mode"]  = "ISM"
        out["color"] = self.colors.getColor(out["id"])
        return out


class PageParser(TextParser):
    def __init__(self, service: bool = False):
        # When true, try filtering out unreadable messages
        pm = Config.get()
        self.filtering = "paging_filter" in pm and pm["paging_filter"]
        # POCSAG<baud>: Address: <num> Function: <hex> (Certainty: <num> )?(Numeric|Alpha|Skyper): <message>
        self.rePocsag = re.compile(r"POCSAG(\d+):\s*Address:\s*(\S+)\s+Function:\s*(\S+)(\s+Certainty:.*(\d+))?(\s+(\S+):\s*(.*))?")
        # FLEX|NNNN-NN-NN NN:NN:NN|<baud>/<value>/C/C|NN.NNN|NNNNNNNNN|<type>|<message>
        # FLEX|NNNN-NN-NN NN:NN:NN|<baud>/<value>/C/C|NN.NNN|NNNNNNNNN NNNNNNNNN|<type>|<message>
        self.reFlex1 = re.compile(r"FLEX\|(\d\d\d\d-\d\d-\d\d\s+\d\d:\d\d:\d\d)\|(\d+/\d+/\S/\S)\|(\d\d\.\d\d\d)\|(\d+(?:\s+\d+)?)\|(\S+)\|(.*)")
        # FLEX: NNNN-NN-NN NN:NN:NN <baud>/<value>/C NN.NNN [NNNNNNNNN] <type> <message>
        self.reFlex2 = re.compile(r"FLEX:\s+(\d\d\d\d-\d\d-\d\d\s+\d\d:\d\d:\d\d)\s+(\d+/\d+/\S)\s+(\d\d\.\d\d\d)\s+\[(\d+)\]\s+(\S+)\s+(.*)")
        # FLEX message status
        self.reFlex3 = re.compile(r"(\d+/\d+)(/\S)?/\S")
        # Message filtering patterns
        self.reControl = re.compile(r"<[\w\d]{2,3}>")
        self.reSpaces = re.compile(r"[\000-\037\s]+")
        # Fragmented messages will be assembled here
        self.flexBuf = {}
        # Colors will be assigned via this cache
        self.colors = ColorCache()
        # Construct parent object
        super().__init__(filePrefix="PAGE", service=service)

    def parse(self, msg: bytes):
        # Steer message to POCSAG or FLEX parser, do not parse if service
        if self.service:
            return None
        elif msg.startswith(b"POCSAG"):
            return self.parsePocsag(msg.decode('utf-8', 'replace'))
        elif msg.startswith(b"FLEX"):
            return self.parseFlex(msg.decode('utf-8', 'replace'))
        else:
            return None

    def collapseSpaces(self, msg: str) -> str:
        # Collapse white space
        return self.reSpaces.sub(" ", msg).strip()

    def isReadable(self, msg: str) -> bool:
       # Consider string human-readable if the average word length
       # is sufficiently small
       spaces  = msg.count(" ")
       letters = len(msg) - spaces
       return (letters > 0) and (letters / (spaces+1) < 40)

    def parsePocsag(self, msg: str):
        # No result yet
        out = None

        # Parse POCSAG messages
        r = self.rePocsag.match(msg)
        if r is not None:
            baud      = r.group(1)
            capcode   = r.group(2)
            function  = r.group(3)
            certainty = r.group(5)
            msgtype   = "" if not r.group(7) else r.group(7)
            msg       = "" if not r.group(8) else r.group(8)

            # Remove POCSAG "<XXX>" sequences and collapse white space
            msg = self.collapseSpaces(self.reControl.sub(" ", msg))

            # When filtering, only output readable messages
            if not self.filtering or (msgtype=="Alpha" and len(msg)>0):
                out = {
                    "mode":      "POCSAG",
                    "baud":      baud,
                    "timestamp": self.getUtcTime(),
                    "address":   capcode,
                    "function":  function,
                    "certainty": certainty,
                    "color":     self.colors.getColor(capcode),
                    "type":      msgtype,
                    "message":   msg
                }
                # Output type and message
                if len(msgtype)>0:
                    out["type"] = msgtype
                if len(msg)>0:
                    out["message"] = msg

        # Done
        return out

    def parseFlex(self, msg: str):
        # No result yet
        out = None

        # Parse FLEX messages
        r = self.reFlex1.match(msg)
        r = self.reFlex2.match(msg) if not r else r
        if r is not None:
            tstamp  = r.group(1)
            state   = r.group(2)
            frame   = r.group(3)
            capcode = r.group(4)
            msgtype = r.group(5)
            msg     = r.group(6)
            rm      = self.reFlex3.match(state)
            baud    = "" if not rm else rm.group(1)
            frag    = "" if not rm or not rm.group(2) else rm.group(2)[1]
            # Assemble fragmented messages in flexBuf
            if frag == "F" or frag == "C":
                # Do not let flexBuf grow too much
                if len(self.flexBuf)>1024:
                    self.flexBuf = {}
                # Accumulate messages in flexBuf, index by capcode
                if capcode in self.flexBuf:
                    self.flexBuf[capcode] += msg
                else:
                    self.flexBuf[capcode] = msg
            # Only output message once it completes
            if frag == "F":
                msg = ""
            elif frag == "C":
                msg = self.flexBuf[capcode]
                del self.flexBuf[capcode]
            # Do not report fragments of messages
            if frag != "F":
                # Collapse white space
                msg = self.collapseSpaces(msg)
                # When filtering, only output readable messages
                if not self.filtering or (msgtype=="ALN" and self.isReadable(msg)):
                    out = {
                        "mode":      "FLEX",
                        "baud":      baud,
                        "timestamp": tstamp,
                        "state":     state,
                        "frame":     frame,
                        "address":   capcode,
                        "color":     self.colors.getColor(capcode),
                        "type":      msgtype
                    }
                    # Output message
                    if len(msg)>0:
                        out["message"] = msg

        # Done
        return out


class SelCallParser(TextParser):
    def __init__(self, service: bool = False):
        self.reSplit = re.compile(r"(ZVEI1|ZVEI2|ZVEI3|DZVEI|PZVEI|DTMF|EEA|EIA|CCIR):\s+")
        self.reMatch = re.compile(r"ZVEI1|ZVEI2|ZVEI3|DZVEI|PZVEI|DTMF|EEA|EIA|CCIR")
        self.mode = ""
        # Construct parent object
        super().__init__(filePrefix="SELCALL", service=service)

    def parse(self, msg: bytes):
        # Do not parse in service mode
        if self.service:
            return None
        # Parse SELCALL messages
        msg = msg.decode('utf-8', 'replace')
        dec = None
        out = ""
        r = self.reSplit.split(msg)

        for s in r:
            if self.reMatch.match(s):
                dec = s
            elif dec is not None and len(s)>0:
                if dec != self.mode:
                    out += "[" + dec + "] "
                    self.mode = dec
                out += s + " "
                dec = None
        # Done
        return out
