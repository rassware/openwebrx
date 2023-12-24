from owrx.config.core import CoreConfig
from owrx.config import Config
from owrx.version import openwebrx_version
from owrx.bookmarks import Bookmark

import urllib
import threading
import logging
import json
import os
import time
import math

logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)

#
# Maximal distance a repeater can reach (kilometers)
#
MAX_DISTANCE = 200

class Repeaters(object):
    sharedInstance = None
    creationLock = threading.Lock()

    @staticmethod
    def getSharedInstance():
        with Repeaters.creationLock:
            if Repeaters.sharedInstance is None:
                Repeaters.sharedInstance = Repeaters()
        return Repeaters.sharedInstance

    @staticmethod
    def start():
        Repeaters.getSharedInstance().startThread()

    @staticmethod
    def stop():
        Repeaters.getSharedInstance().stopThread()

    @staticmethod
    def _getCachedDatabaseFile():
        coreConfig = CoreConfig()
        return "{data_directory}/repeaters.json".format(data_directory=coreConfig.get_data_directory())

    # Compute distance, in kilometers, between two latlons.
    @staticmethod
    def distKm(p1, p2):
        # Earth radius in km
        earthR = 6371
        # Convert degrees to radians
        rlat1 = p1[0] * (math.pi/180)
        rlat2 = p2[0] * (math.pi/180)
        # Compute difference in radians
        difflat = rlat2 - rlat1
        difflon = (p2[1] - p1[1]) * (math.pi/180)
        # Compute distance
        return round(2 * earthR * math.asin(math.sqrt(
            math.sin(difflat/2) * math.sin(difflat/2) +
            math.cos(rlat1) * math.cos(rlat2) * math.sin(difflon/2) * math.sin(difflon/2)
        )))

    # Guess main operating mode, prefer free modes
    @staticmethod
    def getModulation(entry):
        if "FM Analog" in entry and entry["FM Analog"]=="Yes":
            return "nfm"
        elif "M17" in entry and entry["M17"]=="Yes":
            return "m17"
        elif "DMR" in entry and entry["DMR"]=="Yes":
            return "dmr"
        elif "D-Star" in entry and entry["D-Star"]=="Yes":
            return "dstar"
        elif "System Fusion" in entry and entry["System Fusion"]=="Yes":
            return "ysf"
        elif "NXDN" in entry and entry["NXDN"]=="Yes":
            return "nxdn"
        else:
            return "nfm"

    def __init__(self):
        self.refreshPeriod = 60*60*24
        self.lock = threading.Lock()
        self.repeaters = []

    #
    # Load cached database or refresh it from the web.
    #
    def refresh(self):
        # This file contains cached database
        file = self._getCachedDatabaseFile()
        ts   = os.path.getmtime(file) if os.path.isfile(file) else 0

        # If cached database is stale...
        if time.time() - ts >= self.refreshPeriod:
            # Load EIBI database file from the web
            repeaters = self.loadFromWeb()
            if repeaters:
                # Save parsed data into a file
                self.saveRepeaters(file, repeaters)
                # Update current schedule
                with self.lock:
                    self.repeaters = repeaters

        # If no current databse, load it from cached file
        if not self.repeaters:
            repeaters = self.loadRepeaters(file)
            with self.lock:
                self.repeaters = repeaters

    #
    # Save database to a given JSON file.
    #
    def saveRepeaters(self, file: str, repeaters):
        logger.debug("Saving {0} repeaters to '{1}'...".format(len(repeaters), file))
        try:
            with open(file, "w") as f:
                json.dump(repeaters, f, indent=2)
                f.close()
        except Exception as e:
            logger.debug("saveRepeaters() exception: {0}".format(e))

    #
    # Load database from a given JSON file.
    #
    def loadRepeaters(self, file: str):
        logger.debug("Loading repeaters from '{0}'...".format(file))
        if not os.path.isfile(file):
            result = []
        else:
            try:
                with open(file, "r") as f:
                    result = json.load(f)
                    f.close()
            except Exception as e:
                logger.debug("loadRepeaters() exception: {0}".format(e))
                result = []
        # Done
        logger.debug("Loaded {0} repeaters from '{1}'...".format(len(result), file))
        return result

    #
    # Load repeater database from the RepeaterBook.com website.
    #
    def loadFromWeb(self, url: str = "https://www.repeaterbook.com/api/{script}?qtype=prox&dunit=km&lat={lat}&lng={lon}&dist={range}", rangeKm: int = MAX_DISTANCE):
        result = []
        try:
            pm   = Config.get()
            lat  = pm["receiver_gps"]["lat"]
            lon  = pm["receiver_gps"]["lon"]
            hdrs = { "User-Agent": "(OpenWebRX+, luarvique@gmail.com)" }
            # Start with US/Canada database for north-wester quartersphere
            if lat > 0 and lon < 0:
                scps = ["export.php", "exportROW.php"]
            else:
                scps = ["exportROW.php", "export.php"]
            # Try scripts in order...
            for s in scps:
                url1 = url.format(script = s, lat = lat, lon = lon, range = rangeKm)
                req  = urllib.request.Request(url1, headers = hdrs)
                data = urllib.request.urlopen(req).read().decode("utf-8")
                logger.debug("Trying {0} ... got {1} bytes".format(url1, len(data)))
                data = json.loads(data)
                # ...until we get the result
                if "results" in data and len(data["results"]) > 0:
                    break
            # If no results, do not continue
            if "results" not in data:
                return []
            # For every entry in the response...
            for entry in data["results"]:
                result += [{
                    "name"    : entry["Callsign"],
                    "lat"     : float(entry["Lat"]),
                    "lon"     : float(entry["Long"]),
                    "freq"    : int(float(entry["Frequency"]) * 1000000),
                    "mode"    : self.getModulation(entry),
                    "status"  : entry["Operational Status"],
                    "updated" : entry["Last Update"],
                    "comment" : entry["Notes"]
                }]

        except Exception as e:
            logger.debug("loadFromWeb() exception: {0}".format(e))

        # Done
        return result

    #
    # Get bookmarks for all repeaters that are within given
    # frequency and distance ranges.
    #
    def getBookmarks(self, frequencyRange, rangeKm: int = MAX_DISTANCE):
        # Make sure freq2>freq1
        (f1, f2) = frequencyRange
        if f1>f2:
            f = f1
            f1 = f2
            f2 = f

        # Get receiver location for computing distance
        pm = Config.get()
        rxPos = (pm["receiver_gps"]["lat"], pm["receiver_gps"]["lon"])

        # No result yet
        logger.debug("Creating bookmarks for {0}-{1}kHz within {2}km...".format(f1//1000, f2//1000, rangeKm))
        result = {}

        # Search for repeaters within frequency and distance ranges
        with self.lock:
            for entry in self.repeaters:
                try:
                    f = entry["freq"]
                    if f1 <= f <= f2:
                        d = self.distKm(rxPos, (entry["lat"], entry["lon"]))
                        if d <= rangeKm and (f not in result or d < result[f][1]):
                            result[f] = (entry, d)

                except Exception as e:
                    logger.debug("getBookmarks() exception: {0}".format(e))

        # Return bookmarks for all found entries
        logger.debug("Created {0} bookmarks for {1}-{2}kHz within {3}km.".format(len(result), f1//1000, f2//1000, rangeKm))
        return [ Bookmark({
            "name"       : result[f][0]["name"],
            "modulation" : result[f][0]["mode"],
            "frequency"  : result[f][0]["freq"]
        }, srcFile = "RepeaterBook") for f in result.keys() ]

    #
    # Get entries for all repeaters that are within given distance
    # range from the receiver.
    #
    def getAllInRange(self, rangeKm: int = MAX_DISTANCE):
        # Get receiver location for computing distance
        pm = Config.get()
        rxPos = (pm["receiver_gps"]["lat"], pm["receiver_gps"]["lon"])

        # No result yet
        logger.debug("Looking for repeaters within {0}km...".format(rangeKm))
        result = []

        # Search for repeaters within given distance range
        with self.lock:
            for entry in self.repeaters:
                try:
                    if self.distKm(rxPos, (entry["lat"], entry["lon"])) <= rangeKm:
                        result += [entry]

                except Exception as e:
                    logger.debug("getAllInRange() exception: {0}".format(e))

        # Done
        logger.debug("Found {0} repeaters within {1}km.".format(len(result), rangeKm))
        return result

