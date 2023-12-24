//
// User Interface functions
//

function UI() {}

// We start with these values
UI.theme = 'default';
UI.frame = false;
UI.opacity = 100;
UI.volume = -1;
UI.volumeMuted = -1;
UI.nrThreshold = 0;
UI.nrEnabled = false;
UI.wheelSwap = false;
UI.spectrum = false;

// Foldable UI sections and their initial states
UI.sections = {
    'modes'   : true,
    'controls': true,
    'settings': false,
    'display' : true
};

// Load UI settings from local storage.
UI.loadSettings = function() {
    this.setTheme(LS.has('ui_theme')? LS.loadStr('ui_theme') : 'default');
    this.setOpacity(LS.has('ui_opacity')? LS.loadInt('ui_opacity') : 100);
    this.toggleFrame(LS.has('ui_frame')? LS.loadBool('ui_frame') : false);
    this.toggleWheelSwap(LS.has('ui_wheel')? LS.loadBool('ui_wheel') : false);
    this.toggleSpectrum(LS.has('ui_spectrum')? LS.loadBool('ui_spectrum') : false);
    this.setNR(LS.has('nr_threshold')? LS.loadInt('nr_threshold') : false);
    this.toggleNR(LS.has('nr_enabled')? LS.loadBool('nr_enabled') : false);

    // Get volume and mute
    var volume = LS.has('volume')? LS.loadInt('volume') : 50;
    var muted  = LS.has('volumeMuted')? LS.loadInt('volumeMuted') : -1;
    if (muted >= 0) {
        if (this.volumeMuted < 0) this.toggleMute(true);
        this.volumeMuted = muted;
    } else {
        if (this.volumeMuted >= 0) this.toggleMute(false);
        this.setVolume(volume);
    }

    // Toggle UI sections
    for (section in this.sections) {
        var id = 'openwebrx-section-' + section;
        var el = document.getElementById(id);
        if (el) this.toggleSection(el,
            LS.has(id)? LS.loadBool(id) : this.sections[section]
        );
    }
};

//
// Volume Controls
//

// Set audio volume in 0..150 range.
UI.setVolume = function(x) {
    x = Math.round(parseFloat(x));
    if (this.volume != x) {
        this.volume = x;
        LS.save('volume', x);
        $('#openwebrx-panel-volume').val(x)
        if (audioEngine) audioEngine.setVolume(x / 100);
    }
};

// Toggle audio muting.
UI.toggleMute = function(on) {
    // If no argument given, toggle mute
    var toggle = typeof(on) === 'undefined';
    var $muteButton = $('.openwebrx-mute-button');
    var $volumePanel = $('#openwebrx-panel-volume');

    if ($volumePanel.prop('disabled') && (toggle || !on)) {
        this.setVolume(this.volumeMuted);
        this.volumeMuted = -1;
        $muteButton.removeClass('muted');
        $volumePanel.prop('disabled', false);
        LS.save('volumeMuted', this.volumeMuted);
    } else if (toggle || on) {
        this.volumeMuted = this.volume;
        this.setVolume(0);
        $muteButton.addClass('muted');
        $volumePanel.prop('disabled', true);
        LS.save('volumeMuted', this.volumeMuted);
    }
};

//
// Noise Reduction Controls
//

// Set noise reduction threshold in decibels.
UI.setNR = function(x) {
    x = Math.round(parseFloat(x));
    if (this.nrThreshold != x) {
        this.nrThreshold = x;
        LS.save('nr_threshold', x);
        $('#openwebrx-panel-nr').attr('title', 'Noise level (' + x + ' dB)').val(x);
        this.updateNR();
    }
};

// Toggle noise reduction function.
UI.toggleNR = function(on) {
    var $nrPanel = $('#openwebrx-panel-nr');

    // If no argument given, toggle NR
    this.nrEnabled = !!(typeof(on)==='undefined'? $nrPanel.prop('disabled') : on);

    LS.save('nr_enabled', this.nrEnabled);
    $nrPanel.prop('disabled', !this.nrEnabled);
    this.updateNR();
}

// Send changed noise reduction parameters to the server.
UI.updateNR = function() {
    ws.send(JSON.stringify({
        'type': 'connectionproperties',
        'params': {
            'nr_enabled': this.nrEnabled,
            'nr_threshold': this.nrThreshold
        }
    }));
}

//
// Look & Feel Controls
//

UI.toggleSection = function(el, on) {
    // If no argument given, toggle section
    var toggle = typeof(on) === 'undefined';

    var next_el = el.nextElementSibling;
    if (next_el) {
        if ((next_el.classList.contains('closed')) && (toggle || on)) {
            el.innerHTML = el.innerHTML.replace('\u25B4', '\u25BE');
            next_el.classList.remove('closed');
            LS.save(el.id, true);
        } else if (toggle || !on) {
            el.innerHTML = el.innerHTML.replace('\u25BE', '\u25B4');
            next_el.classList.add('closed');
            LS.save(el.id, false);
        }
    }
};

// Show or hide spectrum display
UI.toggleSpectrum = function(on) {
    // If no argument given, toggle spectrum
    if (typeof(on) === 'undefined') on = !this.spectrum;

    this.spectrum = on;
    LS.save('ui_spectrum', on);
    if (spectrum) spectrum.toggle(on);
};

// Show or hide frame around receiver and other panels.
UI.toggleFrame = function(on) {
    // If no argument given, toggle frame
    if (typeof(on) === 'undefined') on = !this.frame;

    if (this.frame != on) {
        this.frame = on;
        LS.save('ui_frame', on);
        $('#openwebrx-frame-checkbox').attr('checked', on);

        var border = on ? '2px solid white' : '2px solid transparent';
        $('#openwebrx-panel-receiver').css( 'border', border);
        $('#openwebrx-dialog-bookmark').css('border', border);
//        $('#openwebrx-digimode-canvas-container').css('border', border);
//        $('.openwebrx-message-panel').css('border', border);
    }
};

// Get current mouse wheel function
UI.getWheelSwap = function() {
    return this.wheelSwap;
};

// Set mouse wheel function (zooming when swapped)
UI.toggleWheelSwap = function(on) {
    // If no argument given, toggle wheel swap
    if (typeof(on) === 'undefined') on = !this.wheelSwap;

    if (this.wheelSwap != on) {
        this.wheelSwap = on;
        LS.save('ui_wheel', on);
        $('#openwebrx-wheel-checkbox').attr('checked', on);
    }
};

// Set user interface opacity in 10..100% range.
UI.setOpacity = function(x) {
    // Limit opacity to 10..100% range
    x = x<10? 10 : x>100? 100 : x;

    if (this.opacity != x) {
        this.opacity = x;
        LS.save('ui_opacity', x);
        $('.openwebrx-panel').css('opacity', x/100);
        $('#openwebrx-opacity-slider')
            .attr('title', 'Opacity (' + Math.round(x) + '%)')
            .val(x);
    }
};

// Set user interface theme.
UI.setTheme = function(theme) {
    // Do not set twice
    if (this.theme === theme) return;

    // Save current theme name
    this.theme = theme;
    LS.save('ui_theme', theme);

    // Set selector
    var lb = $('#openwebrx-themes-listbox');
    lb.val(theme);

    // Remove existing theme
    var opts = lb[0].options;
    for(j=0 ; j<opts.length ; j++) {
        $('body').removeClass('theme-' + opts[j].value);
    }
    $('body').removeClass('has-theme');

    // Apply new theme
    if (theme && (theme != '') && (theme != 'default')) {
        $('body').addClass('theme-' + theme);
        $('body').addClass('has-theme');
    }
};
