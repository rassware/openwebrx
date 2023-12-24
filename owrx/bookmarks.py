from datetime import datetime, timezone
from owrx.config.core import CoreConfig
import json
import os.path
import os

import logging

logger = logging.getLogger(__name__)


class Bookmark(object):
    def __init__(self, j, srcFile: str = None):
        self.name = j["name"]
        self.frequency = j["frequency"]
        self.modulation = j["modulation"]
        self.srcFile = srcFile

    def getName(self):
        return self.name

    def getFrequency(self):
        return self.frequency

    def getModulation(self):
        return self.modulation

    def getSrcFile(self):
        return self.srcFile

    def __dict__(self):
        return {
            "name": self.getName(),
            "frequency": self.getFrequency(),
            "modulation": self.getModulation(),
        }


class BookmarkSubscription(object):
    def __init__(self, subscriptee, range, subscriber: callable):
        self.subscriptee = subscriptee
        self.range = range
        self.subscriber = subscriber

    def inRange(self, bookmark: Bookmark):
        low, high = self.range
        return low <= bookmark.getFrequency() <= high

    def call(self, *args, **kwargs):
        self.subscriber(*args, **kwargs)

    def cancel(self):
        self.subscriptee.unsubscribe(self)


class Bookmarks(object):
    sharedInstance = None

    @staticmethod
    def getSharedInstance():
        if Bookmarks.sharedInstance is None:
            Bookmarks.sharedInstance = Bookmarks()
        return Bookmarks.sharedInstance

    def __init__(self):
        self.file_modified = None
        self.bookmarks = []
        self.subscriptions = []
        # Known bookmark files, starting with the main file
        self.fileList = [Bookmarks._getBookmarksFile(), "/etc/openwebrx/bookmarks.json", "bookmarks.json"]
        # Find additional bookmark files in the bookmarks.d folder
        try:
            bookmarksDir = "/etc/openwebrx/bookmarks.d"
            self.fileList += [ bookmarksDir + "/" + file
                for file in os.listdir(bookmarksDir) if file.endswith(".json")
            ]
        except Exception:
            pass

    def _refresh(self):
        modified = self._getFileModifiedTimestamp()
        if self.file_modified is None or modified > self.file_modified:
            logger.debug("reloading bookmarks from disk due to file modification")
            self.bookmarks = self._loadBookmarks()
            self.file_modified = modified

    def _getFileModifiedTimestamp(self):
        timestamp = 0
        for file in self.fileList:
            try:
                timestamp = max(timestamp, os.path.getmtime(file))
            except FileNotFoundError:
                pass
        return datetime.fromtimestamp(timestamp, timezone.utc)

    def _loadBookmarks(self):
        mainFile = Bookmarks._getBookmarksFile()
        result = []
        # Collect bookmarks from all files in the result
        for file in self.fileList:
            # Main file bookmarks will not have srcFile set
            srcFile = file if file != mainFile else None
            try:
                with open(file, "r") as f:
                    content = f.read()
                if content:
                    bookmarks_json = json.loads(content)
                    result += [Bookmark(d, srcFile) for d in bookmarks_json]
            except FileNotFoundError:
                pass
            except json.JSONDecodeError:
                logger.exception("error while parsing bookmarks file %s", file)
            except Exception:
                logger.exception("error while processing bookmarks from %s", file)
        return result

    def getEditableBookmarks(self):
        # Only return bookmarks that can be saved
        self._refresh()
        return [b for b in self.bookmarks if b.srcFile is None]

    def getBookmarks(self, range=None):
        self._refresh()
        if range is None:
            return self.bookmarks
        else:
            (lo, hi) = range
            return [b for b in self.bookmarks if lo <= b.getFrequency() <= hi]

    @staticmethod
    def _getBookmarksFile():
        coreConfig = CoreConfig()
        return "{data_directory}/bookmarks.json".format(data_directory=coreConfig.get_data_directory())

    def store(self):
        # Don't write directly to file to avoid corruption on exceptions
        # Only save main file bookmarks, i.e. ones with no srcFle
        jsonContent = json.dumps(
            [b.__dict__() for b in self.bookmarks if b.getSrcFile() is None],
            indent=4
        )
        with open(Bookmarks._getBookmarksFile(), "w") as file:
            file.write(jsonContent)
        self.file_modified = self._getFileModifiedTimestamp()

    def addBookmark(self, bookmark: Bookmark):
        self.bookmarks.append(bookmark)
        self.notifySubscriptions(bookmark)

    def removeBookmark(self, bookmark: Bookmark):
        if bookmark not in self.bookmarks:
            return
        self.bookmarks.remove(bookmark)
        self.notifySubscriptions(bookmark)

    def notifySubscriptions(self, bookmark: Bookmark):
        for sub in self.subscriptions:
            if sub.inRange(bookmark):
                try:
                    sub.call()
                except Exception:
                    logger.exception("Error while calling bookmark subscriptions")

    def subscribe(self, range, callback):
        sub = BookmarkSubscription(self, range, callback)
        self.subscriptions.append(BookmarkSubscription(self, range, callback))
        return sub

    def unsubscribe(self, subscription: BookmarkSubscription):
        if subscription not in self.subscriptions:
            return
        self.subscriptions.remove(subscription)
