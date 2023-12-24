function MessagePanel(el) {
    this.el = el;
    this.render();
    this.initClearButton();
}

MessagePanel.prototype.supportsMessage = function(message) {
    return false;
};

MessagePanel.prototype.render = function() {
};

MessagePanel.prototype.pushMessage = function(message) {
};

// Automatic clearing is not enabled by default.
// Call this method from the constructor to enable.
MessagePanel.prototype.initClearTimer = function() {
    var me = this;
    if (me.removalInterval) clearInterval(me.removalInterval);
    me.removalInterval = setInterval(function () {
        me.clearMessages(250);
    }, 15000);
};

// Clear all currently shown messages.
MessagePanel.prototype.clearMessages = function(toRemain) {
    var $elements = $(this.el).find('tbody tr');
    // limit to 1000 entries in the list since browsers get laggy at some point
    var toRemove = $elements.length - toRemain;
    if (toRemove <= 0) return;
    $elements.slice(0, toRemove).remove();
};

// Add CLEAR button to the message list.
MessagePanel.prototype.initClearButton = function() {
    var me = this;
    me.clearButton = $(
        '<div class="openwebrx-button">Clear</div>'
    );
    me.clearButton.css({
        position: 'absolute',
        top: '10px',
        right: '10px'
    });
    me.clearButton.on('click', function() {
        me.clearMessages(0);
    });
    $(me.el).append(me.clearButton);
};

// Scroll to the bottom of the message list.
MessagePanel.prototype.scrollToBottom = function() {
    var $t = $(this.el).find('tbody');
    $t.scrollTop($t[0].scrollHeight);
};

function WsjtMessagePanel(el) {
    MessagePanel.call(this, el);
    this.initClearTimer();
    this.qsoModes = ['FT8', 'JT65', 'JT9', 'FT4', 'FST4', 'Q65', 'MSK144'];
    this.beaconModes = ['WSPR', 'FST4W'];
    this.modes = [].concat(this.qsoModes, this.beaconModes);
}

WsjtMessagePanel.prototype = Object.create(MessagePanel.prototype);

WsjtMessagePanel.prototype.supportsMessage = function(message) {
    return this.modes.indexOf(message['mode']) >= 0;
};

WsjtMessagePanel.prototype.render = function() {
    $(this.el).append($(
        '<table>' +
            '<thead><tr>' +
                '<th>UTC</th>' +
                '<th class="decimal">dB</th>' +
                '<th class="decimal">DT</th>' +
                '<th class="decimal freq">Freq</th>' +
                '<th class="message">Message</th>' +
            '</tr></thead>' +
            '<tbody></tbody>' +
        '</table>'
    ));
};

WsjtMessagePanel.prototype.pushMessage = function(msg) {
    var $b = $(this.el).find('tbody');
    var t = new Date(msg['timestamp']);
    var pad = function (i) {
        return ('' + i).padStart(2, "0");
    };
    var linkedmsg = msg['msg'];
    var matches;

    if (this.qsoModes.indexOf(msg['mode']) >= 0) {
        matches = linkedmsg.match(/(.*\s[A-Z0-9]+\s)([A-R]{2}[0-9]{2})$/);
        if (matches && matches[2] !== 'RR73') {
            linkedmsg = Utils.htmlEscape(matches[1]) + '<a href="map?locator=' + matches[2] + '" target="openwebrx-map">' + matches[2] + '</a>';
        } else {
            linkedmsg = Utils.htmlEscape(linkedmsg);
        }
    } else if (this.beaconModes.indexOf(msg['mode']) >= 0) {
        matches = linkedmsg.match(/([A-Z0-9]*\s)([A-R]{2}[0-9]{2})(\s[0-9]+)/);
        if (matches) {
            linkedmsg = Utils.htmlEscape(matches[1]) + '<a href="map?locator=' + matches[2] + '" target="openwebrx-map">' + matches[2] + '</a>' + Utils.htmlEscape(matches[3]);
        } else {
            linkedmsg = Utils.htmlEscape(linkedmsg);
        }
    }
    $b.append($(
        '<tr data-timestamp="' + msg['timestamp'] + '">' +
        '<td>' + pad(t.getUTCHours()) + pad(t.getUTCMinutes()) + pad(t.getUTCSeconds()) + '</td>' +
        '<td class="decimal">' + msg['db'] + '</td>' +
        '<td class="decimal">' + msg['dt'] + '</td>' +
        '<td class="decimal freq">' + msg['freq'] + '</td>' +
        '<td class="message">' + linkedmsg + '</td>' +
        '</tr>'
    ));
    this.scrollToBottom();
}

$.fn.wsjtMessagePanel = function(){
    if (!this.data('panel')) {
        this.data('panel', new WsjtMessagePanel(this));
    }
    return this.data('panel');
};

function PacketMessagePanel(el) {
    MessagePanel.call(this, el);
    this.initClearTimer();
}

PacketMessagePanel.prototype = Object.create(MessagePanel.prototype);

PacketMessagePanel.prototype.supportsMessage = function(message) {
    return (message['mode'] === 'APRS') || (message['mode'] === 'AIS');
};

PacketMessagePanel.prototype.render = function() {
    $(this.el).append($(
        '<table>' +
            '<thead><tr>' +
                '<th>UTC</th>' +
                '<th class="callsign">Callsign</th>' +
                '<th class="coord">Coord</th>' +
                '<th class="message">Comment</th>' +
            '</tr></thead>' +
            '<tbody></tbody>' +
        '</table>'
    ));
};

PacketMessagePanel.prototype.pushMessage = function(msg) {
    var $b = $(this.el).find('tbody');
    var pad = function (i) {
        return ('' + i).padStart(2, "0");
    };

    if (msg.type && msg.type === 'thirdparty' && msg.data) {
        msg = msg.data;
    }

    var source = msg.source;
    if (msg.type) {
        if (msg.type === 'nmea') {
            // Do not show AIS-specific stuff for now
            return;
        }
        if (msg.type === 'item') {
            source = msg.item;
        }
        if (msg.type === 'object') {
            source = msg.object;
        }
    }

    var timestamp = '';
    if (msg.timestamp) {
        var t = new Date(msg.timestamp);
        timestamp = pad(t.getUTCHours()) + pad(t.getUTCMinutes()) + pad(t.getUTCSeconds())
    }

    var link = '';
    var classes = [];
    var styles = {};
    var overlay = '';
    var stylesToString = function (s) {
        return $.map(s, function (value, key) {
            return key + ':' + value + ';'
        }).join('')
    };
    if (msg.symbol) {
        classes.push('aprs-symbol');
        classes.push('aprs-symboltable-' + (msg.symbol.table === '/' ? 'normal' : 'alternate'));
        styles['background-position-x'] = -(msg.symbol.index % 16) * 15 + 'px';
        styles['background-position-y'] = -Math.floor(msg.symbol.index / 16) * 15 + 'px';
        if (msg.symbol.table !== '/' && msg.symbol.table !== '\\') {
            var s = {};
            s['background-position-x'] = -(msg.symbol.tableindex % 16) * 15 + 'px';
            s['background-position-y'] = -Math.floor(msg.symbol.tableindex / 16) * 15 + 'px';
            overlay = '<div class="aprs-symbol aprs-symboltable-overlay" style="' + stylesToString(s) + '"></div>';
        }
    } else if (msg.lat && msg.lon) {
        classes.push('openwebrx-maps-pin');
        overlay = '<svg viewBox="0 0 20 35"><use xlink:href="static/gfx/svg-defs.svg#maps-pin"></use></svg>';
    }
    var attrs = [
        'class="' + classes.join(' ') + '"',
        'style="' + stylesToString(styles) + '"'
    ].join(' ');
    if (msg.lat && msg.lon) {
        link = Utils.linkToMap(source, overlay, attrs);
    } else {
        link = '<div ' + attrs + '>' + overlay + '</div>'
    }

    // Linkify source based on what it is (vessel or HAM callsign)
    source = msg.mode === 'AIS'?
        Utils.linkifyVessel(source) : Utils.linkifyCallsign(source);

    $b.append($(
        '<tr>' +
        '<td>' + timestamp + '</td>' +
        '<td class="callsign">' + source + '</td>' +
        '<td class="coord">' + link + '</td>' +
        '<td class="message">' + Utils.htmlEscape(msg.comment || msg.message || '') + '</td>' +
        '</tr>'
    ));
    this.scrollToBottom();
};

$.fn.packetMessagePanel = function() {
    if (!this.data('panel')) {
        this.data('panel', new PacketMessagePanel(this));
    }
    return this.data('panel');
};

PocsagMessagePanel = function(el) {
    MessagePanel.call(this, el);
    this.initClearTimer();
}

PocsagMessagePanel.prototype = Object.create(MessagePanel.prototype);

PocsagMessagePanel.prototype.supportsMessage = function(message) {
    return message['mode'] === 'Pocsag';
};

PocsagMessagePanel.prototype.render = function() {
    $(this.el).append($(
        '<table>' +
            '<thead><tr>' +
                '<th class="address">Address</th>' +
                '<th class="message">Message</th>' +
            '</tr></thead>' +
            '<tbody></tbody>' +
        '</table>'
    ));
};

PocsagMessagePanel.prototype.pushMessage = function(msg) {
    var $b = $(this.el).find('tbody');
    $b.append($(
        '<tr>' +
            '<td class="address">' + msg.address + '</td>' +
            '<td class="message">' + Utils.htmlEscape(msg.message) + '</td>' +
        '</tr>'
    ));
    this.scrollToBottom();
};

$.fn.pocsagMessagePanel = function() {
    if (!this.data('panel')) {
        this.data('panel', new PocsagMessagePanel(this));
    }
    return this.data('panel');
};

PageMessagePanel = function(el) {
    MessagePanel.call(this, el);
    this.initClearTimer();
}

PageMessagePanel.prototype = Object.create(MessagePanel.prototype);

PageMessagePanel.prototype.supportsMessage = function(message) {
    return (message['mode'] === 'FLEX') || (message['mode'] === 'POCSAG');
};

PageMessagePanel.prototype.render = function() {
    $(this.el).append($(
        '<table>' +
            '<thead><tr>' +
                '<th class="address">CapCode</th>' +
                '<th class="mode">Mode</th>' +
                '<th class="timestamp">Time</th>' +
            '</tr></thead>' +
            '<tbody></tbody>' +
        '</table>'
    ));
};

PageMessagePanel.prototype.pushMessage = function(msg) {
    // Get color from the message, default to white
    var color = msg.hasOwnProperty('color')? msg.color : "#FFF";

    // Append message header (address, time, etc)
    var $b = $(this.el).find('tbody');
    $b.append($(
        '<tr>' +
            '<td class="address">' + msg.address + '</td>' +
            '<td class="mode">' + msg.mode + msg.baud + '</td>' +
            '<td class="timestamp" style="text-align:right;">' + msg.timestamp + '</td>' +
        '</tr>'
    ).css('background-color', color).css('color', '#000'));

    // Append message body (text)
    if (msg.hasOwnProperty('message')) {
        $b.append($(
            '<tr><td class="message" colspan="3">' +
            Utils.htmlEscape(msg.message) +
            '</td></tr>'
        ));
    }

    // Jump list to the last received message
    this.scrollToBottom();
};

$.fn.pageMessagePanel = function() {
    if (!this.data('panel')) {
        this.data('panel', new PageMessagePanel(this));
    }
    return this.data('panel');
};

HfdlMessagePanel = function(el) {
    MessagePanel.call(this, el);
    this.initClearTimer();
    this.modes = ['HFDL', 'VDL2', 'ADSB', 'ACARS'];
    this.flight_url = null;
    this.modes_url = null;
}

HfdlMessagePanel.prototype = Object.create(MessagePanel.prototype);

HfdlMessagePanel.prototype.supportsMessage = function(message) {
    return this.modes.indexOf(message['mode']) >= 0;
};

HfdlMessagePanel.prototype.setFlightUrl = function(url) {
    this.flight_url = url;
};

HfdlMessagePanel.prototype.setModeSUrl = function(url) {
    this.modes_url = url;
};

HfdlMessagePanel.prototype.render = function() {
    $(this.el).append($(
        '<table>' +
            '<thead><tr>' +
                '<th class="timestamp">Time</th>' +
                '<th class="flight">Flight</th>' +
                '<th class="aircraft">Aircraft</th>' +
                '<th class="data">Data</th>' +
            '</tr></thead>' +
            '<tbody></tbody>' +
        '</table>'
    ));
};

HfdlMessagePanel.prototype.pushMessage = function(msg) {
    var color = msg.color?  msg.color : '#00000000';
    var data  = msg.type?   msg.type : '';

    // Only linkify ICAO-compliant flight IDs
    var flight =
      !msg.flight? ''
    : !msg.flight.match(/^[A-Z]{3}[0-9]+[A-Z]*$/)? msg.flight
    : Utils.linkify(msg.flight, this.flight_url);

    var aircraft =
      msg.aircraft? Utils.linkify(msg.aircraft, this.flight_url)
    : msg.icao?     Utils.linkify(msg.icao, this.modes_url)
    : '';

    var tstamp =
      msg.msgtime? '<b>' + msg.msgtime + '</b>'
    : msg.time?    msg.time
    : '';

    // Add location, altitude, speed, etc
    var data = '';
    if (msg.lat && msg.lon) {
        data += '@' + msg.lat.toFixed(4) + ',' + msg.lon.toFixed(4);
    }
    if (msg.altitude)    data += ' &UpArrowBar;' + msg.altitude + 'ft';
    if (msg.vspeed>0)    data += ' &UpperRightArrow;' + msg.vspeed + 'ft/m';
    if (msg.vspeed<0)    data += ' &LowerRightArrow;' + (-msg.vspeed) + 'ft/m';
    if (msg.speed)       data += ' &rightarrow;' + msg.speed + 'kt';
    if (msg.origin)      data += ' &lsh;' + msg.origin;
    if (msg.destination) data += ' &rdsh;' + msg.destination;

    // If no location data in the message, use message type as data
    if (!data.length && msg.type) data = msg.type;

    // Make data point to the map
    if (data.length && msg.mapid) data = Utils.linkToMap(msg.mapid, data);

    // Append report
    var $b = $(this.el).find('tbody');
    $b.append($(
        '<tr>' +
            '<td class="timestamp">' + tstamp + '</td>' +
            '<td class="flight">' + flight + '</td>' +
            '<td class="aircraft">' + aircraft + '</td>' +
            '<td class="data" style="text-align:left;">' + data + '</td>' +
        '</tr>'
    ).css('background-color', color).css('color', '#000'));

    // Append messsage if present
    if (msg.message) {
        $b.append($(
            '<tr><td class="message" colspan="4">' + Utils.htmlEscape(msg.message) + '</td></tr>'
        ))
    }

    // Jump list to the last received message
    this.scrollToBottom();
};

$.fn.hfdlMessagePanel = function() {
    if (!this.data('panel')) {
        this.data('panel', new HfdlMessagePanel(this));
    }
    return this.data('panel');
};

AdsbMessagePanel = function(el) {
    MessagePanel.call(this, el);
    this.clearButton.css('display', 'none');
    this.flight_url = null;
    this.modes_url = null;
    this.receiver_pos = null;
}

AdsbMessagePanel.prototype = Object.create(MessagePanel.prototype);

AdsbMessagePanel.prototype.supportsMessage = function(message) {
    return message['mode'] === 'ADSB-LIST';
};

AdsbMessagePanel.prototype.setReceiverPos = function(pos) {
    if (pos.lat && pos.lon) this.receiver_pos = pos;
};

AdsbMessagePanel.prototype.setFlightUrl = function(url) {
    this.flight_url = url;
};

AdsbMessagePanel.prototype.setModeSUrl = function(url) {
    this.modes_url = url;
};

AdsbMessagePanel.prototype.render = function() {
    $(this.el).append($(
        '<table>' +
            '<thead><tr>' +
                '<th class="flight">Flight</th>' +
                '<th class="aircraft">Aircraft</th>' +
                '<th class="squawk">Squawk</th>' +
                '<th class="distance">Dist</th>' +
                '<th class="altitude">Alt&nbsp;(ft)</th>' +
                '<th class="speed">Speed&nbsp;(kt)</th>' +
                '<th class="rssi">Signal</th>' +
            '</tr></thead>' +
            '<tbody></tbody>' +
        '</table>'
    ));
};

AdsbMessagePanel.prototype.pushMessage = function(msg) {
    // Must have list of aircraft
    if (!msg.aircraft) return;

    // Create new table body
    var body = '';
    var odd = false;
    msg.aircraft.forEach(entry => {
        // Signal strength
        var rssi = entry.rssi? entry.rssi + '&nbsp;dB' : '';

        // Flight identificators
        var flight =
          entry.flight? Utils.linkify(entry.flight, this.flight_url)
        : '';
        var aircraft =
          entry.aircraft? Utils.linkify(entry.aircraft, this.flight_url)
        : entry.icao?     Utils.linkify(entry.icao, this.modes_url)
        : '';

        // Altitude and climb / descent
        var alt  = entry.altitude? '' + entry.altitude : '';
        if (entry.vspeed) {
            var vspeed = entry.vspeed;
            vspeed = vspeed>0? vspeed + '&uarr;' : (-vspeed) + '&darr;';
            alt    = vspeed + '&nbsp'.repeat(6 - alt.length) + alt;
        }

        // Speed and direction
        var speed = entry.speed? '' + entry.speed : '';
        if (entry.course) {
            var dir = Utils.degToCompass(entry.course);
            speed = dir + '&nbsp'.repeat(5 - speed.length) + speed;
        }

        // Replace squawk with emergency status, if present
        var squawk = entry.squawk? entry.squawk : '';
        if (entry.emergency && (entry.emergency!=='NONE')) {
            squawk = '<div style="color:white;background-color:red;"><b>&nbsp;'
                + entry.emergency + '&nbsp;</b></div>';
        }

        // Compute distance to the receiver
        var distance = '';
        if (this.receiver_pos && entry.lat && entry.lon) {
            var id = entry.icao?     entry.icao
                   : entry.aircraft? entry.aircraft
                   : entry.flight?   entry.flight
                   : null;

            distance = Utils.distanceKm(entry, this.receiver_pos) + '&nbsp;km';
            if (id) distance = Utils.linkToMap(id, distance);
        }

        body += '<tr style="background-color:' + (odd? '#E0FFE0':'#FFFFFF') + ';">'
            + '<td class="flight">'   + flight   + '</td>'
            + '<td class="aircraft">' + aircraft + '</td>'
            + '<td class="squawk">'   + squawk   + '</td>'
            + '<td class="distance">' + distance + '</td>'
            + '<td class="altitude">' + alt      + '</td>'
            + '<td class="speed">'    + speed    + '</td>'
            + '<td class="rssi">'     + rssi     + '</td>'
            + '</tr>\n';
        odd = !odd;
    });

    // Assign new table body
    $(this.el).find('tbody').html(body);
};

$.fn.adsbMessagePanel = function() {
    if (!this.data('panel')) {
        this.data('panel', new AdsbMessagePanel(this));
    }
    return this.data('panel');
};

IsmMessagePanel = function(el) {
    MessagePanel.call(this, el);
    this.initClearTimer();
    // These are basic message attributes
    this.basicInfo = ['mode', 'id', 'model', 'time', 'color'];
}

IsmMessagePanel.prototype = Object.create(MessagePanel.prototype);

IsmMessagePanel.prototype.supportsMessage = function(message) {
    return message['mode'] === 'ISM';
};

IsmMessagePanel.prototype.render = function() {
    $(this.el).append($(
        '<table>' +
            '<thead><tr>' +
                '<th class="address">ID</th>' +
                '<th class="device">Device</th>' +
                '<th class="timestamp">Time</th>' +
            '</tr></thead>' +
            '<tbody></tbody>' +
        '</table>'
    ));
};

IsmMessagePanel.prototype.formatAttr = function(msg, key) {
    return('<td class="attr" colspan="2">' +
        '<div style="border-bottom:1px dotted;">' +
        '<span style="float:left;">' + key + '</span>' +
        '<span style="float:right;">' + msg[key] + '</span>' +
        '</div></td>'
    );
};

IsmMessagePanel.prototype.pushMessage = function(msg) {
    // Get basic information, assume white color if missing
    var address = msg.hasOwnProperty('id')? msg.id : "???";
    var device  = msg.hasOwnProperty('model')? msg.model : "";
    var tstamp  = msg.hasOwnProperty('time')? msg.time : "";
    var color   = msg.hasOwnProperty('color')? msg.color : "#FFF";

    // Append message header (address, time, etc)
    var $b = $(this.el).find('tbody');
    $b.append($(
        '<tr>' +
            '<td class="address">' + address + '</td>' +
            '<td class="device">' + device + '</td>' +
            '<td class="timestamp" style="text-align:right;" colspan="2">' + tstamp + '</td>' +
        '</tr>'
    ).css('background-color', color).css('color', '#000'));

    // Append attributes in pairs, skip basic information
    var last = null;
    for (var key in msg) {
        if (this.basicInfo.indexOf(key) < 0) {
            var cell = this.formatAttr(msg, key);
            if (!last) {
                last = cell;
            } else {
                $b.append($('<tr>' + last + cell + '</tr>'));
                last = null;
            }
        }
    }

    // Last row
    if (last) $b.append($('<tr>' + last + '<td class="attr"/></tr>'));

    // Jump list to the last received message
    this.scrollToBottom();
};

$.fn.ismMessagePanel = function() {
    if (!this.data('panel')) {
        this.data('panel', new IsmMessagePanel(this));
    }
    return this.data('panel');
};

RdsMessagePanel = function(el) {
    this.el = el;
    this.render();
}

RdsMessagePanel.prototype = Object.create(MessagePanel.prototype);

RdsMessagePanel.prototype.supportsMessage = function(message) {
    return message['mode'] === 'RDS';
};

RdsMessagePanel.prototype.render = function() {
    $(this.el).append($(
        '<div>' +
            '<span id="rds-name" class="name" />' +
            '<span id="rds-pi" class="pi" />' +
        '</div>' +
        '<div id="rds-ps" class="ps" />' +
        '<div id="rds-text" class="text" />' +
        '<div>' +
            '<span id="rds-pty" class="pty" />' +
            '<span id="rds-ct" class="ct" />' +
        '</div>'
    ));
};

RdsMessagePanel.prototype.pushMessage = function(msg) {
    var pi   = msg.hasOwnProperty('pi')? 'PI:' + msg.pi : '';
    var ps   = msg.hasOwnProperty('ps')? msg.ps : '---';
    var ct   = msg.hasOwnProperty('clock_time')? msg.clock_time : '';
    var pty  = msg.hasOwnProperty('prog_type')? msg.prog_type : '';
    var name = msg.hasOwnProperty('callsign')? msg.callsign : '';
    var freq = msg.hasOwnProperty('frequency')? msg.frequency : 0;
    var text = msg.hasOwnProperty('radiotext')? msg.radiotext : '';

    // Combine callsign with frequency
    $('#rds-name').html(
        name + (name && freq? ' ':'') +
        (freq? '' + (freq/1000000).toFixed(1) : '')
    );

    // CT = "2023-12-08T16:40:00-05:00" => "2023-12-08 16:40:00"
    if (ct) {
        var matches = ct.match(/^(.*)T(.*)[Z+\-]/);
        if (matches) ct = matches[1] + '&nbsp;' + matches[2];
    }

    $('#rds-pi').html(pi);
    $('#rds-ps').html(Utils.htmlEscape(ps));
    $('#rds-text').html(Utils.htmlEscape(text));
    $('#rds-pty').html(pty);
    $('#rds-ct').html(ct);
};

$.fn.rdsMessagePanel = function() {
    if (!this.data('panel')) {
        this.data('panel', new RdsMessagePanel(this));
    }
    return this.data('panel');
};

SstvMessagePanel = function(el) {
    MessagePanel.call(this, el);
    this.initClearTimer();
}

SstvMessagePanel.prototype = Object.create(MessagePanel.prototype);

SstvMessagePanel.prototype.supportsMessage = function(message) {
    return message['mode'] === 'SSTV';
};

SstvMessagePanel.prototype.render = function() {
    $(this.el).append($(
        '<table>' +
            '<thead><tr>' +
                '<th class="message">TV</th>' +
            '</tr></thead>' +
            '<tbody></tbody>' +
        '</table>'
    ));
};

SstvMessagePanel.prototype.pushMessage = function(msg) {
    var $b = $(this.el).find('tbody');
    if(msg.hasOwnProperty('message')) {
        // Append a new debug message text
// See service log for debug output instead
//        $b.append($('<tr><td class="message">' + msg.message + '</td></tr>'));
//        this.scrollToBottom();
    }
    else if(msg.width>0 && msg.height>0 && !msg.hasOwnProperty('line')) {
        var f = msg.frequency>0? ' at ' + Math.floor(msg.frequency/1000) + 'kHz' : '';
        var h = '<div>' + msg.timestamp + ' ' + msg.width + 'x' + msg.height +
            ' ' + msg.sstvMode + f + '</div>';
        var c = '<div onclick="saveCanvas(\'' + msg.filename + '\');">' +
            '<canvas class="frame" id="' + msg.filename +
            '" width="' + msg.width + '" height="' + msg.height +
            '"></canvas></div>';
        // Append a new canvas
        $b.append($('<tr><td class="message">' + h + c + '</td></tr>'));
        $b.scrollTop($b[0].scrollHeight);
        // Save canvas context and dimensions for future use
        this.ctx    = $(this.el).find('canvas').get(-1).getContext("2d");
        this.width  = msg.width;
        this.height = msg.height;
    }
    else if(msg.width>0 && msg.height>0 && msg.line>=0 && msg.hasOwnProperty('pixels')) {
        // Will copy pixels to img
        var pixels = atob(msg.pixels);
        var img = this.ctx.createImageData(msg.width, 1);
        // Convert BMP BGR pixels into HTML RGBA pixels
        for (var x = 0; x < msg.width; x++) {
            img.data[x*4 + 0] = pixels.charCodeAt(x*3 + 2);
            img.data[x*4 + 1] = pixels.charCodeAt(x*3 + 1);
            img.data[x*4 + 2] = pixels.charCodeAt(x*3 + 0);
            img.data[x*4 + 3] = 0xFF;
        }
        // Render scanline
        this.ctx.putImageData(img, 0, msg.line);
    }
};

$.fn.sstvMessagePanel = function() {
    if (!this.data('panel')) {
        this.data('panel', new SstvMessagePanel(this));
    }
    return this.data('panel');
};

FaxMessagePanel = function(el) {
    MessagePanel.call(this, el);
    this.initClearTimer();
}

FaxMessagePanel.prototype = Object.create(MessagePanel.prototype);

FaxMessagePanel.prototype.supportsMessage = function(message) {
    return message['mode'] === 'Fax';
};

FaxMessagePanel.prototype.render = function() {
    $(this.el).append($(
        '<table>' +
            '<thead><tr>' +
                '<th class="message">Fax</th>' +
            '</tr></thead>' +
            '<tbody></tbody>' +
        '</table>'
    ));
};

FaxMessagePanel.prototype.pushMessage = function(msg) {
    var $b = $(this.el).find('tbody');
    if(msg.hasOwnProperty('message')) {
        // Append a new debug message text
// See service log for debug output instead
//        $b.append($('<tr><td class="message">' + msg.message + '</td></tr>'));
//        this.scrollToBottom();
    }
    else if(msg.width>0 && msg.height>0 && !msg.hasOwnProperty('line')) {
        var f = msg.frequency>0? ' at ' + Math.floor(msg.frequency/1000) + 'kHz' : '';
        var h = '<div>' + msg.timestamp + ' ' + msg.width + 'x' + msg.height +
            ' ' + msg.faxMode + f + '</div>';
        var c = '<div onclick="saveCanvas(\'' + msg.filename + '\');">' +
            '<canvas class="frame" id="' + msg.filename +
            '" width="' + msg.width + '" height="' + msg.height +
            '"></canvas></div>';
        // Append a new canvas
        $b.append($('<tr><td class="message">' + h + c + '</td></tr>'));
        this.scrollToBottom();
        // Save canvas context and dimensions for future use
        this.ctx    = $(this.el).find('canvas').get(-1).getContext("2d");
        this.width  = msg.width;
        this.height = msg.height;
    }
    else if(msg.width>0 && msg.height>0 && msg.line>=0 && msg.hasOwnProperty('pixels')) {
        // Will copy pixels to img
        var img = this.ctx.createImageData(msg.width, 1);
        var pixels;

        // Unpack RLE-compressed line of pixels
        if(!msg.rle) {
            pixels = atob(msg.pixels);
        } else {
            var rle = atob(msg.pixels);
            pixels = '';
            for(var x=0 ; x<rle.length ; ) {
                var c = rle.charCodeAt(x);
                if(c<128) {
                    pixels += rle.slice(x+1, x+c+2);
                    x += c + 2;
                } else {
                    pixels += rle.slice(x+1, x+2).repeat(c-128+2)
                    x += 2;
                }
            }
        }

        // Convert BMP BGR pixels into HTML RGBA pixels
        if(msg.depth==8) {
            for(var x=0, y=0; x<msg.width; x++) {
                var c = pixels.charCodeAt(x);
                img.data[y++] = c;
                img.data[y++] = c;
                img.data[y++] = c;
                img.data[y++] = 0xFF;
            }
        } else {
            for (var x = 0; x < msg.width; x++) {
                img.data[x*4 + 0] = pixels.charCodeAt(x*3 + 2);
                img.data[x*4 + 1] = pixels.charCodeAt(x*3 + 1);
                img.data[x*4 + 2] = pixels.charCodeAt(x*3 + 0);
                img.data[x*4 + 3] = 0xFF;
            }
        }

        // Render scanline
        this.ctx.putImageData(img, 0, msg.line);
    }
};

$.fn.faxMessagePanel = function() {
    if (!this.data('panel')) {
        this.data('panel', new FaxMessagePanel(this));
    }
    return this.data('panel');
};
