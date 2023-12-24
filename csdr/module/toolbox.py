from pycsdr.modules import ExecModule
from pycsdr.types import Format
from csdr.module import PopenModule
from owrx.config import Config
import os

class Rtl433Module(ExecModule):
    def __init__(self, sampleRate: int = 250000, jsonOutput: bool = False):
        self.sampleRate = sampleRate
        self.jsonOutput = jsonOutput
        cmd = [
            "rtl_433", "-r", "cs16:-", "-s", str(self.sampleRate),
            "-M", "time:utc", "-F", "json" if self.jsonOutput else "kv",
            "-A",
        ]
        super().__init__(Format.COMPLEX_SHORT, Format.CHAR, cmd)


class MultimonModule(PopenModule):
    def __init__(self, decoders: list[str]):
        self.decoders = decoders
        super().__init__()

    def getCommand(self):
        cmd = ["multimon-ng", "-", "-v0", "-c"]
        for x in self.decoders:
            cmd += ["-a", x]
        return cmd

    def getInputFormat(self) -> Format:
        return Format.SHORT

    def getOutputFormat(self) -> Format:
        return Format.CHAR


class DumpHfdlModule(PopenModule):
    def __init__(self, sampleRate: int = 12000, jsonOutput: bool = False):
        self.sampleRate = sampleRate
        self.jsonOutput = jsonOutput
        super().__init__()

    def getCommand(self):
        return [
            "dumphfdl", "--iq-file", "-", "--sample-format", "CF32",
            "--sample-rate", str(self.sampleRate), "--output",
            "decoded:%s:file:path=-" % ("json" if self.jsonOutput else "text"),
            "--utc", "--centerfreq", "0", "0"
        ]

    def getInputFormat(self) -> Format:
        return Format.COMPLEX_FLOAT

    def getOutputFormat(self) -> Format:
        return Format.CHAR


class DumpVdl2Module(PopenModule):
    def __init__(self, sampleRate: int = 105000, jsonOutput: bool = False):
        self.sampleRate = sampleRate
        self.jsonOutput = jsonOutput
        super().__init__()

    def getCommand(self):
        return [
            "dumpvdl2", "--iq-file", "-", "--sample-format", "S16_LE",
            "--oversample", str(self.sampleRate // 105000), "--output",
            "decoded:%s:file:path=-" % ("json" if self.jsonOutput else "text"),
            "--decode-fragments", "--utc"
        ]

    def getInputFormat(self) -> Format:
        return Format.COMPLEX_SHORT

    def getOutputFormat(self) -> Format:
        return Format.CHAR


class Dump1090Module(ExecModule):
    def __init__(self, rawOutput: bool = False, jsonFolder: str = None):
        self.jsonFolder = jsonFolder
        pm  = Config.get()
        lat = pm["receiver_gps"]["lat"]
        lon = pm["receiver_gps"]["lon"]
        cmd = [
            "dump1090", "--ifile", "-", "--iformat", "SC16",
            "--lat", str(lat), "--lon", str(lon),
            "--modeac", "--metric"
        ]
        # If JSON files folder supplied, use that, disable STDOUT output
        if self.jsonFolder is not None:
            try:
                os.makedirs(self.jsonFolder, exist_ok = True)
                cmd += [ "--quiet", "--write-json", self.jsonFolder ]
            except:
                self.jsonFolder = None
                pass
        # RAW STDOUT output only makes sense if we are not using JSON
        if rawOutput and self.jsonFolder is None:
            cmd += [ "--raw" ]
        super().__init__(Format.COMPLEX_SHORT, Format.CHAR, cmd)


class WavFileModule(PopenModule):
    def getInputFormat(self) -> Format:
        return Format.SHORT

    def start(self):
        # Create process and pumps
        super().start()
        # Created simulated .WAV file header
        byteRate = (self.sampleRate * 16 * 1) >> 3
        header = bytearray(44)
        header[0:3]   = b"RIFF"
        header[4:7]   = bytes([36, 0xFF, 0xFF, 0xFF])
        header[8:11]  = b"WAVE"
        header[12:15] = b"fmt "
        header[16]    = 16       # Chunk size
        header[20]    = 1        # Format (PCM)
        header[22]    = 1        # Number of channels (1)
        header[24]    = self.sampleRate & 0xFF
        header[25]    = (self.sampleRate >> 8) & 0xFF
        header[26]    = (self.sampleRate >> 16) & 0xFF
        header[27]    = (self.sampleRate >> 24) & 0xFF
        header[28]    = byteRate & 0xFF
        header[29]    = (byteRate >> 8) & 0xFF
        header[30]    = (byteRate >> 16) & 0xFF
        header[31]    = (byteRate >> 24) & 0xFF
        header[32]    = 2       # Block alignment (2 bytes)
        header[34]    = 16      # Bits per sample (16)
        header[36:39] = b"data"
        header[40:43] = bytes([0, 0xFF, 0xFF, 0xFF])
        # Send .WAV file header to the process
        self.process.stdin.write(header)


class AcarsDecModule(WavFileModule):
    def __init__(self, sampleRate: int = 12500, jsonOutput: bool = False):
        self.sampleRate = sampleRate
        self.jsonOutput = jsonOutput
        super().__init__()

    def getCommand(self):
        return [
            "acarsdec", "-f", "/dev/stdin",
            "-o", str(4 if self.jsonOutput else 1)
        ]

    def getOutputFormat(self) -> Format:
        return Format.CHAR


class RedseaModule(WavFileModule):
    def __init__(self, sampleRate: int = 171000, usa: bool = False):
        self.sampleRate = sampleRate
        self.usa = usa
        super().__init__()

    def getCommand(self):
        cmd = [
            "redsea", "--file", "/dev/stdin", "--input", "mpx",
            "--samplerate", str(self.sampleRate)
        ]
        if self.usa:
            cmd += ["--rbds"]
        return cmd

    def getOutputFormat(self) -> Format:
        return Format.CHAR
