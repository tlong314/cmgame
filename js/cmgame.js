/**
 * CMGame
 *
 * A JS engine for games inspired by college math.
 * Built for use on the website
 *
 *     collegemathgames.com
 *
 * but also available to use, free, under the MIT license.
 * Among other things, this engine handles:
 *
 * - Automatically scaling canvas to current page size via
 *     CSS transforms, while maintaining aspect ratio
 * - Preloading, processing, and playing audio (even in iOS).
 * - Managing splash screen, including loading meter
 * - Automatic double-buffering with an offscreen canvas.
 * - Advanced canvas text drawing, such as
 *     drawing a sentence with multiple fonts.
 * - Standard engine features, such as managing sprite velocity and position,
 *     collision detection, and asset preloading
 * - Extra engine features for 2D games, such as determining sprite's
 *     response to reaching a screen boundary, or using a math function to
 *     define a sprite's path
 * - Randomized variables: integers, floats, colors
 * - Other minor code optimizations
 * - starting/pausing/unpausing gameplay
 * - Dynamically changing frame rate (FPS)
 * - Game screenshots (if backgrounds are not drawn to screen, background is "guessed")
 * - Game videos (e.g., for promotion)
 * - Overcoming various iOS/Android annoyances (playing audio,
 *      preventing double-click zoom, preventing haptic feedback on long press)
 * - Providing a predefined modern color palette
 * - Allowing dynamic drawing from the user
 *
 * @author Tim S. Long, PhD
 * @copyright 2021 Tim S. Long, PhD
 */

"use strict";

// Add some useful static values
Math.TAU = Math.TAU || Math.PI * 2; // Convenience for drawing and polar calculations
Math.SQRT3 = Math.SQRT3 || Math.sqrt(3); // Convenience for unit circle, etc.
Math.SQRT5 = Math.SQRT5 || Math.sqrt(5); // Ditto
Math.PHI = Math.PHI || .5 * (1 + Math.SQRT5); // Golden ratio

// These will be used to control FPS speed
window.requestNextFrame = window.requestAnimationFrame;
window.cancelNextFrame = window.cancelAnimationFrame;

// For minimal code, we let user omit <body> tag
window.documentBodyElm = document.body || document.documentElement;

/**
 * Manage web audio logic, overcoming iOS bug
 * that seems to prevent web audio playing,
 * even after user interaction.
 * Majority of this audio-handling script is based on this blog:
 * https://artandlogic.com/2019/07/unlocking-the-web-audio-api/
 */

// Dev can redefine this before instantiating game
window.CM_SILENCE_PATH = "js/cmgame/audio/silencesecond.wav";

/**
 * Creates a sound handler, CMSound,
 * with methods:
 * CMSound.load("") // load the file with the given path, if not loaded (used internally)
 * CMSound.play("") // play the file with the given path
 * CMSound.pause("") // pause the file with the given path
 * CMSound.loop("") // plays the file, looping it
 * CMSound.stop("") // pauses the file and returns start time to 0
 */
const CMSound = (function() {

	/**
	 * Playing custom audio element first, with one
	 * second of silence, as suggested by this blog:
	 * https://adactio.medium.com/web-audio-api-weirdness-on-ios-754d14074fa2
	 * This seems to overcome some issues that
	 * persist even with the code below.
	 */
	let silentAudio = new Audio();

	// Or replace this with the path to your own silent audio file
	silentAudio.src = window.CM_SILENCE_PATH;

	let audUnlocked = false;
	let unlockCalled = false;

	let sourceNodes = {};

    const _af_buffers = new Map(),
        _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    let _isUnlocked = false;

    /**
     * A shim to handle browsers which still expect the old callback-based decodeAudioData,
     * notably iOS Safari - as usual.
     * @param arraybuffer
     * @returns {Promise<*>}
     * @private
     */
    function _decodeShim(arraybuffer) {
        return new Promise((resolve, reject) => {
            _audioCtx.decodeAudioData(arraybuffer, (buffer) => {
                return resolve(buffer);
            }, (err) => {
                return reject(err);
            });
        });
    }

    /**
     * Some browsers/devices will only allow audio to be played after a user interaction.
     * Attempt to automatically unlock audio on the first user interaction.
     * Concept from: http://paulbakaus.com/tutorials/html5/web-audio-on-ios/
     * Borrows in part from: https://github.com/goldfire/howler.js/blob/master/src/howler.core.js
     */
    function _unlockAudio() {
        if (_isUnlocked) return;

        // Scratch buffer to prevent memory leaks on iOS.
        // See: https://stackoverflow.com/questions/24119684/web-audio-api-memory-leaks-on-mobile-platforms
        const _scratchBuffer = _audioCtx.createBuffer(1, 1, 22050);

        // We call this when user interaction will allow us to unlock
        // the audio API.
        const unlock = function (e) {
			// e?.preventDefault(); // Causes some issues with our passive events, and is probably unnecessary

			silentAudio.onended = function() {
				var source = _audioCtx.createBufferSource();
				source.buffer = _scratchBuffer;
				source.connect(_audioCtx.destination);

				// Play the empty buffer.
				source.start(0);

				// Calling resume() on a stack initiated by user gesture is
				// what actually unlocks the audio on Chrome >= 55.
				if (typeof _audioCtx.resume === 'function') {
					_audioCtx.resume();
				}

				// Once the source has fired the onended event, indicating it did indeed play,
				// we can know that the audio API is now unlocked.
				source.onended = function () {
					source.disconnect(0); // No need to keep the generated silence

					// Don't bother trying to unlock the API more than once!
					_isUnlocked = true;

					// Remove the click/touch listeners.
					document.removeEventListener('touchstart', unlock, true);
					document.removeEventListener('touchend', unlock, true);
					document.removeEventListener('click', unlock, true);

					if(!unlockCalled) {
						unlockCalled = true;
					}
				};
			}; // silentAudio.onended

			if(!audUnlocked) {
				audUnlocked = true;
				silentAudio.play();
			}
        };

        // Setup click/touch listeners to capture the first interaction
        // within this context.
		document.addEventListener('touchstart', unlock, true);
        document.addEventListener('touchend', unlock, true);
        document.addEventListener('click', unlock, true);
    }

    /**
     * Allow the requester to load a new sfx, specifying a file to load.
     * We store the decoded audio data for future (re-)use.
     * @param {string} sfxFile - The path of the audio file to load
     * @returns {Promise<AudioBuffer>}
     */
    async function load (sfxFile) {
        if (_af_buffers.has(sfxFile)) {
            return _af_buffers.get(sfxFile);
        }

        const _sfxFile = await fetch(sfxFile);
        const arraybuffer = await _sfxFile.arrayBuffer();
        let audiobuffer;

        try {
            audiobuffer = await _audioCtx.decodeAudioData(arraybuffer);
        } catch (e) {
            // Browser wants older callback based usage of decodeAudioData
            audiobuffer = await _decodeShim(arraybuffer);
        }

        _af_buffers.set(sfxFile, audiobuffer);

        return audiobuffer;
    };

    /**
     * Play the specified file, loading it first - either retrieving it from the saved buffers, or fetching
     * it from the network.
     * @param {string} sfxFile - The path of the audio file to play
	 * @param {boolean} [loopIfTrue=false] - Whether to loop the file
     * @returns {Promise<AudioBufferSourceNode>}
     */
    function play (sfxFile, loopIfTrue=false) {

		// Added to improve performance, rather than call load on each play
		if(_af_buffers.has(sfxFile)) {
			sourceNodes[sfxFile] = _audioCtx.createBufferSource();
            sourceNodes[sfxFile].loop = !!loopIfTrue;
			sourceNodes[sfxFile].buffer = _af_buffers.get(sfxFile);
            sourceNodes[sfxFile].connect(_audioCtx.destination);
            sourceNodes[sfxFile].start();
			return;
		}

        return load(sfxFile).then((audioBuffer) => {
            sourceNodes[sfxFile] = _audioCtx.createBufferSource();
			sourceNodes[sfxFile].loop = !!loopIfTrue;
            sourceNodes[sfxFile].buffer = audioBuffer;
            sourceNodes[sfxFile].connect(_audioCtx.destination);
            sourceNodes[sfxFile].start();

            return sourceNodes[sfxFile];
        });
    };

	// Attempt initial unlock
    _unlockAudio();

	return {
		play: play,
		pause: function(sfxFile) {
			if(typeof sourceNodes[sfxFile] !== "undefined")
				sourceNodes[sfxFile].stop();
		},
		stop: function(sfxFile) {
			if(typeof sourceNodes[sfxFile] !== "undefined")
				sourceNodes[sfxFile].stop(0);
		},
		load: load,
		loop: function(src) {
			play(src, true);
		}
	};
}());

/**
 * A class to manage random selections.
 * Some initial methods and properties
 * are based on Unity/C#, and some
 * on Java.
 * You can create an instance to use as
 * a generator for ints and booleans,
 * or access various properties using
 * static getters.
 *
 * CMRandom.value; // will be a random float, similar to Random.value in Unity
 * CMRandom.color; // will be a random color from our predefined colors
 *
 * let random = new CMRandom();
 * random.nextInt(); // will be a random integer
 *
 */
class CMRandom {
	constructor() {

		// private, internal generating function
		let intGenerator = (function* () {

			// Generates next integer, from large bounds
			while(true) {
				yield CMRandom.range(-(2**31) + 1, 2**31);
			}

		})();

		/**
		 * Mimicks Java's nextInt() behavior, and
		 * returns random integer.
		 * @param {number} [n] - If present, uses range [0, n)
		 * @returns {number}
		 */
		this.nextInt = function(n) {
			if(typeof n !== "undefined") {
				if(n < 0) {
					throw new Error("CMRandom.nextInt must take nonnegative bound (or no bound)");
				}

				return CMRandom.range(0, n);
			}
			else {
				return intGenerator.next().value;
			}
		};

		// private, internal generating function
		let booleanGenerator = (function* () {

			// Generates next boolean
			while(true) {
				yield !!CMRandom.range(0, 2);
			}

		})();

		/**
		 * Mimicks Java's nextBoolean() behavior, and
		 * returns random boolean. Essentially
		 * an alias for CMRandom.boolean
		 * @returns {boolean}
		 */
		this.nextBoolean = function() {
			return booleanGenerator.next().value;
		};
	}
}

/**
 * Randomly picks number between two. Similar to
 * Random.Range of C#; max is an exclusive upper
 * bound if min and max are both integers; otherwise
 * it is inclusive.
 * @param {number} min - Lower bound
 * @param {number} max - Upper bound
 * @returns {number} Necessarily integer only if both inputs are integers
 */
CMRandom.range = (min, max) => {

	// max is exclusive for integer inputs (but if max = min, return min)
	if(Number.isInteger(min) && Number.isInteger(max)) {	
		return (min + (Math.random() * (max - min)) >> 0 );
	}

	// at least one of the parameters is a non-integer float value; max is inclusive
	return (min + Math.random() * (max - min));
};

/**
 * Randomly picks number between two,
 * excluding zero (otherwise similar to .range)
 * @param {number} min - Lower bound
 * @param {number} max - Upper bound
 * @returns {number} Necessarily integer only if both inputs are integers
 */
CMRandom.nonzero = (min, max) => {

	// zero isn't even in this range
	if(min > 0 || max < 0) {
		return CMRandom.range(min, max);
	}

	let pick = 0;

	// max is exclusive for integer inputs (but if max = min, return min)
	if(Number.isInteger(min) && Number.isInteger(max)) {

		// Integers are easy
		// Basically shift "positive stack" left by 1, then add if one of its elements were picked
		pick = CMRandom.range(min, max - 1);
		if(pick >= 0) {
			pick++;
		}

		return pick;
	}

	// at least one of the parameters is a non-integer float value; max is inclusive
	while(pick === 0) {
		pick = (min + Math.random() * (max - min));
	}

	return pick;
};

/**
 * Below we use ECMAScript getters
 * to define quick access as static
 * properties. Examples:
 *
 * CMRandom.value; // will be a random float
 * CMRandom.color; // will be a random color from our predefined colors
 */

Object.defineProperties(CMRandom, {
	
	/**
	 * Picks a random radian value between 
	 * 0 (inclusive) and 2pi (exclusive).
	 * Useful for games with polar coordinates.
	 */
	radian: {
		get: function() {
			let val = CMRandom.range(0, Math.TAU);
			if(val >= Math.TAU) // >= to account for possible machine rounding errors
				val = 0;

			return val;
		}
	},

	/**
	 * Picks a random degree value between
	 * 0 (inclusive) and 360 (exclusive)
	 */
	degree: {
		get: function() {
			return CMRandom.range(0, 360);
		}
	},

	/**
	 * Picks a random 7-digit float value
	 * between 0 (inclusive) and 1 (exclusive)
	 */	
	value: {
		get: function() {
			// Capping `float` at 7 decimal digits
			return parseFloat(Math.random().toFixed(7));
		}
	},

	/**
	 * Randomly picks an opaque rgb color string from
	 * our predefined swatch, including grayscale colors
	 * To avoid grayscale, use CMGame.colorscale
	 * @returns {string}
	 */
	color: {
		get: function() {
			let colorArray = Object.keys(CMGame.Color).filter((name) => {
				return (name.indexOf("TRANS") === -1);
			});

			return CMGame.Color[colorArray[CMRandom.range(0, colorArray.length)]];
		}
	},

	/**
	 * Randomly picks an opaque rgb color string from
	 * our predefined swatch, not including black/white/gray;
	 * i.e., picks an opaque "polychrome" color
	 * @returns {string}
	 */
	colorscale: {
		get: function() {
			let colorArray = Object.keys(CMGame.Color).filter((name) => {
				return !(name.match(/GRAY|BLACK|WHITE|TRANS/));
			});

			return CMGame.Color[colorArray[CMRandom.range(0, colorArray.length)]];
		}
	},

	/**
	 * Randomly picks an opaque rgb gray, black, or white
	 * color from our predefined swatch, 
	 * @returns {string}
	 */
	grayscale: {
		get: function() {
			let colorArray = Object.keys(CMGame.Color).filter((name) => {
				return !!(name.match(/GRAY|BLACK|WHITE/));
			});

			return CMGame.Color[colorArray[CMRandom.range(0, colorArray.length)]];
		}
	},

	/**
	 * Randomly picks a sign (1 or -1; not 0) to
	 * assign to a positive integer.
	 * @returns {number}
	 */
	sign: {

		get: function() {
			return (-1)**CMRandom.Range(0, 2);
		}
	}
});

/**
 * Randomly picks true or false. Since
 * boolean is a reserved word, we introduce
 * separately from defineProperties above,
 * to avoid possible errors.
 * @returns {boolean}
 */
Object.defineProperty(CMRandom, "boolean", {

	get: function() {
		return !!( (Math.random() * 2) >> 0 );
	}
});

/**
 * Stores numerical information for 2d or 3d points
 * Used for position, velocity, acceleration, etc.
 */
class CMPoint {

	/**
	 * Creates a CMPoint instance
	 * @param {number|object} [x=0] - The x value, or another CMPoint (or similar object)
	 * @param {number} [y=0] - The y value
	 * @param {number} [z=0] - The z value, if relevant
	 */
	constructor(x=0, y=0, z=0) {
		this.x = x;
		this.y = y;
		this.z = z;

		if(typeof x === "object") { // A point or similar object was passed in
			let point = x;
			this.x = point.x || 0;
			this.y = point.y || 0;
			this.z = point.z || 0;
		}
	}

	/**
	 * Determines if another point shares
	 * this one's coordinates (NOT the same
	 * as determining if they are equal
	 * as JavaScript objects).
	 * @param {object|null} otherPoint - A CMPoint instance or similar
	 * @returns {boolean}
	 */
	isPoint(otherPoint) {
		if(!otherPoint) { // e.g., if some null value was passed in
			return false;
		}

		return (this.x === otherPoint.x &&
			this.y === otherPoint.y &&
			(this.z === otherPoint.z ||
				(this.z === 0 && typeof otherPoint.z === "undefined")));
	}

	/**
	 * Returns true if given point is essentially
	 * the same point after accounting for possible
	 * computer rounding errors with float values.
	 * @param {object} otherPoint - A CMPoint instance or similar
	 * @returns {boolean}
	 */
	isAlmost(otherPoint) {
		let otherZ = typeof otherPoint.z === "undefined" ? 0 : otherPoint.z

		return (
			this.game.roundSmall( this.x - otherPoint.x ) &&
			this.game.roundSmall( this.y - otherPoint.y ) &&
			this.game.roundSmall( this.z - otherZ )
		);
	}
}

// Note: this assumes a single game is being loaded, as expected
let domLoaded = false,
	numAudiosToLoad = 0,
	numAudiosLoaded = 0,
	numImagesToLoad = 0,
	numImagesLoaded = 0,
	soundsInitialized = null,
	cmAudioMap = new Map();

// Extend Image class to manage preloading
class CMImageLoad extends Image {
	/**
	 * Creates a CMImageLoad instance
	 * @param {string} imageSrc - The image's location
	 */
	constructor(imageSrc) {
		super();
		numImagesToLoad++;

		let progress = document.getElementById("cmLoadingProgress");
		if(progress !==  null) {
			progress.setAttribute("max", numImagesToLoad + numAudiosToLoad + 1); // +1 for domLoaded
		}

		this.onload = registerImageLoad;
		this.src = imageSrc;
	}
}

// Extend Audio class to manage preloading
class CMAudioLoad extends Audio {
	/**
	 * Creates a CMAudioLoad instance
	 * @param {string} audioSrc - The audio file's location
	 */
	constructor(audioSrc) {
		super();
		numAudiosToLoad++;

		let progress = document.getElementById("cmLoadingProgress");
		if(progress !==  null) {
			progress.setAttribute("max", numImagesToLoad + numAudiosToLoad + 1); // +1 for domLoaded
		}

		this.oncanplaythrough = registerAudioLoad;
		this.src = audioSrc;
		this.load();

		// Clip off ".wav", ".mp3", etc. - use unique file names
		let extensionless = audioSrc.substr(
			audioSrc.lastIndexOf(".")
		);

		// Clip off path before filename (e.g., "http://mysite.com/media/audio/")
		let keyString = extensionless.substr(
			extensionless.lastIndexOf("/") + 1
		);

		cmAudioMap.set(keyString, this);		
		CMSound.load(audioSrc);
	}
}

/** Create "loading" animation of intro progress bar */
const incrementLoadingProgress = () => {
	let progress = document.getElementById("cmLoadingProgress");
	if(progress !==  null) {
		progress.value = parseInt(progress.value) + 1;
	}
};

/**
 * Check if all items have been loaded, then start page
 */
const initializeIfReady = () => {	
	incrementLoadingProgress();

	// If progress bar exists, this condition is same as progress.value == progress.max
	if(numImagesLoaded === numImagesToLoad &&
			numAudiosLoaded === numAudiosToLoad &&
			domLoaded) {

		CMGame.resourcesLoaded = true;
		CMGame.onresourcesload();

		// Fade out splashpage if dev created one
		let splashPage = document.getElementById("cmLoading");
		if(splashPage !== null) {
			splashPage.addEventListener("animationend", e => {
				splashPage.parentNode.removeChild(splashPage);
			}, false);

			splashPage.classList.add("cm-intro-fade");
		}
	}
};

/** Track image preloading */
const registerImageLoad = () => {
	this.loaded = true;

	numImagesLoaded++;
	initializeIfReady();
};

/** Track audio preloading */
const registerAudioLoad = () => {
	this.loaded = true;

	numAudiosLoaded++;
	initializeIfReady();
};

/**
 * A class representing user-drawing sketches
 * over game screen. Useful, e.g., if user
 * wants to use this for diagrams,
 * rather than games.
 */
class CMDoodle {
	constructor(game, opts) {
		this.game = game;

		let options = {};
		let defaults = {
			enabled: true,
			startPoint: null,
			lineWidth: Math.max(game.ctx.lineWidth, 1),
			strokeStyle: CMGame.Color.BLACK,
			fillStyleAbove: CMGame.Color.TRANSPARENT,
			fillStyleBelow: CMGame.Color.TRANSPARENT,
			fillStyleLeft: CMGame.Color.TRANSPARENT,
			fillStyleRight: CMGame.Color.TRANSPARENT
		};

		for(let key in defaults) {
			if(typeof opts[key] !== "undefined") {
				options[key] = opts[key];
			}
			else {
				options[key] = defaults[key];
			}
		}

		this.startPoint = options.startPoint;
		this.lineWidth = options.lineWidth;
		this.strokeStyle = options.strokeStyle;
		this.fillStyleAbove = options.fillStyleAbove;
		this.fillStyleBelow = options.fillStyleBelow;
		this.fillStyleLeft = options.fillStyleLeft;
		this.fillStyleRight = options.fillStyleRight;

		this.points = [ this.startPoint ];

		this.path = new Path2D();
		this.path.moveTo(this.startPoint.x, this.startPoint.y);
		this.pathAbove = new Path2D();
		this.pathBelow = new Path2D();
		this.pathLeft = new Path2D();
		this.pathRight = new Path2D();

		game.currentDoodle = this;
	}

	/**
	 * Erases and removes this particular doodle instance.
	 * Note: this does not erase other doodles from
	 * the screen. To clear all, use {{game instance}}.clearDoodles()
	 */
	clear() {
		this.path = new Path2D();
		CMGame.clearAll( this.points );
		this.game.doodles.splice( this.game.doodles.indexOf( this ), 1);
	}

	/**
	 * Adds a new point to this doodle's path
	 * @param {number|object} xOrPoint - The x value, or point object
	 * @param {number} [y] - The y value (if xOrPoint is not a point)
	 */
	addPoint(xOrPoint, y) {
		let point = {};
		if(typeof xOrPoint === "number") {
			point = {
				x: xOrPoint,
				y: y
			};
		}
		else {
			point = xOrPoint;
		}

		// Do not add point twice in a row
		if(!this.points[this.points.length - 1].isPoint(this)) {
			this.points.push(new CMPoint(point));
			this.path.lineTo(point.x, point.y);
			this.rebuildFilledPaths();
		}
	}

	/**
	 * Removes a given point from this doodle's path
	 * @param {number|object} xOrPoint - The x value, or point object
	 * @param {number} [y] - The y value (if xOrPoint is not a point)
	 */
	removePoint(xOrPoint, y) {
		let point = {};
		if(typeof xOrPoint === "number") {
			point = {
				x: xOrPoint,
				y: y
			};
		}
		else {
			point = xOrPoint;
		}

		// point is not a fixed object; find by x, y values and remove
		this.points.splice(
			this.points.findIndex(elm=>elm.x === point.x && elm.y === point.y),
		1);

		this.rebuildPath();
		this.rebuildFilledPaths();
	}

	/**
	 * Determines if a given point is in this doodle's path
	 * @param {number|object} xOrPoint - The x value, or point object
	 * @param {number} [y] - The y value (if xOrPoint is not a point)
	 */
	containsPoint(xOrPoint, y) {
		let point = {};
		if(typeof xOrPoint === "number") {
			point = {
				x: xOrPoint,
				y: y
			};
		}
		else {
			point = xOrPoint;
		}

		this.game.ctx.save();
		this.game.ctx.lineWidth = this.lineWidth;
		let isPointHere = ctx.isPointInStroke(this.path, point.x, point.y);
		this.game.ctx.restore();
		return isPointHere;
	}

	/**
	 * Rebuilds main path, e.g., when a point
	 * is removed.
	 */
	rebuildPath() {
		this.path = new Path2D();
		this.path.moveTo(this.startPoint.x, this.startPoint.y);

		for(let i = 1; i < this.points.length; i++) {
			this.path.lineTo(this.points[i].x, this.points[i].y);
		}
	}

	/**
	 * Builds filling areas outside path when doodle is updated
	 */
	rebuildFilledPaths() {
		let canvas = this.game.canvas;
		let ctx = this.game.ctx;

		let p1 = this.points[0];
		let p2 = this.points[ this.points.length - 1 ];

		let leftPoint = [p1, p2].sort((a, b) => a.x - b.x)[0];
		let rightPoint = [p1, p2].sort((a, b) => b.x - a.x)[0];
		let topPoint = [p1, p2].sort((a, b) => a.y - b.y)[0]; // on "inverted" screen y values
		let bottomPoint = [p1, p2].sort((a, b) => b.y - a.y)[0]; // on "inverted" screen y values

		if(this.fillStyleBelow && this.fillStyleBelow !== CMGame.Color.TRANSPARENT) {
			this.pathBelow = new Path2D(this.path);

			// moving right...
			if(p1.x <= p2.x) {
				this.pathBelow.lineTo(rightPoint.x, canvas.height + ctx.lineWidth);
				// this.pathBelow.lineTo(canvas.width, canvas.height + ctx.lineWidth);
				this.pathBelow.lineTo(leftPoint.x, canvas.height + ctx.lineWidth);
				this.pathBelow.closePath();
			}
			else { // moving left...
				this.pathBelow.lineTo(leftPoint.x, canvas.height + ctx.lineWidth);
				// this.pathBelow.lineTo(canvas.width, canvas.height + ctx.lineWidth);
				this.pathBelow.lineTo(rightPoint.x, canvas.height + ctx.lineWidth);
				this.pathBelow.closePath();
			}

			this.pathBelow.closePath();
		}

		if(this.fillStyleAbove && this.fillStyleAbove !== CMGame.Color.TRANSPARENT) {

			this.pathAbove = new Path2D(this.path);

			// moving right...
			if(p1.x <= p2.x) {
				this.pathAbove.lineTo(rightPoint.x, 0 - ctx.lineWidth);
				this.pathAbove.lineTo(leftPoint.x, 0 - ctx.lineWidth);
			}
			else { // moving left...
				this.pathAbove.lineTo(leftPoint.x, 0 - ctx.lineWidth);
				this.pathAbove.lineTo(rightPoint.x, 0 - ctx.lineWidth);
			}

			this.pathAbove.closePath();
		}

		if(this.fillStyleLeft && this.fillStyleLeft !== CMGame.Color.TRANSPARENT) {
			this.pathLeft = new Path2D(this.path);

			// moving down on the screen... (screen "y" is inscreasing)
			if(p1.y <= p2.y) {
				this.pathLeft.lineTo(-ctx.lineWidth, bottomPoint.y);
				this.pathLeft.lineTo(-ctx.lineWidth, topPoint.y);
			}
			else { // moving up on the screen... (screen "y" is inscreasing)
				this.pathLeft.lineTo(-ctx.lineWidth, topPoint.y);
				this.pathLeft.lineTo(-ctx.lineWidth, bottomPoint.y);
			}

			this.pathLeft.closePath();
		}

		if(this.fillStyleRight && this.fillStyleRight !== CMGame.Color.TRANSPARENT) {
			this.pathRight = new Path2D(this.path);

			// moving down on the screen... (screen "y" is inscreasing)
			if(p1.y <= p2.y) {
				this.pathRight.lineTo(canvas.width + ctx.lineWidth, bottomPoint.y);
				this.pathRight.lineTo(canvas.width + ctx.lineWidth, topPoint.y);
			}
			else { // moving up on the screen... (screen "y" is inscreasing)
				this.pathRight.lineTo(canvas.width + ctx.lineWidth, topPoint.y);
				this.pathRight.lineTo(canvas.width + ctx.lineWidth, bottomPoint.y);
			}

			this.pathRight.closePath();
		}
	}

	/**
	 * Draws doodle (and filled areas) for current frame
	 * @param {object} ctx - The current game's drawing context
	 */
	draw(ctx) {
		ctx.save();
		if(this.pathLeft) {
			ctx.fillStyle = this.fillStyleLeft;
			ctx.fill(this.pathLeft);
		}

		if(this.pathRight) {
			ctx.fillStyle = this.fillStyleRight;
			ctx.fill(this.pathRight);
		}

		if(this.pathAbove) {
			ctx.fillStyle = this.fillStyleAbove;
			ctx.fill(this.pathAbove);
		}

		if(this.pathBelow) {
			ctx.fillStyle = this.fillStyleBelow;
			ctx.fill(this.pathBelow);
		}

		if(this.points.length > 1) {
			ctx.lineWidth = this.lineWidth;
			ctx.strokeStyle = this.strokeStyle;
			ctx.stroke(this.path);
		}
		else
		if(this.points.length === 1) { // Single point does not show up in stroke
			ctx.fillStyle = this.strokeStyle;
			ctx.fillRect(this.points[0].x, this.points[0].y, .5 * this.lineWidth, .5 * this.lineWidth);
		}
		ctx.restore();
	}
}

/** Represents a "swipe" action by the player on game canvas */
class CMSwipe {
	/**
	 * Creates a CMSwipe instance.
	 * Note: the endpoint's coordinates are listed
	 * first, as they are likely to be the most useful
	 * @param {CMGame} game - The current game instance
	 * @param {number} newX - x value of the swipe's endpoint
	 * @param {number} newY - y value of the swipe's endpoint
	 * @param {number} oldX - x value of the swipe's starting point
	 * @param {number} oldY - y value of the swipe's starting point
	 */
	constructor(game, newX, newY, oldX, oldY) {
		this.game = game;
		this.newX = newX;
		this.newY = newY;
		this.oldX = oldX;
		this.oldY = oldY;

		this.direction = this.getDirection(oldX, oldY, newX, newY); // "left", "up", "down", "right"
		this.direction8 = this.getDirection8(oldX, oldY, newX, newY); // "left", "up", "upleft", "downright" , etc.

		// These are for tracking ALL recorded swipes, even consecutive ones in the same direction
		game.latestSwipes.push(this);
		game.latestSwipeStrings.push(this.direction);
		game.latestSwipeStrings8.push(this.direction8);

		/**
		 * These arrays require precision and no repetition,
		 * since they are intended for detecting special inputs
		 */
		if(!game.latestSwipePath.length ||
				this.direction !== CMGame.last( game.latestSwipePath) ) {
			game.latestSwipePath.push(this.direction);
		}

		if(!game.latestSwipePath8.length ||
				this.direction8 !== CMGame.last( game.latestSwipePath8) ) {
			game.latestSwipePath8.push(this.direction8);
		}
	}

	/**
	 * Sets and returns this.direction, based
	 * on two points defining this swipe
	 * Note: these are based on screen coordinates,
	 * so angles are "upside-down"
	 * @param {number} oldX - The swipe's starting point's x value
	 * @param {number} oldY - The swipe's starting point's y value
	 * @param {number} newX - The swipe's ending point's x value
	 * @param {number} newY - The swipe's ending point's y value
	 * @returns {string}
	 */
	getDirection(oldX, oldY, newX, newY) {
		let angle = this.game.toPolar(new CMPoint(newX - oldX, newY - oldY)).theta;

		if(angle >= 1.75 * Math.PI || angle < .25 * Math.PI) {
			this.direction = "right";
		}
		else
		if(angle >= .25 * Math.PI && angle < .75 * Math.PI) {
			this.direction = "down";
		}
		else
		if(angle >= .75 * Math.PI && angle < 1.25 * Math.PI) {
			this.direction = "left";
		}
		else
		if(angle >= 1.25 * Math.PI && angle < 1.75 * Math.PI) {
			this.direction = "up";
		}

		return this.direction;
	}

	/**
	 * Sets and returns this.direction8, based
	 * on two points defining this swipe
	 * Note: these are based on screen coordinates,
	 * so angles are "upside-down"
	 * @param {number} oldX - The swipe's starting point's x value
	 * @param {number} oldY - The swipe's starting point's y value
	 * @param {number} newX - The swipe's ending point's x value
	 * @param {number} newY - The swipe's ending point's y value
	 * @returns {string}
	 */
	getDirection8(oldX, oldY, newX, newY) {
		let angle = this.game.toPolar(new CMPoint(newX - oldX, newY - oldY)).theta;
		let octant = Math.PI / 8;

		if(angle >= 15 * octant || angle < 1 * octant) {
			this.direction8 = "right";
		}
		else
		if(angle >= 1 * octant && angle < 3 * octant) {
			this.direction8 = "downright";
		}
		else
		if(angle >= 3 * octant && angle < 5 * octant) {
			this.direction8 = "down";
		}
		else
		if(angle >= 5 * octant && angle < 7 * octant) {
			this.direction8 = "downleft";
		}
		else
		if(angle >= 7 * octant && angle < 9 * octant) {
			this.direction8 = "left";
		}
		else
		if(angle >= 9 * octant && angle < 11 * octant) {
			this.direction8 = "upleft";
		}
		else
		if(angle >= 11 * octant && angle < 13 * octant) {
			this.direction8 = "up";
		}
		else
		if(angle >= 13 * octant && angle < 15 * octant) {
			this.direction8 = "upright";
		}

		return this.direction8;
	}
}

/** Manages game objects and processes */
class CMGame {
	constructor(opts={}) {
		let self = this;
		this.images = {};
		this.audios = {};

		for(let src in opts.images) {
			this.images[src] = new CMImageLoad(opts.images[src]);
		}

		for(let src in opts.audios) {
			this.audios[src] = new CMAudioLoad(opts.audios[src]);
		}

		/**
		 * For programming noobs, we keep things as
		 * simple as possible, so they don't have to
		 * add a link to the CSS file. However, we leave
		 * the option open for devs to use their own
		 * CSS by adding an "overrideStyles: true" option
		 * to the CMGame constructor options.
		 */
		if(typeof opts.overrideStyles === "undefined") {
			if(![... document.styleSheets].find(stylesheet => stylesheet.href.match("cmgame.css") ) ) {
				let cmgStylesheet = document.createElement("link");
				cmgStylesheet.rel = "stylesheet";
				cmgStylesheet.type = "text/css";
				cmgStylesheet.href = "css/cmgame.css";
				document.head.appendChild( cmgStylesheet );

				console.warn('No path to CMGame stylesheet provided. For best results, ' +
					'add the following code inside your <head></head> tags:\n\n' +
					'<link rel="stylesheet" href="js/cmgame/css/cmgame.css" />\n\n');
			}
		}

		/**
		 * Again, for complete noobs. Attempts to create
		 * standard "mobile-first" meta tag for the viewport,
		 * though for best results, dev should add this
		 * into the static HTML.
		 */
		if(!document.querySelector("meta[name='viewport']")) {
			let meta = document.createElement("meta");
			meta.name = "viewport";
			meta.content = "width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=0";
			document.head.appendChild(meta);

			console.warn('No \"meta\" viewport tag provided. For best appearance before load, ' +
				'add the following code inside your <head></head> tags:\n\n' +
				'<meta name="viewport" content="width=device-width, user-scalable=no, initial-scale=1.0, maximum-scale=1.0" />\n\n');
		}

		this.soundOn = opts.soundOn || false;
		this.musicOn = opts.musicOn || false;
		this.orientation = opts.orientation || null;
		this.saveName = opts.saveName || "";
		this.state = {};

		this.multiTouch = !!opts.multiTouch;

		this.gridStyle = CMGame.Color.LIGHT_GRAY;
		this.xAxisStyle = CMGame.Color.GRAY;
		this.yAxisStyle = CMGame.Color.GRAY;
		this.tickStyle = CMGame.Color.DARK_GRAY;

		if(typeof opts.gridStyle !== "undefined") {
			this.gridStyle = opts.gridStyle;
		}

		if(typeof opts.xAxisStyle !== "undefined") {
			this.xAxisStyle = opts.xAxisStyle;
		}

		if(typeof opts.yAxisStyle !== "undefined") {
			this.yAxisStyle = opts.yAxisStyle;
		}

		if(typeof opts.tickStyle !== "undefined") {
			this.tickStyle = opts.tickStyle;
		}

		this.fullscreen = false;
		if(typeof opts.fullscreen !== "undefined") {
			this.fullscreen = opts.fullscreen;
		}

		this.type = opts.type || "graph";

		/**
		 * `ignoreNumLock` being true always
		 * registers numpad keys as relevant
		 * directions. Otherwise, they register
		 * as arrows only when NumLock is off.
		 */
		this.ignoreNumLock = false;
		if(typeof opts.ignoreNumLock !== "undefined") {
			this.ignoreNumLock = !!opts.ignoreNumLock;
		}

		// origin defaults to middle of canvas
		this.originByRatio = opts.originByRatio || [0.5, 0.5];

		this.sprites = []; /* CMGame.Sprite */
		this.functions = []; /* CMGame.Function */
		this.tickDistance = (typeof opts.tickDistance === "number") ? opts.tickDistance : 20;
		this.graphScalar = opts.graphScalar || this.tickDistance;
		this.screenScalar = 1.0; // CSS scaling for display; separate from graph - do not override

		this.mouseState = new Array(5).fill(0);
		this.mouseStateString = "00000";
		this.started = false;
		this.paused = false;
		this.animFrameId = null;
		this.gameOver = false;
		this.frameCount = 0;
		this.frameCap = (typeof opts.frameCap === "number") ? opts.frameCap : 1000;

		this.leftMousePressed = false; // Detects if mouse is down to simulate a finger swipe
		this.rightMousePressed = false;
		this.middleMousePressed = false;

		this.trackedScreenTouches = {}; // Used for multi-touch

		// Mainly used to detect how many mouse buttons are pressed, or fingers are down
		this.numPressPoints = 0;

		this.latestPoint = null; // Used for identifying swipe actions
		this.latestSwipes = []; // Stores all swipes until lift, for complex swipe actions
		this.latestSwipeStrings = []; // Similar to latestSwipes, but only stores directions
		this.latestSwipeStrings8 = []; // Similar to latestSwipeStrings, with 8 directions

		this.latestSwipePath = []; // Similar to latestSwipeStrings, but discarding consecutive repeats
		this.latestSwipePath8 = []; // Similar to latestSwipePath, with 8 directions

		this.hideOnStart = opts.hideOnStart || [];

		this.wrapper = null;
		switch(typeof opts.wrapper) {
			case "object":
				this.wrapper = opts.wrapper;
				break;
			case "string":
				this.wrapper = document.querySelector(opts.wrapper);
				if(this.canvas === null) {
					console.error(opts.wrapper + " is not a valid CSS selector, or returned null");
				}
				break;
			default: {
				this.wrapper = document.getElementById("cmWrapper");
				break;
			}
		}

		if(!this.wrapper) {
			this.wrapper = document.createElement("div");
			this.wrapper.setAttribute("id", "cmWrapper");
			documentBodyElm.appendChild(this.wrapper);
		}

		this.canvas = null;
		switch(typeof opts.canvas) {
			case "object":
				this.canvas = opts.canvas;
				break;
			case "string":
				this.canvas = document.querySelector(opts.canvas);
				if(this.canvas === null) {
					console.error(opts.canvas + " is not a valid CSS selector, or returned null");
				}
				break;
			default: {
				this.canvas = document.getElementById("cmCanvas") ||
					document.querySelector("canvas");
				break;
			}
		}

		if(this.canvas) { // some DOM element exists, so use its dimensions
			if(typeof opts.width === "undefined") {
				opts.width = this.canvas.width;
			}

			if(typeof opts.height === "undefined") {
				opts.height = this.canvas.height;
			}
		}
		else { // no <canvas> in HTML, and no option specified. Build our own.
			this.canvas = document.createElement("canvas");
			opts.width = opts.width || 640;
			opts.height = opts.height || 480;
			this.canvas.classList.add("cm-shadow-almost_black");
		}

		if(!this.canvas.hasAttribute("id")) {
			this.canvas.setAttribute("id", "cmCanvas");
		}

		if(this.canvas.parentNode !== this.wrapper) {
			// Note: even if <canvas> existed and wrapper did not, this will move canvas into wrapper
			this.wrapper.appendChild(this.canvas);
		}

		this.ctx = this.canvas.getContext("2d");

		// For complex backgrounds, a "background canvas" layer can be used
		this.backgroundCanvas = null;
		switch(typeof opts.backgroundCanvas) {
			case "object":
				this.backgroundCanvas = opts.backgroundCanvas;
				break;
			case "string":
				this.backgroundCanvas = document.querySelector(opts.backgroundCanvas);
				if(this.backgroundCanvas === null) {
					console.error(opts.backgroundCanvas + " is not a valid CSS selector, or returned null");
				}
				break;
			default:
				// No background canvas layer is used
				break;
		}

		if(this.backgroundCanvas) {
			this.backgroundCtx = this.backgroundCanvas.getContext("2d");
		}
		else {
			this.backgroundCtx = null;
		}

		// store initial <canvas> dimensions for screen resizing
		this.canvasReferenceWidth = opts.width || 640;
		this.canvasReferenceHeight = opts.height || 480;
		this.width = this.canvasReferenceWidth;
		this.height = this.canvasReferenceHeight;

		this.canvas.style.width = this.width + "px";
		this.canvas.style.height = this.height + "px"

		this.canvas.width = this.width;
		this.canvas.height = this.height;

		if(this.backgroundCanvas) {
			this.backgroundCanvas.style.width = this.width + "px";
			this.backgroundCanvas.style.height = this.height + "px"

			this.backgroundCanvas.width = this.width;
			this.backgroundCanvas.height = this.height;
		}

		/**
		 * Create an offscreen canvas for drawing optimization,
		 * and attempt to improve grainy/blurry images by
		 * accounting for current device's pixel ratio.
		 * See https://developer.mozilla.org/en-US/docs/Web/API/Window/devicePixelRatio
		 */
		this.devicePixelRatio = window.devicePixelRatio || 1;

		this.offscreenCanvas = document.createElement("canvas");
		this.offscreenCtx = this.offscreenCanvas.getContext("2d");

		this.offscreenCanvas.style.width = this.width + "px";
		this.offscreenCanvas.style.height = this.height + "px";

		this.offscreenCanvas.width = Math.floor(this.canvas.width * this.devicePixelRatio);
		this.offscreenCanvas.height = Math.floor(this.canvas.height * this.devicePixelRatio);

		// store origin an center as CMPoints in case we wish to check for instance this.origin.isPoint( this.center );
		this.origin = null;
		if(Array.isArray(opts.origin)) {
			this.origin = new CMPoint(
				opts.origin[0],
				opts.origin[1],
				0);
		}
		else
		if(typeof opts.origin === "object") {
			this.origin = new CMPoint(
				opts.origin.x,
				opts.origin.y,
				0
			);
		}
		else { // No origin specified directly
			this.origin = new CMPoint(
				this.originByRatio[0] * this.width,
				this.originByRatio[1] * this.height
			);
		}

		this.center = Object.freeze(new CMPoint(
			.5 * this.width,
			.5 * this.height
		));

		/** Dev may want to allow context menu for downloading screenshot */
		if(!opts.allowContextMenu) {

			/**
			 * Prevent menu on right-click or mobile device "long press", but
			 * prevent haptic feedback on Android. Note: haptic feedback on iOS
			 * must be disabled on by the user on their own device.
			 */
			let overrideContext = function(e) {
					e.preventDefault();
					e.stopPropagation();
					e.cancelBubble = true;
					e.returnValue = false;
					return false;
				};

			/**
			 * The goal is to prevent "right click" context menus from
			 * showing on desktop. However, when disabling the context
			 * menu as below, Android (not iOS for once???) creates an
			 * unwanted haptic feedback on long press.
			 * Note: testing for maxTouchPoints is an incorrect approach,
			 * as many modern desktops have touch capabilities.
			 *
			 * Browser sniffing is still frowned upon, but different
			 * hardware implementations currently leave us no choice.
			 */
			this.runningAndroid = !!window.navigator.userAgent.match(/android/gi);

			if(!this.runningAndroid) {
				window.addEventListener("contextmenu", overrideContext, false);
				this.canvas.addEventListener("contextmenu", overrideContext, false);
			}

			// iOS detection based on various answers found here:
			// https://stackoverflow.com/questions/9038625/detect-if-device-is-ios
			this.running_iOS = !!(/ipad|iphone|ipod/gi.test(navigator.userAgent) ||
					(navigator.userAgent.includes("Mac") && "ontouchend" in document) || // iPad on iOS 13 detection
					(navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) ||
					window.navigator.platform.match(/ipad|iphone|ipod/gi)) &&
					!window.MSStream;

			// For "passive" touch events, suggested for touch surfaces
			this.supportsPassive = false; // Current OS supposedly supports passive events
			this.passiveFlag = false; // Actual options to pass in for touch events (differs for iOS, arrgh)

			try {
				let opts = Object.defineProperty({}, 'passive', {
					get: function() {
						self.supportsPassive = true;

						/**
						 * With buggy iOS we still need to preventDefault in order to prevent
						 * both haptic feedback vibration (after ~.5 second long press)
						 * and zoom resulting from double-click.
						 * Thus we store `supportsPassive` for testing and internal
						 * bookkeeping, and `passiveFlag` is only modified for non-iOS
						 * devices.
						 *
						 * Another option is to suggest users to disable haptic/3D touch and
						 * vibration directly from their iOS device settings:
						 * Settings-> Haptic & 3D Touch -> Off (also Vibration -> Off)
						 */
						if(!self.running_iOS) {
							self.passiveFlag = { passive: true };
						}
					}
				});

				// Determine if "passive" property is accessed when setting an event, then clean up
				window.addEventListener("passivetest", null, opts);
				window.removeEventListener("passivetest", null, opts);
			} catch (e) {}
		}

		/**
		 * Generally, you will want the canvas to handle
		 * touch/mouse events. However, we allow the
		 * option to use something else, e.g., the entire
		 * document, or a custom "controller".
		 */
		this.pressElement = null;
		switch(typeof opts.pressElement) {
			case "object":
				this.pressElement = opts.pressElement;
				break;
			case "string":
				this.pressElement = document.querySelector(opts.pressElement);
				break;
			default: {
				this.pressElement = this.canvas;
				break;
			}
		}

		this.pressElement.addEventListener("touchstart", self.touchStart.bind(self), self.passiveFlag);
		this.pressElement.addEventListener("mousedown", self.mouseDown.bind(self), false);
		this.pressElement.addEventListener("touchmove", self.touchMove.bind(self), self.passiveFlag);
		this.pressElement.addEventListener("mousemove", self.mouseMove.bind(self), false);
		this.pressElement.addEventListener("touchend", self.touchEnd.bind(self), false);
		this.pressElement.addEventListener("mouseup", self.mouseUp.bind(self), false);
		this.pressElement.addEventListener("click", self.click.bind(self), false);
		this.pressElement.addEventListener("dblclick", self.dblClick.bind(self), false);

		window.addEventListener("keydown", self.keyDown.bind(self), false);
		window.addEventListener("keyup", self.keyUp.bind(self), false);

		window.addEventListener("resize", self.resizeCanvas.bind(self), false);
		this.resizeCanvas.call(this); // for loaded screen size

		// Handle fullscreen and orientation setting processes
		this.orientationLock = screen.lockOrientation || screen.mozLockOrientation || screen.msLockOrientation || null;

		if(!this.orientationLock && screen.orientation) {
			this.orientationLock = screen.orientation.lock || CMGame.noop;
		}

		this.runCycle = this.updateAndDraw.bind(this);

		this.startBtn = null;
		switch(typeof opts.startBtn) {
			case "object":
				this.startBtn = opts.startBtn;
				break;
			case "string":
				this.startBtn = document.querySelector(opts.startBtn);
				break;
			default: {
				this.startBtn = this.canvas;
				break;
			}
		}

		this.startBtn.addEventListener("click", ((e) => {
			e.preventDefault();

			if(!soundsInitialized) {
				let audioPath = "audio/";
				let sounds = [];

				for(let id in this.audios) {
					sounds.push({
						id: id,
						src: audios[id].src.replace(audioPath, "")
					});
				}
			}

			self.start();
		}).bind(this), false);

		this.enterFullscreenBtn = null;
		this.exitFullscreenBtn = null;

		switch(typeof opts.enterFullscreenBtn) {
			case "object":
				this.enterFullscreenBtn = opts.enterFullscreenBtn;

				// defining the triggering element assumes you want fullscreen
				if(typeof this.fullscreen === "undefined") {
					this.fullscreen = true;
				}
				break;
			case "string":
				this.enterFullscreenBtn = document.querySelector(opts.enterFullscreenBtn);

				// defining the triggering element assumes you want fullscreen
				if(typeof this.fullscreen === "undefined") {
					this.fullscreen = true;
				}
				break;
			default: {
				this.enterFullscreenBtn = this.startBtn;
				break;
			}
		}

		switch(typeof opts.exitFullscreenBtn) {
			case "object":
				this.exitFullscreenBtn = opts.exitFullscreenBtn;
				break;
			case "string":
				this.exitFullscreenBtn = document.querySelector(opts.exitFullscreenBtn);
				break;
			default: {
				this.exitFullscreenBtn = null; // default to user agent's exit process
				break;
			}
		}

		if(this.fullscreen) {
			this.enterFullscreenBtn.addEventListener("click", e => {
				e.preventDefault();
				self.enterFullscreen(self.orientation);
			}, false);

			if(this.exitFullscreenBtn) {
				this.exitFullscreenBtn.addEventListener("click", e => {
					e.preventDefault();
					self.exitFullscreen();
				}, false);
			}
		}

		this.screenshotLink = document.createElement("a");
		this.screenshotLink.href = "";
		this.screenshotLink.download = "cmgscreenshot.png";
		this.screenshotLink.style.display = "none";
		documentBodyElm.appendChild(this.screenshotLink);

		this.screenshotBtn = null;
		if(opts.screenshotBtn) {
			this.screenshotBtn = document.querySelector(opts.screenshotBtn);

			this.screenshotBtn.addEventListener("click", (e) => {
				e.preventDefault();
				self.takeScreenshot();
			}, false);
		}

		this.screenVideoLink = document.createElement("a");
		this.screenVideoLink.href = "";
		this.screenVideoLink.download = "cmgscreenvideo.mp4";
		this.screenVideoLink.style.display = "none";
		documentBodyElm.appendChild(this.screenVideoLink);

		// For devs who just want the engine, no math drawing
		if(this.type === "none") {
			this.draw = function(ctx=this.offscreenCtx) {
				ctx.clearRect(0, 0,
					this.offscreenCanvas.width,
					this.offscreenCanvas.height);

				this.onbeforedraw(ctx);

				// Removed all built-in math drawing logic from here

				for(let sprite of this.sprites) {
					sprite.draw(ctx);			
				}

				for(let doodle of this.doodles) {
					doodle.draw(ctx);
				}

				this.ondraw(ctx);
			}
		}

		this.vennSets = null;
		this.vennRegions = null;
		this.vertices = [];
		this.edges = [];

		// Create a Venn Diagram-based game
		if(this.type === "venn") {

			this.vennSets = new Map(); // VennSet
			this.vennRegions = new Map(); // VennRegion

			this.setNumberOfSets(opts.numSets || 0, opts.variation || 0);

			/** Updates game state in current frame*/
			this.update = function() {
				this.onbeforeupdate(this.frameCount);

				this.frameCount++;
				if(this.frameCount > this.frameCap) {
					this.frameCount = 0;
				}

				for(let [id, vregion] of this.vennRegions) {
					vregion.update();
				}

				for(let [name, vset] of this.vennSets) {
					vset.update();
				}

				for(let sprite of this.sprites) {
					sprite.update(this.frameCount);
				}

				this.onupdate(this.frameCount);
			}

			this.draw = function(ctx=this.offscreenCtx) {
				ctx.clearRect(0, 0,
					this.offscreenCanvas.width,
					this.offscreenCanvas.height);

				this.onbeforedraw(ctx);

				// Removed all built-in graph drawing logic from here
				for(let [id, vregion] of this.vennRegions) {
					vregion.draw(ctx);
				}

				for(let [name, vset] of this.vennSets) {
					vset.draw(ctx);
				}

				ctx.fillStyle = CMGame.Color.BLACK;
				let fontSize = Math.floor(this.width / 16);
				ctx.font = `italic ${fontSize}px Times New Roman, serif`;
				ctx.fillText("U", this.canvas.width - fontSize * 1.5, fontSize * 1.25);

				for(let sprite of this.sprites) {
					sprite.draw(ctx);
				}

				for(let doodle of this.doodles) {
					doodle.draw(ctx);
				}

				this.ondraw(ctx);
			};
		}
		else
		if(this.type === "graphtheory") {
			this.vertices = [];
			this.edges = [];

			/** Updates game state in current frame*/
			this.update = function() {
				this.onbeforeupdate(this.frameCount);

				this.frameCount++;
				if(this.frameCount > this.frameCap) {
					this.frameCount = 0;
				}

				for(let edge of this.edges) {
					edge.update();
				}

				for(let vertex of this.vertices) {
					vertex.update();
				}

				for(let sprite of this.sprites) {
					sprite.update();
				}

				for(let doodle of this.doodles) {
					doodle.update();
				}

				this.onupdate(this.frameCount);
			}

			this.draw = function(ctx=this.offscreenCtx) {
				ctx.clearRect(0, 0,
					this.offscreenCanvas.width,
					this.offscreenCanvas.height);

				this.onbeforedraw(ctx);

				for(let edge of this.edges) {
					edge.draw(ctx);
				}

				for(let vertex of this.vertices) {
					vertex.draw(ctx);
				}

				for(let sprite of this.sprites) {
					sprite.draw(ctx);			
				}

				for(let doodle of this.doodles) {
					doodle.draw(ctx);
				}

				this.ondraw(ctx);
			};
		}

		this.doodleOptions = {};
		if(opts.doodleOptions) {
			this.doodleOptions = opts.doodleOptions;

			// User set up doodle options without bothering to enable/disable, so we assume enable
			if(typeof opts.doodleOptions.enabled === "undefined") {
				this.doodleOptions.enabled = true;
			}
		}

		this.doodles = [];
		this.currentDoodle = null;

		// Store some zoom information for returning to unzoomed window
		this.zoomLevel = 1; // Use percentages as decimals
		this.unzoomedGraphScalar = this.graphScalar;
		this.unzoomedTickDistance = this.tickDistance;
		this.unzoomedOrigin = new CMPoint(
			this.origin.x,
			this.origin.y
		);

		// This allows dev to enter handlers directly into the CMGame constructor
		let eventKeys = [
			"onbeforestart",
			"onstart",
			"onbeforeupdate",
			"onupdate",
			"onbeforedraw",
			"ondraw",
			// "oncleardraw", // @deprecated
			"ontouchstart",
			"ontouchmove",
			"ontouchend",
			"onkeydown",
			"onkeyup"
		];

		for(let key of eventKeys) {
			if(typeof opts[key] === "function") {
				this[key] = opts[key].bind(self);
			}
		}

		if(typeof opts.onload === "function") {
			opts.onload();
		}

		this.screenshotCanvas = null;
		this.screenshotCtx = null;
		this.screenVideoCanvas = null;
		this.screenVideoCtx = null;
		this.recordingVideo = false;
		this.screenVideoDetails = null;

		// Base output calculations on ideal MP4 resolution of 1920x1080
		let videoWidthScalar = 1920 / this.width;
		let videoHeightScalar = 1080 / this.height;

		if(videoWidthScalar > videoHeightScalar) {
			this.screenVideoDetails = {
				x: Math.max((1920 - this.width * videoHeightScalar) / 2, 0),
				y: Math.max((1080 - this.height * videoHeightScalar) / 2, 0),
				width: this.width * videoHeightScalar,
				height: this.height * videoHeightScalar
			};
		}
		else {
			this.screenVideoDetails = {
				x: Math.max((1920 - this.width * videoWidthScalar) / 2, 0),
				y: Math.max((1080 - this.height * videoWidthScalar) / 2, 0),
				width: this.width * videoWidthScalar,
				height: this.height * videoWidthScalar
			};
		}
	}

	/**
	 * Provides a "relative" pixel amount based on
	 * current screen scale. E.g., if you want an
	 * image to always display as 40 x 80 pixels,
	 * and be positioned 10 pixels from top of canvas
	 * and 20 pixels from left of canvas,
	 * no matter what size our canvas appears,
	 * use game.drawImage(10, 20, game.rel(40), game.rel(80))
	 * @param {number|object} pxForScale1 - The number of pixels this would be,
	 *   (or a point with x and y pixel values) if the canvas was at scale 1.
	 *   In other words, this represents the "desired output size" in pixels,
	 *   or the "desired output point" with x, y in pixels.
	 * @returns {number|object} Output is same type as input
	 */
	rel(pxForScale1) {
		if(typeof pxForScale1 === "number")
			return pxForScale1 / self.screenScalar;
		else // Assume a point with x, y values
			return {
				x: pxForScale1.x / self.screenScalar,
				y: pxForScale1.y / self.screenScalar
			};
	}

	/**
	 * Download a snapshot of the current frame.
	 * Attempts to copy background if it is a defined
	 * color or single image. If your background is more
	 * complicated, you may wish to draw it into
	 * the canvas with the canvas context, to
	 * ensure it is included in the screenshots.
	 * Returns a promise, resolving with an object with "image"
	 * property set to an output <img> element (if defined) and
	 * a "src" property set to the captured image source string.
	 * @param {object} [option{}] - A plain JS object of options (if desired)
	 * @param {string} [options.filename="cmgscreenshot.png"] - The desired file name for the download
	 * @param {HTMLImageElement|string} [output="download"] - An image element to display
	 *   the screenshot if desired, or "download" to just download, or anything else to do nothing
	 * @returns {Promise}
	 */
	takeScreenshot(options={}) {

		// Grab immediate snapshot as string, rather than risk delay due to processing below
		let dataURL = this.canvas.toDataURL(), // Pull frame from screen canvas (not offscreen)
			self = this,
			downloadImg = new Image(),
			canvasDataImg,
			canvasDataUrl,
			opts = {
				filename: options.filename || "cmgscreenshot.png",
				output: options.output || "download"
			};

		return new Promise(function(resolve, reject) {

			downloadImg.onload = function() {

				if(!self.screenshotCanvas) {
					self.screenshotCanvas = document.createElement("canvas");
					self.screenshotCtx = self.screenshotCanvas.getContext("2d");
				}

				self.screenshotCanvas.style.width = (self.screenshotCanvas.width = self.canvas.width) + "px";
				self.screenshotCanvas.style.height = (self.screenshotCanvas.height = self.canvas.height) + "px";

				// Attempt to draw background color or image
				let styleDefs = window.getComputedStyle(self.canvas);
				let bgImg = styleDefs.getPropertyValue("background-image");

				// Most reliable form for complicated backgrounds - use a background canvas
				if(self.backgroundCanvas) {
					self.screenshotCtx.drawImage(self.backgroundCanvas,
									0, 0,
									self.screenshotCanvas.width,
									self.screenshotCanvas.height);				
				}
				else
				if(bgImg && bgImg !== "none") { // Attempt to copy background image

					// background-image has a defined source. Load it and draw it
					let bgImgSrc = bgImg.replace("url(", "").replace(")", "");
					let img = new Image();

					img.onerror = function(e) {
						reject("Error loading background image source for screenshot");
					};

					img.onload = function() {
						let imX = styleDefs.getPropertyValue("background-position-x") || 0;
						let imY = styleDefs.getPropertyValue("background-position-y") || 0;
						let imRepeatX = styleDefs.getPropertyValue("background-repeat-x") || "repeat";
						let imRepeatY = styleDefs.getPropertyValue("background-repeat-y") || "repeat";

						let imWidth = self.screenshotCanvas.width;
						let imHeight = self.screenshotCanvas.height;
						let imSizeText = styleDefs.getPropertyValue("background-size");
						let imSizes = imSizeText.split(" ");

						if(imSizes.length > 1) {
							if(imSizes[0].includes("px")) {
								imWidth = parseFloat( imSizes[0].replace("px", "") );
							}

							if(imSizes[1].includes("px")) {
								imHeight = parseFloat( imSizes[1].replace("px", "") );
							}
						}
						else {
							imWidth = imHeight = parseFloat( imSizes[0].replace("px", "") );
						}

						for(let row = imY;
								row < self.screenshotCanvas.height || imRepeatY === "no-repeat";
								row += imHeight) {

							for(let col = imX;
									col < self.screenshotCanvas.width || imRepeatX === "no-repeat";
									col += imWidth) {

								self.screenshotCtx.drawImage(img, col, row, imWidth, imHeight);
							}
						}
						
						// Since we need to wait for image source to load, perform download here
						self.screenshotCtx.drawImage(downloadImg,
							0, 0,
							self.screenshotCanvas.width,
							self.screenshotCanvas.height);

						canvasDataUrl = self.screenshotCanvas.toDataURL();
						self.screenshotLink.href = canvasDataUrl;
						self.screenshotLink.download = opts.filename;

						if(opts.output === "download") {
							self.screenshotLink.click();
						}

						if(opts.output instanceof HTMLImageElement) {
							canvasDataImg = opts.output;
						}
						else {
							canvasDataImg = new Image();
						}

						canvasDataImg.onload = () => {
							resolve({
								image: canvasDataImg,
								src: canvasDataImg.src
							});
						};

						canvasDataImg.src = canvas.dataUrl;
					};

					img.src = bgImgSrc;

					// No need to download twice
					return; // escapes downloadImg.onload
				}
				else { // Simplest form - no background canvas, just use current canvas background color
					self.screenshotCtx.fillStyle = styleDefs.getPropertyValue("background-color");
					self.screenshotCtx.fillRect(0, 0,
							self.screenshotCanvas.width, self.screenshotCanvas.height);
				}

				// Draw game's current frame over interpreted background
				self.screenshotCtx.drawImage(downloadImg,
					0, 0,
					self.screenshotCanvas.width,
					self.screenshotCanvas.height);

				canvasDataUrl = self.screenshotCanvas.toDataURL();
				self.screenshotLink.href = canvasDataUrl;
				self.screenshotLink.download = opts.filename;

				if(opts.output === "download") {
					self.screenshotLink.click();
				}

				if(opts.output instanceof HTMLImageElement) {
					canvasDataImg = opts.output;
				}
				else {
					canvasDataImg = new Image();
				}

				canvasDataImg.onload = () => {
					resolve({
						image: canvasDataImg,
						src: canvasDataImg.src
					});
				};

				canvasDataImg.src = canvasDataUrl;
			};

			// Load original screenshot and trigger the onload event
			downloadImg.src = dataURL;
		});
	}

	/**
	 * Records a short video of the current gameplay,
	 * by sending stream directly to a blob.
	 * Note: this has the same "background"
	 * concerns as with takeScreenshot, since the
	 * stream only comes from the output canvas.
	 * Thus, to use this method, you should draw
	 * your desired background directly onto the 
	 * canvas, e.g., with game.onbeforedraw.
	 * Also note that support may vary, so this is
	 * mainly for devs to save game demo videos,
	 * say for advertising.
	 * Returns a Promise, resolving (after video stops recording)
	 * with an object with "video" property set to an output <video>
	 * element (if defined) and a "src" property set to the captured
	 * video source string.
	 * @param {number|object} [options={}] - A plain JS object of options. If undefined,
	 *   defaults are used. If a number, defaults are used except for duration, which is
	 *   set to that number.
	 * @param {number} [options.start=0] - Number of milliseconds to wait before starting capture
	 * @param {number} [options.duration=5000] - Number of milliseconds to capture
	 * @param {number} [options.fps=this.FPS] - Desired frame rate for capture (default's to game's rate)
	 * @param {number} [options.mimeType="video/mp4"] - Desired mimeType for the
	 *   output video. If not present, will be inferred from options.filename (the preferred option)
	 * @param {string|Video} [options.output] Option for handling. "download"  to download immediately, "none"
	 *   to do nothing (e.g., if dev wants to wait for Promise), or an HTMLVideo element whose source will
	 *   be set to the output video once available.
	 * @returns {Promise}
	 */
	takeScreenVideo(options={}) {
		if(this.recordingVideo) {
			console.error("Cannot record multiple videos simultaneously");
			return;
		}

		let self = this;

		let opts = {
			start: 0,
			duration: 5000,
			fps: Math.round(CMGame.FPS),
			mimeType: "video/mp4", // video/mp4 or video/webm, etc.
			filename: "cmgscreenvideo.mp4", // Better choice, as mimeType will be inferred
			output: "download" // set to "download", "none", or a <video> element, or use returned Promise data
		};

		switch(typeof options) {
			case "number":
				opts.duration = options;
				break;
			case "object":
				for(let key in opts) {
					if(typeof options[key] !== "undefined") {
						opts[key] = options[key];
					}
				}
				break;
			case "undefined":
			default:
				break;
		}

		let inferredType;
		let inferredExtension;
		if(typeof options.filename === "string") {
			if(typeof options.mimeType === "string") {

				inferredType = options.mimeType.match(/video\/([a-z0-9\-]+)/)[0].replace("video/", "");
				inferredExtension = {
					"x-msvideo": ".avi",
					"mp4": ".mp4",
					"mpeg": ".mpeg",
					"ogg": ".ogv",
					"mp2t": ".ts",
					"webm": ".webm",
					"3gpp": ".3gp",
					"3gpp2": ".3g2"
				}[inferredType];

				// Your type does not match your filename - now will look something like myvideo.webm.mp4
				if(!options.filename.endsWith(inferredExtension)) {
					console.warn(`takeScreenVideo "filename" does not match "mimeType". Inferred extension will be appended to filename.`);
					opts.filename = options.filename + inferredExtension;
				}
			}
			else {
				inferredExtension = options.filename.substr( options.filename.lastIndexOf(".") + 1 );
				inferredType = {
					"avi": "x-msvideo",
					"mp4": "mp4",
					"mpeg": "mpeg",
					"ogv": "ogg",
					"ts": "mp2t",
					"webm": "webm",
					"3gp": "3gpp",
					"3g2": "3gpp2"
				}[inferredExtension];

				opts.mimeType = "video/" + inferredType;
			}
		}

		if(!this.screenVideoCanvas) {
			this.screenVideoCanvas = document.createElement("canvas");

			// Aim for resolution of 1920x1080 for ideal MP4 output
			this.screenVideoCanvas.width = 1920;
			this.screenVideoCanvas.height = 1080;
			this.screenVideoCanvas.style.width = 1920 + "px";
			this.screenVideoCanvas.style.height = 1080 + "px";

			this.screenVideoCtx = this.screenVideoCanvas.getContext("2d", {alpha: false});
		}

		return new Promise(function(resolve, reject) {

			let stream = self.screenVideoCanvas.captureStream(opts.fps);
			let recordedChunks = [];

			/**
			 * Only webm seems to be supported for the initial stream -
			 * requested mimeType will be used for the output Blob
			 */
			//let streamOptions = { mimeType: "video/webm; codecs=vp9" };
			//let mediaRecorder = new MediaRecorder(stream, streamOptions);
			let mediaRecorder = new MediaRecorder(stream);

			setTimeout(() => {
				mediaRecorder.ondataavailable = function(e) {
					if(e.data.size > 0) {
						recordedChunks.push(e.data);
					}
				};

				mediaRecorder.onstop = function() {
					let blob = new Blob(recordedChunks, {
						type: opts.mimeType // "video/mp4", etc.
					});

					recordedChunks = []; // clear out

					let videoUrl = URL.createObjectURL(blob);
					let resolvedObj = {
						video: null,
						src: ""
					};

					if(opts.output instanceof HTMLVideoElement) {
						opts.output.src = videoUrl;
						resolvedObj.video = opts.output;
						resolvedObj.src = opts.output.src;
					}
					else
					if(opts.output === "download") {
						self.screenVideoLink.href = videoUrl;
						self.screenVideoLink.download = opts.filename;
						resolvedObj.video = null;
						resolvedObj.src = self.screenVideoLink.href;
						self.screenVideoLink.click();
					}

					window.URL.revokeObjectURL(videoUrl); // garbage collection
					resolve(resolvedObj);
				};

				// Don't start counting duration until recording starts
				mediaRecorder.onstart = () => {
					setTimeout(() => {
						mediaRecorder.stop();
						self.recordingVideo = false;
					}, opts.duration); // Stop recording only after requested time
				};

				mediaRecorder.start();
				self.recordingVideo = true;
			}, opts.start); // Start recording only after requested time
		});
	}

	/**
	 * Start current game processes, animations, etc.
	 */
	start() {
		let self = this;
		if(this.started) { // Prevent double calls
			return;
		}

		if(typeof this.onbeforestart === "function") {
			this.onbeforestart();
		}

		for(let item of this.hideOnStart) {
			if(typeof item === "object")
				elm.style.display = "none";
			else
			if(typeof item === "string")
				document.querySelector(item).style.display = "none";
		}

		this.started = true;
		this.animFrameId = requestNextFrame(self.runCycle);

		if(typeof this.onstart === "function") {
			this.onstart();
		}

		return this;
	}

	/** Pause current game cycle */
	pause() {
		this.paused = true;
		cancelNextFrame(this.animFrameId);
		this.animFrameId = null;

		return this;
	}

	/** Restart paused game cycle */
	unpause() {
		let self = this;

		if(this.paused) {
			this.paused = false;

			if(this.animFrameId === null)
				this.animFrameId = requestNextFrame(self.runCycle);
		}

		return this;
	}

	/** These are meant to be overridden */
	onbeforeupdate(frameCount) {} // Occurs just before game's update()
	onupdate(frameCount) {} // Occurs just after game's update()
	onbeforedraw(ctx) {} // Occurs just before game's draw(), but after previous screen was cleared

	// @deprecated - This was drawn after screen clear before current draw (onbefore draw was drawn before screen clear)
	// oncleardraw(ctx) {} // Occurs after previous screen clear but before current draw()

	ondraw(ctx) {} // Occurs just after game's draw()
	onswipe(/* CMSwipe */ cmSwipe) {} // Triggered by significant mousemove or touchmove

	/**
	 * These can be overridden for more control,
	 * but prefer to use onpressstart, onpressmove,
	 * onpressend for consistency between
	 * mouse and touch
	 */
	ontouchstart(e) {}
	ontouchmove(e) {}
	ontouchend(e) {}
	onmousedown(e) {}
	onmousemove(e) {}
	onmouseup(e) {}
	onclick(e) {}
	ondblclick(e) {}
	onrightclick(e) {}

	/** These are meant to be overridden */
	onpressstart(point) {}
	onpressmove(info) {}
	onpressend(point) {}
	onkeydown(e) {}
	onkeyup(e) {}

	/** Updates game state in current frame*/
	update() {
		this.onbeforeupdate(this.frameCount);

		this.frameCount++;
		if(this.frameCount > this.frameCap) {
			this.frameCount = 0;
		}

		for(let func of this.functions) {
			func.update(this.frameCount);
		}

		for(let sprite of this.sprites) {
			sprite.update(this.frameCount);
		}

		this.onupdate(this.frameCount);
	}

	/**
	 * Draws game screen in current frame
	 * @param {CanvasRenderingContext2D} ctx - The drawing context
	 */
	draw(ctx=this.offscreenCtx) {
		ctx.clearRect(0, 0,
			this.offscreenCanvas.width, this.offscreenCanvas.height);
		this.onbeforedraw(ctx);

		// Background grid
		if(this.gridStyle && this.gridStyle !== CMGame.Color.TRANSPARENT) {
			ctx.strokeStyle = this.gridStyle;

			// vertical lines, center to left
			for(let i = this.origin.x; i > 0; i -= this.tickDistance) {
				this.drawLine(i, 0,
					i, this.offscreenCanvas.height);
			}

			// vertical lines, center to right
			for(let i = this.origin.x; i < this.offscreenCanvas.width; i += this.tickDistance) {
				this.drawLine(i, 0,
					i, this.offscreenCanvas.height);
			}

			// horizontal lines, center to top
			for(let i = this.origin.y; i > 0; i -= this.tickDistance) {
				this.drawLine(0, i,
					this.offscreenCanvas.width, i);
			}

			// horizontal lines, center to bottom
			for(let i = this.origin.y; i < this.offscreenCanvas.height; i += this.tickDistance) {
				this.drawLine(0, i,
					this.offscreenCanvas.width, i);
			}
		}

		// Draw x and y axes
		// x axis
		if(this.xAxisStyle && this.xAxisStyle !== CMGame.Color.TRANSPARENT) {
			ctx.strokeStyle = this.xAxisStyle;

			this.drawLine(0, this.origin.y,
				this.offscreenCanvas.width, this.origin.y);
		}

		// y axis
		if(this.yAxisStyle && this.yAxisStyle !== CMGame.Color.TRANSPARENT) {
			ctx.strokeStyle = this.yAxisStyle;
			
			this.drawLine(this.origin.x, 0,
				this.origin.x, this.offscreenCanvas.height);	
		}

		// Draw tick marks
		if(this.tickStyle && this.tickStyle !== CMGame.Color.TRANSPARENT) {
			ctx.strokeStyle = this.tickStyle;

			let halfTickLength = Math.max(Math.min(5, .25 * this.tickDistance), 3);

			// vertical lines, center to left
			for(let i = this.origin.x - this.tickDistance; i > 0; i -= this.tickDistance) {
				this.drawLine(i, this.origin.y - halfTickLength,
					i, this.origin.y + halfTickLength);
			}

			// vertical lines, center to right
			for(let i = this.origin.x + this.tickDistance; i < this.offscreenCanvas.width; i += this.tickDistance) {
				this.drawLine(i, this.origin.y - halfTickLength,
					i, this.origin.y + halfTickLength);
			}

			// horizontal lines, center to top
			for(let i = this.origin.y - this.tickDistance; i > 0; i -= this.tickDistance) {
				this.drawLine(this.origin.x - halfTickLength, i,
					this.origin.x + halfTickLength, i);
			}

			// horizontal lines, center to bottom
			for(let i = this.origin.y + this.tickDistance; i < this.offscreenCanvas.height; i += this.tickDistance) {
				this.drawLine(this.origin.x - halfTickLength, i,
					this.origin.x + halfTickLength, i);
			}
		}

		for(let func of this.functions) {
			func.draw(ctx);
		}

		for(let sprite of this.sprites) {
			sprite.draw(ctx);			
		}

		for(let doodle of this.doodles) {
			doodle.draw(ctx);
		}

		this.ondraw(ctx);

		if(this.recordingVideo) {
			this.screenVideoCtx.clearRect(game.canvas, 0, 0,
				this.screenVideoCanvas.width, this.screenVideoCanvas.height);

			this.screenVideoCtx.drawImage(game.canvas, this.screenVideoDetails.x, this.screenVideoDetails.y,
				this.screenVideoDetails.width, this.screenVideoDetails.height);
		}
	}

	/**
	 * Method for beginning a new doodle
	 * over the current game screen.
	 * @param {object} point - A CMPoint or similar
	 * @param {object} [opts=this.doodleOptions] - options to pass to CMDoodle
	 */
	startDoodle(point, opts=this.doodleOptions) {
		this.doodleOptions.enabled = true;
		opts.startPoint = new CMPoint(point.x, point.y);

		this.currentDoodle = new CMDoodle(this, opts);
		this.doodles.push(this.currentDoodle);
		return this;
	}

	/**
	 * Ends current doodling session
	 */
	stopDoodle() {
		this.currentDoodle = null;
		return this;
	}

	/**
	 * Removes all doodles from game instance
	 */
	clearDoodles() {
		CMGame.clearAll( this.doodles );
		this.currentDoodle = null;

		// No animation running, so redraw without doodles
		if(this.paused || !this.started) {
			this.draw();
		}

		return this;
	}

	/**
	 * Add a new drawable function (CMGame.Function) to the game.
	 * Prefer this method to adding the function yourself,
	 * in case future operations are added here, or storage
	 * processes are modified (e.g., using Map instead of Array)
	 * @param {object} cmgFunc - The CMGame.Function instance
	 */
	addFunction(/* CMGame.Function */ cmgFunc) {
		this.functions.push(cmgFunc);
		return this;
	}

	/**
	 * Removes one of our added drawable
	 * functions (CMGame.Function) from the
	 * game. Note: you should always store
	 * added functions in a variable if they are
	 * to be removed later. This way you can
	 * assure the same function reference is
	 * being called here.
	 *
	 * This does not destroy the function, only removes it
	 * from game's update/draw calls. You can add the
	 * function again later if desired.
	 *
	 * @param {object} cmgFunc - The CMGame.Function instance to remove
	 */
	removeFunction(/* CMGame.Function */ cmgFunc) {
		this.functions.splice(this.functions.indexOf(cmgFunc), 1);
		return this;
	}

	/**
	 * Adds a sprite to the game, and sorts the sprites
	 * based on preferences for drawing order
	 * @param {object} sprite - The sprite to add
	 */
	addSprite(/* CMGame.Sprite */ sprite) {
		this.sprites.push(sprite);
		this.sprites.sort((a, b) => a.layer - b.layer);
		return this;
	}

	/**
	 * Removes one of our added sprites
	 * (CMGame.Sprite) from the
	 * game. Note: you should always store
	 * added sprites in a variable if they are
	 * to be removed later. This way you can
	 * assure the same sprite reference is
	 * being called here.
	 *
	 * This does not destroy the sprite, only removes it
	 * from game's update/draw calls. You can add the
	 * sprite again later if desired.
	 *
	 * @param {object} sprite - The CMGame.Sprite instance to remove
	 */
	removeSprite(/* CMGame.Sprite */ sprite) {
		this.sprites.splice(this.sprites.indexOf(sprite), 1);
		return this;
	}

	/**
	 * Converts a real x value to its
	 * scaled onscreen position's
	 * x value (in pixels)
	 * @param {number} realX - The real x input
	 * @returns {number}
	 */
	xToScreen(realX) {
		let x = this.graphScalar * realX;

		return this.origin.x + x;
	}

	/**
	 * Gets graph x value from screen's x value
	 * @param {number} screenX - The screen point's x value
	 * @returns {number}
	 */
	xToReal(screenX) {
		let x = screenX - this.origin.x;

		return x / this.graphScalar;
	}

	/**
	 * Converts a real y value to its
	 * scaled onscreen position's
	 * y value (in pixels)
	 * @param {number} realY - The real y input
	 * @returns {number}
	 */
	yToScreen(realY) {
		let y = this.graphScalar * realY;

		// Reflect so graph sits above x axis
		return this.origin.y - y;
	}

	/**
	 * Gets graph y value from screen's y value
	 * @param {number} screenY - The screen point's y value
	 * @returns {number}
	 */
	yToReal(screenY) {
		let y = -(screenY - this.origin.y);

		return y / this.graphScalar;
	}

	/**
	 * A convenience method. Converts an x, y point
	 * of real numbers to current screen.
	 * @param {object} realPoint - A plain JS object with x and y number values
	 * @returns {object} A plain JS object with x and y number values
	 */
	toScreen(realPoint) {
		return {
			x: this.xToScreen(realPoint.x),
			y: this.yToScreen(realPoint.y)
		};
	}

	/**
	 * A convenience method. Converts an x, y point
	 * from the current game's screen scale to real numbers.
	 * @param {object} screenPoint - A plain JS object with x and y number values
	 * @returns {object} A plain JS object with x and y number values
	 */
	toReal(screenPoint) {
		return {
			x: this.xToReal(screenPoint.x),
			y: this.yToReal(screenPoint.y)
		};
	}

	/**
	 * Manages single animation frame processes
	 */
	updateAndDraw() {
		this.update();

		this.offscreenCtx.save();
		this.offscreenCtx.scale(this.devicePixelRatio, this.devicePixelRatio);
		this.draw(this.offscreenCtx);
		this.offscreenCtx.restore();
		this.moveOffscreenToScreen();

		if(this.started && !this.paused) {
			this.animFrameId = requestNextFrame(this.runCycle);
		}
	}

	/**
	 * Takes components drawn to offscreen
	 * canvas and draw them to screen, scaling
	 * back down to account for devicePixelRatio
	 */
	moveOffscreenToScreen() {
		this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
		this.ctx.drawImage(this.offscreenCanvas,
			0, 0,
			this.canvas.width,
			this.canvas.height);
	}

	/**
	 * Handle sizing of gamescreen based on browser width and height
	 */
	resizeCanvas() {
		let newWidth = this.canvasReferenceWidth;
		let newHeight = this.canvasReferenceHeight;
		let dimensionForReference = "width";

		// We only need to apply scales if screen is smaller than desired size of 640 x 480
		if(document.documentElement.clientWidth < this.canvasReferenceWidth ||
				document.documentElement.clientHeight < this.canvasReferenceHeight) {

			// Figure out which dimension to base our scaling on
			if(document.documentElement.clientWidth < this.canvasReferenceWidth &&
					document.documentElement.clientHeight < this.canvasReferenceHeight) {

				// Steps:
				// 1. Find the smaller "scale" new screen height to old height or new screen width to old width
				// 2. Perform steps as below based on which one

				if(document.documentElement.clientWidth / this.canvasReferenceWidth < document.documentElement.clientHeight / this.canvasReferenceHeight) {
				// if(window.innerWidth / 640  < window.innerHeight / 480) {	
					dimensionForReference = "width";
				}
				else {
					dimensionForReference = "height";
				}
			}
			else
			if(document.documentElement.clientWidth < this.canvasReferenceWidth) {
				dimensionForReference = "width";
			}
			else {
				dimensionForReference = "height";
			}

			/**
			 * Apply scaling. Note: CSS for body should have
			 * dimensions 100vw x 100vh or this could reduce
			 * to 0 height and disappear
			 */
			if(dimensionForReference === "width") {
				newWidth = Math.min.apply(Math, [document.documentElement.clientWidth, window.outerWidth, window.innerWidth, documentBodyElm.clientWidth]);
				newHeight = (this.canvasReferenceHeight / this.canvasReferenceWidth) * newWidth;

				this.screenScalar = Math.min(newWidth / this.canvasReferenceWidth, newHeight / this.canvasReferenceHeight);
			}
			else {
				newHeight = Math.min.apply(Math, [document.documentElement.clientHeight, window.outerHeight, window.innerHeight, documentBodyElm.clientHeight]);
				newWidth = (this.canvasReferenceWidth / this.canvasReferenceHeight) * newHeight;

				this.screenScalar = Math.min(newWidth / this.canvasReferenceWidth, newHeight / this.canvasReferenceHeight);
			}

			// scale to current screen and center the content
			this.wrapper.style.transform = "scale(" + this.screenScalar + ")";
			this.wrapper.style.left = `calc(100vw / 2 - ${0.5 * this.screenScalar} * ${this.width}px)`;

			this.wrapper.style.top = "0";
		}
		else { // Screen is big enough for intended size
			newWidth = this.canvasReferenceWidth;
			newHeight = this.canvasReferenceHeight;

			this.wrapper.style.width = (this.wrapper.width = newWidth) + "px";
			this.wrapper.style.height = (this.wrapper.height = newHeight) + "px";

			this.screenScalar = 1.0;
			this.wrapper.style.transform = "scale(" + this.screenScalar + ")";

			// Center the content on the page
			this.wrapper.style.left = `calc(100vw / 2 - ${0.5 * this.screenScalar} * ${this.width}px)`;
			this.wrapper.style.top = "18px";
		}
	}

	/**
	 * Creates a unique save ID, for when one
	 * has not been defined.
	 * @returns {string}
	 */
	generateSaveName() {
		let saveIdx = 0;
		while(localStorage.getItem(CMGame.SAVE_PREFIX + saveIdx) !== null) {
			saveIdx++;
		}

		return CMGame.SAVE_PREFIX + saveIdx;
	}

	/**
	 * Save information about current game
	 * to current browser.
	 * @param {string|object} [saveName] - The filename to save for the given state object, Or
	 *   the state object to save. If a string is provided, it will be used as the save name (the
	 *   key in localStorage). If this is an object, it is saved under the game's this.saveName
	 *   string. If no arguments are provided, the game's this.state is saved under its
	 *   this.saveName.
	 * @param {object} [state] - A JS object (which can be converted to JSON format, so
	 *   prefer primitive values). If not provided, and first argument is not an object,
	 *   this method saves the game's this.state.
	 */
	save(saveName, state) {
		let nameToSave = "",
			stateToSave = {};

		switch(typeof saveName) {
			case "string":
				nameToSave = saveName;
				if(typeof state === "object") {
					stateToSave = state;
				}
				else {
					stateToSave = this.state;
				}
				break;
			case "object":
				stateToSave = saveName;
				nameToSave = this.saveName;
				break;
			default: // no arguments provided
				nameToSave = this.saveName;
				stateToSave = this.state;
				break;
		}

		try {
			console.log("Saving game data under name: " + nameToRetrieve);
			localStorage.setItem(nameToSave, JSON.stringify(stateToSave));
		}
		catch(e) {
			console.log("Error thrown during localStorage save. Possible security issue, e.g., when testing save on local directory.");
		}
	}

	/**
	 * Loads saved information about current game from
	 * current browser, and returns for convenience
	 * @param {string} [saveName] - A specific save filename to try and retrieve. If
	 *   not present, attempts to retrieve file stored in game's this.saveName.
	 * @returns {object}
	 */
	load(saveName) {
		let loadedStateString = null;
		let nameToRetrieve = "";

		if(typeof saveName === "string") {
			nameToRetrieve = saveName;
		}
		else
		if(this.saveName) {
			nameToRetrieve = this.saveName;
		}
		else { // No saveName is set, or is an  empty string. See if any data is stored elsewhere
			nameToRetrieve = this.generateSaveName();

			if(nameToRetrieve.replace(CMGame.SAVE_PREFIX, "") !== "0") { // generated save file exists
				nameToRetrieve = CMGame.SAVE_PREFIX + (parseInt( nameToRetrieve.replace(CMGame.SAVE_PREFIX, "") ) - 1);
			}
		}

		try {
			console.log("Loading game data under name: " + nameToRetrieve);
			loadedStateString = localStorage.getItem(nameToRetrieve);
		}
		catch(e) {
			console.log("Error thrown during localStorage save. Possible security issue, e.g., when testing save on local directory.");
		}
		
		if(loadedStateString !== null) {
			this.state = JSON.parse(loadedStateString);
			return this.state;
		}
		else {
			return {};
		}
	}

	/**
	 * Manage keydown events
	 * @param {object} e - The keydown event
	 */
	keyDown(e) {
		e.preventDefault();

		switch(e.keyCode) {
			case 38: // Up arrow
			case 87: // W
			case 104 + (+!this.ignoreNumLock * 1000): // 8 on numpad
				e.direction = "up";
				break;
			case 40: // Down arrow
			case 83: // S
			case 98 + (+!this.ignoreNumLock * 1000): // 2 on numpad
				e.direction = "down";
				break;
			case 37: // Left
			case 65: // A
			case 100 + (+!this.ignoreNumLock * 1000): // 4 on numpad
				e.direction = "left";
				break;
			case 39: // Right
			case 68: // D
			case 102 + (+!this.ignoreNumLock * 1000): // 6 on numpad
				e.direction = "right";
				break;
			default: {
				e.direction = "";
			}
		}

		this.onkeydown(e);
	}

	/**
	 * Manage keyup events
	 * @param {object} e - The keyup event
	 */
	keyUp(e) {
		e.preventDefault();

		switch(e.keyCode) {
			case 38: // Up arrow
			case 87: // W
			case 104 + (+!this.ignoreNumLock * 1000): // 8 on numpad
				e.direction = "up";
				break;
			case 40: // Down arrow
			case 83: // S
			case 98 + (+!this.ignoreNumLock * 1000): // 2 on numpad
				e.direction = "down";
				break;
			case 37: // Left
			case 65: // A
			case 100 + (+!this.ignoreNumLock * 1000): // 4 on numpad
				e.direction = "left";
				break;
			case 39: // Right
			case 68: // D
			case 102 + (+!this.ignoreNumLock * 1000): // 6 on numpad
				e.direction = "right";
				break;
			default: {
				e.direction = "";
			}
		}
		
		this.onkeyup(e);
	}

	/**
	 * Manage mouse click events. Should
	 * be avoided; mousedown is preferred.
	 * @param {object} e - The click event
	 */
	click(e) {
		e.preventDefault();
		this.onclick(e);
	}

	/**
	 * Manage double-click events
	 * @param {object} e - The dblclick event
	 */
	dblClick(e) {
		e.preventDefault();
		this.ondblclick(e);
	}

	/**
	 * Manage touchstart events
	 * @param {object} e - The touchstart event
	 */
	touchStart(e) {
		if(!this.passiveFlag)
			e.preventDefault();

		this.numPressPoints = e.touches.length;
		this.ontouchstart(e);

		// Account CSS transform scaling
		if(this.multiTouch) {
			for(let i = 0; i < e.targetTouches.length; i++) {
				this.pressStart(
					(e.targetTouches[i].clientX - this.wrapper.offsetLeft) / this.screenScalar,
					(e.targetTouches[i].clientY - this.wrapper.offsetTop) / this.screenScalar);
			}
		}
		else {
			this.pressStart(
				(e.targetTouches[0].clientX - this.wrapper.offsetLeft) / this.screenScalar,
				(e.targetTouches[0].clientY - this.wrapper.offsetTop) / this.screenScalar);
		}
	}

	/**
	 * Manage desktop mouse events. Our games are
	 * primarily for touch (mobile), so this mouse event
	 * simulates a touchdown event for the game.
	 * @param {object} e - The mousedown event
	 */
	mouseDown(e) {
		e.preventDefault();

		this.leftMousePressed = false;
		this.middleMousePressed = false;
		this.rightMousePressed = false;

		// We only have 8 possibilities for 3 primary buttons
		switch(e.buttons) {
			case 0:
				this.numPressPoints = 0;
				break;
			case 1:
				this.leftMousePressed = true;
				this.numPressPoints = 1;
				break;
			case 2:
				this.rightMousePressed = true;
				this.numPressPoints = 1;
				break;
			case 3:
				this.rightMousePressed = true;
				this.leftMousePressed = true;
				this.numPressPoints = 2;
				break;
			case 4:
				this.middleMousePressed = true;
				this.numPressPoints = 1;
				break;
			case 5:
				this.middleMousePressed = true;
				this.leftMousePressed = true;
				this.numPressPoints = 2;
				break;
			case 6:
				this.middleMousePressed = true;
				this.rightMousePressed = true;
				this.numPressPoints = 1;
				break;
			case 7:
				this.middleMousePressed = true;
				this.rightMousePressed = true;
				this.leftMousePressed = true;
				this.numPressPoints = 3;
				break;
			default: {
				this.numPressPoints = 0;
			}
		}

		// Allow for up to 5 mouse buttons pressed at once
		this.numPressPoints = this.toBinary(e.buttons).split("")
			.reduce((runningSum, anyItem) => runningSum + (+anyItem), 0);

		this.mouseState = [0,
			(+this.leftMousePressed),
			(+this.middleMousePressed),
			(+this.rightMousePressed),
			0];

		this.mouseStateString = this.mouseState.join("");

		/*
		switch(e.button) {
			case 0: // Main button (left click)
				this.leftMousePressed = true;
				break;
			case 1: // Auxiliary button (wheel)
				this.middleMousePressed = true;
				break;
			case 2: // Secondary (right-click) button
				this.rightMousePressed = true;
				break;
			case 3: // Browser-back button
				break;
			case 4: // Browser-forward button
				break;
			default: {} // Unknown
		}
		*/

		this.onmousedown(e);

		// Account CSS transform scaling
		this.pressStart(
			(e.clientX - this.wrapper.offsetLeft) / this.screenScalar,
			(e.clientY - this.wrapper.offsetTop) / this.screenScalar);

		if(e.button === 2) {
			this.onrightclick(e);
		}
	}

	/**
	 * Handle touchstart or mousedown event at the point
	 *   (x, y) on the canvas. Should not be overridden
	 *   (use onpressstart instead).
	 * @param {number} x - The point's (float) x position
	 * @param {number} y - The point's (float) y position
	 */
	pressStart(x, y) {
		if(this.latestPoint === null) {
			this.latestPoint = {
				x: x,
				y: y
			};
		}

		if(this.doodleOptions.enabled) {
			this.startDoodle(new CMPoint(x, y), this.doodleOptions);
		}

		this.onpressstart({
				x: x,
				y: y
			});
	}

	/**
	 * Manage touchmove events
	 * @param {object} e - The touchmove event
	 */
	touchMove(e) {
		if(!this.passiveFlag)
			e.preventDefault();

		this.numPressPoints = e.touches.length;
		this.ontouchmove(e);

		// Account CSS transform scaling
		if(this.multiTouch) {
			for(let i = 0; i < e.targetTouches.length; i++) {
				this.pressMove(
					(e.targetTouches[i].clientX - this.wrapper.offsetLeft) / this.screenScalar,
					(e.targetTouches[i].clientY - this.wrapper.offsetTop) / this.screenScalar);
			}
		}
		else {
			this.pressMove(
				(e.targetTouches[0].clientX - this.wrapper.offsetLeft) / this.screenScalar,
				(e.targetTouches[0].clientY - this.wrapper.offsetTop) / this.screenScalar);
		}
	}

	/**
	 * Manage desktop mouse events. Our games are
	 * primarily for touch (mobile), so this mouse event
	 * simulates a touchmove event for the game.
	 * @param {object} e - The mousemove event
	 */
	mouseMove(e) {
		e.preventDefault();

		this.leftMousePressed = false;
		this.middleMousePressed = false;
		this.rightMousePressed = false;

		// We only have 8 possibilities for 3 primary buttons
		switch(e.buttons) {
			case 0:
				this.numPressPoints = 0;
				break;
			case 1:
				this.leftMousePressed = true;
				this.numPressPoints = 1;
				break;
			case 2:
				this.rightMousePressed = true;
				this.numPressPoints = 1;
				break;
			case 3:
				this.rightMousePressed = true;
				this.leftMousePressed = true;
				this.numPressPoints = 2;
				break;
			case 4:
				this.middleMousePressed = true;
				this.numPressPoints = 1;
				break;
			case 5:
				this.middleMousePressed = true;
				this.leftMousePressed = true;
				this.numPressPoints = 2;
				break;
			case 6:
				this.middleMousePressed = true;
				this.rightMousePressed = true;
				this.numPressPoints = 2;
				break;
			case 7:
				this.middleMousePressed = true;
				this.rightMousePressed = true;
				this.leftMousePressed = true;
				this.numPressPoints = 3;
				break;
			default: {
				this.numPressPoints = 0;
			}
		}

		// Allow for up to 5 mouse buttons pressed at once
		this.numPressPoints = this.toBinary(e.buttons).split("")
			.reduce((runningSum, anyItem) => runningSum + (+anyItem), 0);

		this.mouseState = [0,
			(+this.leftMousePressed),
			(+this.middleMousePressed),
			(+this.rightMousePressed),
			0];

		this.mouseStateString = this.mouseState.join("");

		this.onmousemove(e);

		if(this.leftMousePressed) {
			this.pressMove(
				(e.clientX - this.wrapper.offsetLeft) / this.screenScalar,
				(e.clientY - this.wrapper.offsetTop) / this.screenScalar);
		}
	}

	/**
	 * Handle touchmove or mousemove event at the point
	 *   (x, y) on the canvas. Should not be overridden
	 *   (use onpressmove instead).
	 * @param {number} x - The point's (float) x position
	 * @param {number} y - The point's (float) y position
	 */
	pressMove(x, y) {
		let oldX = x;
		let oldY = y;

		if(this.latestPoint === null) {
			this.latestPoint = {
				x: x,
				y: y
			};
		}
		else
		if(this.distance(this.latestPoint, new CMPoint(x, y)) >= CMGame.PIXELS_FOR_SWIPE) {
			this.onswipe(
				new CMSwipe(this, x, y, this.latestPoint.x, this.latestPoint.y)
			);

			oldX = this.latestPoint.x;
			oldY = this.latestPoint.y;
			this.latestPoint = {
				x: x,
				y: y
			};
		}

		if(this.currentDoodle) {
			this.currentDoodle.addPoint(x, y);
		}

		this.onpressmove({
				x: x,
				y: y,
				oldX: oldX,
				oldY: oldY,
				offset: {
					x: x - oldX,
					y: y - oldY
				}
			});
	}

	/**
	 * Manage touchend events
	 * @param {object} e - The touchend event
	 */
	touchEnd(e) {

		// This should prevent a touch registering as a mouse click
		e.preventDefault();

		this.numPressPoints = e.touches.length;

		if(this.multiTouch) {
			for(let i = 0; i < e.changedTouches.length; i++) {
				this.pressEnd(
					(e.changedTouches[i].clientX - this.wrapper.offsetLeft) / this.screenScalar,
					(e.changedTouches[i].clientY - this.wrapper.offsetTop) / this.screenScalar);
			}
		}
		else {
			this.pressEnd(
				(e.changedTouches[0].clientX - this.wrapper.offsetLeft) / this.screenScalar,
				(e.changedTouches[0].clientY - this.wrapper.offsetTop) / this.screenScalar);
		}
	}

	/**
	 * Manage desktop mouse events. Our games are
	 * primarily for touch (mobile), so this mouse event
	 * simulates a touchend event for the game.
	 * @param {object} e - The mouseup event
	 */
	mouseUp(e) {
		e.preventDefault();
		this.leftMousePressed = false;
		this.middleMousePressed = false;
		this.rightMousePressed = false;
		this.numPressPoints = 0;

		// We only have 8 possibilities for 3 primary buttons
		switch(e.buttons) {
			case 0:
				this.numPressPoints = 0;
				break;
			case 1:
				this.leftMousePressed = true;
				this.numPressPoints = 1;
				break;
			case 2:
				this.rightMousePressed = true;
				this.numPressPoints = 1;
				break;
			case 3:
				this.rightMousePressed = true;
				this.leftMousePressed = true;
				this.numPressPoints = 2;
				break;
			case 4:
				this.middleMousePressed = true;
				this.numPressPoints = 1;
				break;
			case 5:
				this.middleMousePressed = true;
				this.leftMousePressed = true;
				this.numPressPoints = 2;
				break;
			case 6:
				this.middleMousePressed = true;
				this.rightMousePressed = true;
				this.numPressPoints = 2;
				break;
			case 7:
				this.middleMousePressed = true;
				this.rightMousePressed = true;
				this.leftMousePressed = true;
				this.numPressPoints = 3;
				break;
			default: {
				this.numPressPoints = 0;
			}
		}

		// Allow for up to 5 mouse buttons pressed at once
		this.numPressPoints = this.toBinary(e.buttons).split("")
			.reduce((runningSum, anyItem) => runningSum + (+anyItem), 0);

		this.mouseState = [0,
			(+this.leftMousePressed),
			(+this.middleMousePressed),
			(+this.rightMousePressed),
			0];

		this.mouseStateString = this.mouseState.join("");

		/**
		// Abandoned in preference of mouseState
		switch(e.button) {
			case 0: // Main button (left click)
				this.leftMousePressed = false;
				break;
			case 1: // Auxiliary button (wheel)
				this.middleMousePressed = false;
				break;
			case 2: // Secondary (right-click) button
				this.rightMousePressed = false;
				break;
			case 3: // Browser-back button
				break;
			case 4: // Browser-forward button
				break;
			default: {} // Unknown
		}
		*/

		this.onmouseup(e);

		this.pressEnd(
			(e.clientX - this.wrapper.offsetLeft) / this.screenScalar,
			(e.clientY - this.wrapper.offsetTop) / this.screenScalar);
	}

	/**
	 * Handle mouseup or touchend events at the point
	 *   (x, y) on the canvas. Should be overridden.
	 * @param {number} x - The point's (float) x position
	 * @param {number} y - The point's (float) y position
	 */
	pressEnd(x, y) {
		this.latestPoint = null;
		CMGame.clearAll(this.latestSwipes,
			this.latestSwipeStrings,
			this.latestSwipeStrings8,
			this.latestSwipePath,
			this.latestSwipePath8);

		if(this.doodleOptions.enabled) {
			this.stopDoodle();
		}

		this.onpressend({
				x: x,
				y: y
			});
	}

	/**
	 * Checks if two "box"-shaped objects are colliding;
	 *   that is, objects with x, y, width, and height values
	 * @param {number|object} x1 - First x value; or the first object
	 * @param {number|object} y2 - First y value; or the second object
	 * @param {number} [w1] - First object's width
	 * @param {number} [h1] - First object's height
	 * @param {number} [x2] - Second object's x value
	 * @param {number} [y2] - Second object's y value
	 * @param {number} [w2] - Second object's width
	 * @param {number} [h2] - Second object's height
	 * @returns {boolean}
	 */
	areColliding(x1, y1, w1, h1, x2, y2, w2, h2) {

		// >=3 arguments => can assume all properties are given
		if(typeof h1 !== "undefined") {
			if(x1 <= x2 + w2 && x1 + w1 >= x2)	{
				if(y1 <= y2 + h2 && y1 + h1 >= y2) {
					return true;
				}
			}

			return false;
		}

		/**
		 * Otherwise, we are just checking
		 * 2 objects. Renamed for readability.
		 */
		let obj1 = x1;
		let obj2 = y1;
		if(!obj1.shape)
			obj1.shape = "rect";

		if(!obj2.shape)
			obj2.shape = "rect";

		if(obj1.shape === "circle") {
			if(obj2.shape === "circle") {
				return this.distance(obj1, obj2) <= obj1.radius + obj2.radius;
			}
			else
			if(obj2.shape === "rect") {
				return this.areColliding(
					obj1.x - obj1.radius, obj1.y - obj1.radius, obj1.radius * 2, obj1.radius * 2,
					obj2.x, obj2.y, obj2.width, obj2.height);
			}
		}

		if(obj2.shape === "circle" && obj1.shape === "rect") {
			return this.areColliding(
				obj1.x, obj1.y, obj1.width, obj1.height,
				obj2.x - obj2.radius, obj2.y - obj2.radius, obj2.radius * 2, obj2.radius * 2);
		}

		if(obj1.x <= obj2.x + obj2.width && obj1.x + obj1.width >= obj2.x)	{
			if(obj1.y <= obj2.y + obj2.height && obj1.y + obj1.height >= obj2.y) {
				return true;
			}
		}

		return false;
	}

	/**
	 * Check distance between two points
	 * @param {object} p1 - First point (or any object with x and y values)
	 * @param {object} p2 - Second point (or any object with x and y values)
	 * @returns {number}
	 */
	distance(p1, p2) {
		if(typeof p1.z !== "undefined" &&
				typeof p2.z !== "undefined") {
			return Math.hypot(p1.x - p2.x, p1.y - p2.y, p1.z - p2.z);
		}

		return Math.hypot(p1.x - p2.x, p1.y - p2.y);
	}

	/**
	 * Draws single line between two points. Note:
	 * if multiple lines are being connected, it
	 * is more efficient to continue one path
	 * with lineTo and end with a single stroke.
	 * @param {number|object} x1OrP1 - The first point's x value, or the first point
	 * @param {number|object} y1OrP2 - The first point's y value, or the second point
	 * @param {number} [x2] - The second point's x value
	 * @param {number} [y2] - The second point's y value
	 */
	drawLine(x1OrP1, y1OrP2, x2, y2) {
		if(typeof x2 !== "undefined") {
			this.offscreenCtx.beginPath();
			this.offscreenCtx.moveTo(x1OrP1, y1OrP2);
			this.offscreenCtx.lineTo(x2, y2);
			this.offscreenCtx.stroke();
			return this;
		}

		// Two points sent in instead of 4 coordinates
		this.offscreenCtx.beginPath();
		this.offscreenCtx.moveTo(x1OrP1.x, x1OrP1.y);
		this.offscreenCtx.lineTo(y1OrP2.x, y1OrP2.y);
		this.offscreenCtx.stroke();
		return this;
	}

	/**
	 * Helper function for drawing filled circle, or
	 * an oval (or circle) contained in a bounding rect
	 * @param {number} x - Circle center's x value
	 * @param {number} y - Circle center's y value
	 * @param {number} radiusOrWidth - Circle's radius, or
	 *   bounding rect's width (if height is passed in)
	 * @param {number} [height] - Circle's bounding rect's height
	 */
	fillOval(x, y, radiusOrWidth, height) {
		this.offscreenCtx.beginPath();

		if(typeof height !== "undefined") {
			this.offscreenCtx.ellipse(
				x + .5 * radiusOrWidth,
				y + .5 * height,
				.5 * radiusOrWidth,
				.5 * height,
				0,
				0,
				Math.TAU,
				false);
		}
		else {
			this.offscreenCtx.arc(x, y, radiusOrWidth, 0, Math.TAU, false);
		}

		this.offscreenCtx.fill();
	}

	/**
	 * Helper function for drawing stroked circle, or
	 * an oval (or circle) contained in a bounding rect
	 * @param {number} x - Circle center's x value
	 * @param {number} y - Circle center's y value
	 * @param {number} radiusOrWidth - Circle's radius, or
	 *   bounding rect's width (if height is passed in)
	 * @param {number} [height] - Circle's bounding rect's height
	 */
	strokeOval(x, y, radiusOrWidth, height) {
		this.offscreenCtx.beginPath();

		if(typeof height !== "undefined") {
			this.offscreenCtx.ellipse(
				x + .5 * radiusOrWidth,
				y + .5 * height,
				.5 * radiusOrWidth,
				.5 * height,
				0,
				0,
				Math.TAU,
				false);
		}
		else {
			this.offscreenCtx.arc(x, y, radiusOrWidth, 0, Math.TAU, false);
		}

		this.offscreenCtx.stroke();
	}

	/**
	 * Draws and fills a rounded rectangle on the canvas
	 * Adapted from solutions here:
	 * https://stackoverflow.com/questions/1255512/how-to-draw-a-rounded-rectangle-using-html-canvas
	  * @param {number} x - The top left x coordinate 
	  * @param {number} y - The top left y coordinate  
	  * @param {number} width - The width of the rectangle  
	  * @param {number} height - The height of the rectangle
	  * @param {number} radius - The rounded corner radius (used for all 4 corners)
	  */
	fillRoundedRect(x, y, w, h, r) {

		// Radius is too big, reduce to half the width or height
		if (w < 2 * r) {
			r = .5 * w;
		}

		if (h < 2 * r) {
			r = .5 * h;
		}

		this.offscreenCtx.beginPath();
		this.offscreenCtx.moveTo(x+r, y);
		this.offscreenCtx.arcTo(x+w, y,   x+w, y+h, r);
		this.offscreenCtx.arcTo(x+w, y+h, x,   y+h, r);
		this.offscreenCtx.arcTo(x,   y+h, x,   y,   r);
		this.offscreenCtx.arcTo(x,   y,   x+w, y,   r);
		this.offscreenCtx.closePath();
		this.offscreenCtx.fill();
	}

	/**
	 * Draws and strokes a rounded rectangle on the canvas
	 * Adapted from solutions here:
	 * https://stackoverflow.com/questions/1255512/how-to-draw-a-rounded-rectangle-using-html-canvas
	  * @param {number} x - The top left x coordinate 
	  * @param {number} y - The top left y coordinate  
	  * @param {number} width - The width of the rectangle  
	  * @param {number} height - The height of the rectangle
	  * @param {number} radius - The rounded corner radius (used for all 4 corners)
	  */
	strokeRoundedRect(x, y, w, h, r) {

		// Radius is too big, reduce to half the width or height
		if (w < 2 * r) {
			r = .5 * w;
		}

		if (h < 2 * r) {
			r = .5 * h;
		}

		this.offscreenCtx.beginPath();
		this.offscreenCtx.moveTo(x+r, y);
		this.offscreenCtx.arcTo(x+w, y,   x+w, y+h, r);
		this.offscreenCtx.arcTo(x+w, y+h, x,   y+h, r);
		this.offscreenCtx.arcTo(x,   y+h, x,   y,   r);
		this.offscreenCtx.arcTo(x,   y,   x+w, y,   r);
		this.offscreenCtx.closePath();
		this.offscreenCtx.stroke();
	}

	/**
	 * Helper function to detect if a circle and rectangle intersect
	 * Based on solution provided by e.James here:
	 * https://stackoverflow.com/questions/401847/circle-rectangle-collision-detection-intersection
	 * @param {object} circle - A circular object with x, y, and radius values
	 * @param {object} rect - A rectangular object with x, y, width, and height values
	 * @deprecated - Produces some inconsistencies
	 */
	circleIntersectsRect(circle, rect) {
		let circleDistance = {
				x: Math.abs(circle.x - rect.x),
				y: Math.abs(circle.y - rect.y)
		};

		if (circleDistance.x > (.5 * rect.width + circle.radius)) { return false; }
		if (circleDistance.y > (.5 * rect.height + circle.radius)) { return false; }

		if (circleDistance.x <= (.5 * rect.width)) { return true; } 
		if (circleDistance.y <= (.5 * rect.height)) { return true; }

		let cornerDistance_sq = (circleDistance.x - .5 * rect.width)**2 +
							 (circleDistance.y - .5 * rect.height)**2;

		let intersecting = (cornerDistance_sq <= (circle.r**2));
		return intersecting;
	}

	/**
	 * Draws an image rotated around a point
	 * Parameters start with usual drawImage
	 * parameters for CanvasRenderingContext2D,
	 * and follow with one options object.
	 * @param {object} image - The image (Image instance, <img> element, etc.) to be rotated
	 * @param {array} otherArgs - All arguments after the image are saved in a rest parameter.
	 *   These 
	 * @param {object|number} opts - Drawing options. If just
	 *   a number is entered, this will be taken as the
	 *   angle and the rotation will rotate about the image center.
	 *   This is reserved as an object for future option considerations.
	 * @param {number} opts.angle - The angle in radians to rotate (clockwise, from viewer's perspective)
	 */
	drawRotatedImage(image, ...args) {
		let numArgs = args.length; // 4, 6, or 10, with options
		let opts = args[numArgs - 1];
		let angle = 0;

		switch(typeof opts) {
			case "number":
				angle = opts;
				break;
			case "object":
				angle = opts.angle;
				break;
			default:
				angle = 0;
				break;
		}

		let x = args[0];
		let y = args[1];
		let imgWidth = args[2] || image.width;
		let imgHeight = args[3] || image.height;

		// Use destination coordinates, not source
		if(numArgs > 5) {
			x = args[0];
			y = args[1];
			imgWidth = args[2] || image.width;
			imgHeight = args[3] || image.height;
		}

		let center = {
			x: x + .5 * imgWidth,
			y: y + .5 * imgHeight
		};

		this.offscreenCtx.save();
		this.offscreenCtx.translate(center.x, center.y);
		this.offscreenCtx.rotate(angle);
		this.offscreenCtx.translate(-center.x, -center.y);
		this.offscreenCtx.drawImage.apply(this.offscreenCtx, [image, ...args]);
		this.offscreenCtx.restore();
	}

	/**
	 * Draws a string that uses multiple fonts-
	 * primarily for embedding italic variables.
	 *
	 * Example usage:
	 *
	 * game.drawStrings(
	 *	  ["15px Arial", "italic 16px Times", "14pt monospace"],
	 *	  ["2", "&pi;", " - checked"],
	 *   200, 100);
	 *
	 * @param {string[]|string} fonts - The list of fonts to use in order
	 *   (cycles back to beginning of strings.length > fonts.length)
	 *   or a single font being used foor all strings. If a single font string
	 *   is provided, it is read as a single-element array. If a falsy value
	 *   or empty string is provided, game's current font is used.
	 * @param {string[]|string} strings - The strings to write in order
	 *   or a single string being drawn. If a single string is provided,
	 *   it is interpreted as a single-element array (ctx.fillText might
	 *   be more appropriate in this case).
	 * @param {number} x - The starting x position of the full string
	 * @param {number} y - The y position of the full string
	 * @param {object} [options={}] - An object of options
	 * @param {boolean} [options.fill=true] Will use fillText if true
	 * @param {boolean} [options.stroke=false] Will use strokeText if true
	 * @param {boolean} [options.fillStyles[]] An array of colors to fill with
	 * @param {boolean} [options.strokeStyles[]] An array of colors to stroke with
	 * @returns {number} The ending x of the complete string
	 */
	drawStrings(fonts, strings, x, y, options={}) {
		let defaults = {
			fill: true,
			stroke: false,
			fillStyles: [],
			strokeStyles: []
		};

		let opts = {};
		for(let key in defaults) {
			opts[key] = (typeof options[key] !== "undefined") ? options[key] : defaults[key]
		}

		if(typeof opts.fillStyles === "string") {
			opts.fillStyles = [opts.fillStyles];
		}
		else
		if(!opts.fillStyles || opts.fillStyles.length === 0) {
			opts.fillStyles = [this.offscreenCtx.fillStyle];
		}

		if(typeof opts.strokeStyles === "string") {
			opts.strokeStyles = [opts.strokeStyles];
		}
		else
		if(!opts.strokeStyles || opts.strokeStyles.length === 0) {
			opts.strokeStyles = [this.offscreenCtx.strokeStyle];
		}

		if(typeof opts.colors !== "undefined") {
			console.warn("\"colors\" is not a valid option for drawStrings(). Use \"fillStyles\" or \"strokeStyles\" instead.");
		}

		if(typeof fonts === "string") {
			fonts = [fonts];
		}

		if(typeof strings === "string") {
			strings = [strings];
		}

		if(!fonts || fonts.length === 0) {
			fonts = [this.offscreenCtx.font];
			numFonts = 1;
		}

		let numFonts = fonts.length;
		let numStrings = strings.length;
		let offsetX = 0;

		for(let i = 0; i < numStrings; i++) {
			this.offscreenCtx.font = fonts[i % numFonts];

			if(opts.fill) {
				this.offscreenCtx.fillStyle = opts.fillStyles[i % opts.fillStyles.length];
				this.offscreenCtx.fillText(strings[i], x + offsetX, y);
			}

			if(opts.stroke) {
				this.offscreenCtx.strokeStyle = opts.strokeStyles[i % opts.strokeStyles.length];
				this.offscreenCtx.strokeText(strings[i], x + offsetX, y);
			}

			// Add width of text in current font
			offsetX += this.offscreenCtx.measureText(strings[i]).width;
		}

		return x + offsetX;
	}

	/**
	 * In preparation for using the drawStrings method, the
	 * dev may want the full string width before hand.
	 * This method calculates that measurement without
	 * drawing to the screen. No x or y required.
	 * @param {string[]|string} fonts - Array of the fonts to use in order (cycles if > strings.length);
	 *   or single string with font to use. If null (or falsy value) is provided, will use game's current font.
	 * @param {string[]|string} strings - Array of the strings to write in order. Or
	 *   a single string that is being measured.
	 * @returns {number} The total string width as if drawn
	 */
	measureStrings(fonts, strings) {
		if(typeof fonts === "string") {
			fonts = [fonts];
		}
		else
		if(!fonts || fonts.length === 0) {
			fonts = [this.offscreenCtx.font];
		}

		if(typeof strings === "string") {
			strings = [strings];
		}

		let numFonts = fonts.length;
		let numStrings = strings.length;
		let offsetX = 0;

		for(let i = 0; i < numStrings; i++) {
			this.offscreenCtx.font = fonts[i % numFonts];

			// Add width of text in current font
			offsetX += this.offscreenCtx.measureText(strings[i]).width;
		}

		return offsetX;
	}

	/**
	 * Similar to drawStrings method, but centers at (x, y)
	 * @param {string[]|string} fontsArg - font, or array of the fonts to use in order (cycles if > strings.length)
	 * @param {string[]|string} stringsArg - string, or array of the strings to write in order
	 * @param {number} x - The x position for the center of the full string
	 * @param {number} y - The y position for the center of the the full string
	 * @param {object} [options={}] - An object of options
	 * @param {boolean} [options.fill=true] Will use fillText if true
	 * @param {boolean} [options.stroke=false] Will use strokeText if true
	 * @param {boolean} [options.fillStyles[]] An array of colors, gradients, etc. to fill with
	 * @param {boolean} [options.strokeStyles[]] An array of colors, gradients, etc. to stroke with
	 * @param {number} [options.angle=0] An angle (radians) to rotate by (clockwise, from viewer's perspective)
	 * @param {number} [options.centerVertically=true] If true uses textBaseline="middle"
	 * @returns {number} The ending x of the complete centered string, as if not rotated
	 */
	drawStringsCentered(fontsArg, stringsArg, x, y, options={}) {
		let defaults = {
			fill: true,
			stroke: false,
			fillStyles: [],
			strokeStyles: [],
			angle: 0,
			centerVertically: true
		};

		let opts = {};
		for(let key in defaults) {
			opts[key] = typeof options[key] !== "undefined" ? options[key] : defaults[key];
		}

		// These lines allow us to pass in single strings or arrays
		let fonts = Array.isArray(fontsArg) ? fontsArg: [fontsArg];
		let strings = Array.isArray(stringsArg) ? stringsArg: [stringsArg];

		if(typeof opts.fillStyles === "string") {
			opts.fillStyles = [opts.fillStyles];
		}
		else
		if(!opts.fillStyles || opts.fillStyles.length === 0) {
			opts.fillStyles = [this.offscreenCtx.fillStyle];
		}

		if(typeof opts.strokeStyles === "string") {
			opts.strokeStyles = [opts.strokeStyles];
		}
		else
		if(!opts.strokeStyles || opts.strokeStyles.length === 0) {
			opts.strokeStyles = [this.offscreenCtx.strokeStyle];
		}


		let numFonts = fonts.length;
		let numStrings = strings.length;
		let offsetX = 0;
		this.offscreenCtx.save();

		if(opts.centerVertically) {
			this.offscreenCtx.textBaseline = "middle";
		}

		// Pre-draw strings, shift left by half
		let newLeftX = x - .5 * this.measureStrings.apply(this, [fonts, strings]);

		if(opts.angle !== 0) {
			this.offscreenCtx.translate(x, y);
			this.offscreenCtx.rotate(opts.angle);
			this.offscreenCtx.translate(-x, -y);
		}

		for(let i = 0; i < numStrings; i++) {
			this.offscreenCtx.font = fonts[i % numFonts];

			if(opts.fill) {
				this.offscreenCtx.fillStyle = opts.fillStyles[i % opts.fillStyles.length];
				this.offscreenCtx.fillText(strings[i], newLeftX + offsetX, y);
			}

			if(opts.stroke) {
				this.offscreenCtx.strokeStyle = opts.strokeStyles[i % opts.strokeStyles.length];
				this.offscreenCtx.strokeText(strings[i], newLeftX + offsetX, y);
			}

			// Add width of text in current font
			offsetX += this.offscreenCtx.measureText(strings[i]).width;
		}

		this.offscreenCtx.restore();
		return newLeftX + offsetX;
	}

	/**
	 * Try to play sound effect
	 * @param {string} soundId - a registered string identifying the sound file
	 */
	playSound(soundId) {
		if(!this.soundOn) {
			return;
		}

		CMSound.play(soundId).then(CMGame.noop, () => {

			try {
				// SoundJS not working or not loaded, default to normal Audio()
				cmAudioMap.get(soundId).play();
			}
			catch(e) {
				console.log(`Error playing sound ${soundId}.
					Check that all files are loaded.`);
			}
		});
	}

	/**
	 * Try to pause a sound effect (note: most effects are
	 * short, so this is rarely necessary). Since sound
	 * effects are brief, this resets time to 0.
	 * @param {string} soundId - a registered string identifying the sound file
	 */
	stopSound(soundId) {
		CMSound.stop(soundId).then(CMGame.noop, () => {
			try {
				cmAudioMap.get(soundId).pause();
				cmAudioMap.get(soundId).currentTime = 0;
			}
			catch(e) {
				console.log("Error pausing sound.");
			}
		});
	}

	/**
	 * Try to pause a sound effect (note: most effects are
	 * short, so this is rarely necessary). Maintains currentTime.
	 * @param {string} soundId - a registered string identifying the sound file
	 */
	pauseSound(soundId) {
		CMSound.stop(soundId).then(CMGame.noop, () => {
			try {
				cmAudioMap.get(soundId).pause();
				cmAudioMap.get(soundId).currentTime = 0;
			}
			catch(e) {
				console.log("Error pausing sound.");
			}
		});
	}

	/**
	 * Try to play background music. Similar to
	 * playSound, but checks musicOn flag rather
	 * than soundOn flag, and loops.
	 * @param {string} soundId - a registered string identifying the sound file
	 */
	playMusic(soundId) {
		if(!this.musicOn) {
			return;
		}

		CMSound.loop(soundId).then(CMGame.noop, () => {
			try {
				cmAudioMap.get(soundId).loop = true;
				cmAudioMap.get(soundId).play();
			}
			catch(e) {
				console.log(`Error playing sound ${soundId}.
					Check that all files are loaded.`);
			}
		});
	}

	/**
	 * Try to pause the background music
	 * @param {string} soundId - a registered string identifying the sound file
	 */
	pauseMusic(soundId) {
		CMSound.pause(soundId).then(CMGame.noop, () => {
			try {
				cmAudioMap.get(soundId).pause();
			}
			catch(e) {
				console.log("Error pausing sound.");
			}
		});
	}

	/**
	 * Try to pause the background music, and
	 * reset its current time to 0.
	 * @param {string} soundId - a registered string identifying the sound file
	 */
	stopMusic(soundId) {
		CMSound.stop(soundId).then(CMGame.noop, () => {
			try {
				cmAudioMap.get(soundId).pause();
				cmAudioMap.get(soundId).currentTime = 0;
			}
			catch(e) {
				console.log("Error pausing sound.");
			}
		});
	}

	/**
	 * Zooms in on "graph" type game. Note: this
	 * becomes buggy when changing the game's origin
	 * while zoomed in/out.
	 * @param {number} newScale - Number representing percentage of original picture (e.g. 0.2 for 50%)
	 */
	zoom(newScale) {

		if(typeof newScale !== "number" || newScale <= 0 || !Number.isFinite(newScale) || Number.isNaN(newScale)) {
			console.error("zoom() must take a positive integer or float value as its argument. Set to 1 for 100%.");
			return;
		}

		this.zoomLevel = newScale;

		this.graphScalar = this.unzoomedGraphScalar / this.zoomLevel;
		this.tickDistance = this.unzoomedTickDistance / this.zoomLevel;

		if(this.zoomLevel === 1) {
			this.origin.x = this.unzoomedOrigin.x;
			this.origin.y = this.unzoomedOrigin.y;
		}
		else {
			this.origin.x = this.center.x + (this.unzoomedOrigin.x - this.center.x) / this.zoomLevel;
			this.origin.y = this.center.y + (this.unzoomedOrigin.y - this.center.y) / this.zoomLevel;
		}

		for(let func of this.functions) {
			func.updateBoundsOnResize(this.zoomLevel);
		}

		if(this.paused)
			this.draw();
	}

	/**
	 * Converts radians to degrees
	 * @param {number} radians
	 * @returns {number}
	 */
	toDegrees(radians) {
		return 180 * radians / Math.PI;
	}

	/**
	 * Converts degrees to radians
	 * @param {number} degrees
	 * @returns {number}
	 */
	toRadians(degrees) {
		return Math.PI * degrees / 180;
	}

	/**
	 * Converts a cartesian point to polar
	 * @param {object|number} pointOrX - A Point or similar, with x and
	 *   y number values; or simply x, if y is provided as a second argument
	 * @param {number} [yArg] - The point's y value
	 * @returns {object} A plain JS object with r and theta number values
	 */
	toPolar(pointOrX, yArg) {
		let x, y;

		if(typeof yArg === "number") {
			x = pointOrX;
			y = yArg;
		}
		else {
			x = pointOrX.x;
			y = pointOrX.y;
		}

		if(x === 0) {
			if(y > 0) {
				return {
					r: y,
					theta: Math.PI/2
				};
			}
			else
			if(y < 0) {
				return {
					r: y,
					theta: 3 * Math.PI/2
				};
			}
			else { // x = 0, y = 0
				return {
					r: 0,
					theta: 0
				};
			}
		}

		// Note: from above, we can assume that x is nonzero
		let thetaRadians = Math.atan( y / x );

		// inverse tangent can give unexpected values with negative x, y
		// See notes here:
		// https://www.mathsisfun.com/polar-cartesian-coordinates.html
		if(x < 0) {
			thetaRadians += Math.PI; // add 90 degrees when in quadrant II or III
		}
		else
		if(y < 0) {
			thetaRadians += 2 * Math.PI; // add 360 degrees when in quadrant IV
		}

		return {
			r: Math.hypot(x, y),
			theta: thetaRadians
		};
	}

	/**
	 * Trims away very minor rounding errors,
	 * by converting insignificantly small
	 * values to zero. Returns the number input,
	 * or 0 if the input was sufficiently small.
	 * @param {number} val - A number to check
	 * @returns {number}
	 */
	roundSmall(val) {
		if( Math.abs(val) < Number.EPSILON )
			return 0;
		else
			return val;
	}

	/**
	 * Converts a polar point (with radian angle) to Cartesian.
	 * Note: this converts the real values, so screen scaling
	 * needs to be done additionally, if using for drawing.
	 * @param {object|number} pointOrR - An object with r and theta values, or just r
	 * @param {number} [theta] - polar theta value, if 2 arguments are passed
	 * @returns {object} A plain JS object with x and y number values
	 */
	fromPolar(pointOrR, theta) {
		if(typeof theta === "number") {
			return {
				x: this.roundSmall( pointOrR * Math.cos(theta) ),
				y: this.roundSmall( pointOrR * Math.sin(theta) )
			};
		}

		return {
			x: this.roundSmall( pointOrR.r * Math.cos(pointOrR.theta) ),
			y: this.roundSmall( pointOrR.r * Math.sin(pointOrR.theta) )
		};
	}

	/**
	 * Converts a given slope, to the corresponding
	 * degrees it would represent on the unit circle,
	 * emanating from the origin.
	 * @param {number} slope - The slope (allowing infinite values)
	 * @returns {number}
	 */
	slopeToDegrees(slope) {
		if(slope === Infinity) {
			return 90;
		}

		if(slope === -Infinity) {
			return 270;
		}

		return this.toDegrees(
			this.slopeToRadians(slope)
		);
	}

	/**
	 * Converts a given slope, to the corresponding
	 * radians it would represent on the unit circle,
	 * emanating from the origin.
	 * @param {number} slope - The slope (allowing infinite values)
	 * @returns {number}
	 */
	slopeToRadians(slope) {
		if(slope === Infinity) {
			return .5 * Math.PI;
		}

		if(slope === -Infinity) {
			return 1.5 * Math.PI;
		}

		return this.toPolar({
			x: 1,
			y: slope
		}).theta;
	}

	/**
	 * Converts the degrees on the unit circle, to
	 * the corresponding slope. Returns Infinity
	 * for 90deg, and -Infinity for 270.
	 * @param {number} deg - The degrees (from 0 inclusive to 360 exclusive)
	 * @returns {number}
	 */
	degreesToSlope(deg) {

		// Bring large entries within bound.
		// We don't use % in case deg is not an integer.
		while(deg >= 360) {
			deg -= 360;
		}

		// Account for negative entries
		while(deg < 0) {
			deg += 360;
		}

		if(deg === 90) {
			return Infinity;
		}

		if(deg === 270) {
			return -Infinity;
		}

		return Math.tan( this.toPolar(deg) );
	}

	/**
	 * Converts the radians on the unit circle, to
	 * the corresponding slope. Returns Infinity
	 * for pi/2, and -Infinity for 3pi/2
	 * @param {number} rad - The radians (from 0 inclusive to 2pi exclusive)
	 * @returns {number}
	 */
	radiansToSlope(rad) {
		// Bring large entries within bound.
		// We don't use % in case deg is not an integer.
		while(rad >= Math.TAU) {
			rad -= Math.TAU;
		}

		// Account for negative entries
		while(rad < 0) {
			rad += Math.TAU;
		}

		if(rad === Math.PI / 2) {
			return Infinity;
		}

		if(rad === 3 * Math.PI / 2) {
			return -Infinity;
		}

		return Math.tan( rad );
	}

	/**
	 * Gets the slope between to two-dimensional points.
	 * Note: JavaScript will return Infinity for a division by
	 * zero. The dev may want to check the answer with
	 * Number.isFinite() and set as "undefined" or undefined.
	 * Also see getFiniteSlope().
	 * @param {Point|object} startPoint - The first point
	 * @param {Point|object} endPoint - The second point
	 * @returns {number}
	 */
	getSlope(startPoint, endPoint) {
		return (endPoint.y - startPoint.y) / (endPoint.x - startPoint.x);
	}

	/**
	 * Gets the slope between to two-dimensional points,
	 * returning undefined instead of Infinity.
	 * @param {Point|object} startPoint - The first point
	 * @param {Point|object} endPoint - The second point
	 * @returns {number}
	 */
	getFiniteSlope(startPoint, endPoint) {
		let slope = (endPoint.y - startPoint.y) / (endPoint.x - startPoint.x);

		return Number.isFinite(slope) ? slope : undefined;
	}

	/**
	 * Converts an integer to a binary string
	 * Solution found in fernandosavio's response here:
	 * https://stackoverflow.com/questions/9939760/how-do-i-convert-an-integer-to-binary-in-javascript
	 * @param {number} integer - Any integer
	 * @returns {string}
	 */
	toBinary(integer) {
		return (integer >>> 0).toString(2);
	}

	/**
	 * Converts a binary string to decimal integer
	 * @param {string} binString - The binary string
	 * @returns {number}
	 */
	fromBinary(binString) {
		return parseInt(binString, 2);
	}

	/**
	 * Set the stage, with number of circles in a Venn
	 * diagram. Currently only relates to type "venn".
	 * @param {number} [numSets=0] - Number of circle sets in initial diagram
	 * @param {boolean} [variation=0] - Allows us to include
	 *   different shapes of standard diagrams.
	 *   0 - Default. 0, 1, 2 sets are as expected. 3 sets has 1 circle (C) on top, and 2 (A, B) on bottom
	 *   1 - Subsets. 0, 1 not affected. 2 sets: A is contained in B. 3 sets: A contained in B contained in C
	 *   2 - Alternate positioning. 3 sets: 2 sets (A, B) on top, 1 set (C) on bottom
	 */
	setNumberOfSets(numSets, variation=0) {
		this.numSets = numSets;

		this.vennSets.clear();
		this.vennRegions.clear();

		// Set font for measuring text in label positioning
		let fontSize = Math.floor(this.width / 16);
		this.ctx.save();
		this.ctx.font = `italic ${fontSize}px Times New Roman, serif`;

		/**
		 * Note: since sprites are drawn in order of creation,
		 * we need to be sure to draw regions before sets
		 */
		switch(numSets) {
			case 0:
			default:
				this.vennRegions.set("I", new VennRegion(
					this,
					"",
					0
				));
				break;
			case 1:
				this.vennRegions.set("I", new VennRegion(
					this,
					"0",
					0
				));

				this.vennRegions.set("II", new VennRegion(
					this,
					"1",
					0
				));

				this.vennSets.set("A", new VennSet(
					this,
					320,
					240,
					168,
					{
						text: "A",
						x: 320 + .75 * 168,
						y: 240 + 168
					}
				));
				break;
			case 2:
				if(variation === 1) {
					this.vennRegions.set("I", new VennRegion(
						this,
						"0S0", // U \ B
						1
					));

					this.vennRegions.set("II", new VennRegion(
						this,
						"0S1", // B \ A
						1
					));

					this.vennRegions.set("III", new VennRegion(
						this,
						"1S1", // A = A && B
						1
					));

					this.vennSets.set("A", new VennSet(
						this,
						320,
						288,
						108,
						{
							text: "A",
							x: 320 + .65 * 108,
							y: 288 + .95 * 108
						}
					));

					this.vennSets.set("B", new VennSet(
						this,
						320,
						240,
						192,
						{
							text: "B",
							x: 320 + .65 * 192,
							y: 240 + .9 * 192
						}
					));
				}
				else {
					this.vennRegions.set("I", new VennRegion(
						this,
						"00",
						0
					));

					this.vennRegions.set("II", new VennRegion(
						this,
						"10",
						0
					));

					this.vennRegions.set("III", new VennRegion(
						this,
						"01",
						0
					));

					this.vennRegions.set("IV", new VennRegion(
						this,
						"11",
						0
					));

					this.vennSets.set("A", new VennSet(
						this,
						240,
						240,
						168,
						{
							text: "A",
							x: 240 - .75 * 168 - this.ctx.measureText("A").width,
							y: 240 + 168
						}
					));

					this.vennSets.set("B", new VennSet(
						this,
						400,
						240,
						168,
						{
							text: "B",
							x: 400 + .75 * 168,
							y: 240 + 168
						}
					));
				}
				break;
			case 3:
				if(variation === 1) { // 3 sets as subsets of each other
					this.vennRegions.set("I", new VennRegion(
						this,
						"0S0S0", // U \ C
						1
					));

					this.vennRegions.set("II", new VennRegion(
						this,
						"0S0S1", // C \ B
						1
					));

					this.vennRegions.set("III", new VennRegion(
						this,
						"0S1S1", // B \ A, necessarily is contained in C
						1
					));

					this.vennRegions.set("IV", new VennRegion(
						this,
						"1S1S1", // A, necessarily is contained in B and C
						1
					));
					
					this.vennSets.set("A", new VennSet(
						this,
						320,
						292,
						80,
						{
							text: "A",
							x: 320 + .6 * 80,
							y: 292 + 80
						}
					));

					this.vennSets.set("B", new VennSet(
						this,
						320,
						268,
						135,
						{
							text: "B",
							x: 320 + .8 * 135,
							y: 268 + .75 * 135
						}
					));
					
					this.vennSets.set("C", new VennSet(
						this,
						320,
						240,
						192,
						{
							text: "C",
							x: 320 + .9 * 192,
							y: 240 + .55 * 192
						}
					));

				}
				else
				if(variation === 2) { // 3 sets in a "T" shape
					this.vennRegions.set("I", new VennRegion(
						this,
						"000", // Complement of all sets
						2
					));

					this.vennRegions.set("II", new VennRegion(
						this,
						"100",
						2
					));

					this.vennRegions.set("III", new VennRegion(
						this,
						"010",
						2
					));
					
					this.vennRegions.set("IV", new VennRegion(
						this,
						"001",
						2
					));

					this.vennRegions.set("V", new VennRegion(
						this,
						"110",
						2
					));
					
					this.vennRegions.set("VI", new VennRegion(
						this,
						"101",
						2
					));
					
					this.vennRegions.set("VII", new VennRegion(
						this,
						"011",
						2
					));
					
					this.vennRegions.set("VIII", new VennRegion(
						this,
						"111", // Intersection of all sets A, B, C
						2
					));

					this.vennSets.set("A", new VennSet(
						this,
						256,
						168,
						144,
						{
							text: "A",
							x: 256 - .775 * 144 - this.ctx.measureText("A").width,
							y: 168 - .75 * 144
						}
					));

					this.vennSets.set("B", new VennSet(
						this,
						384,
						168,
						144,
						{
							text: "B",
							x: 384 + .775 * 144,
							y: 168 - .75 * 144
						}
					));	

					this.vennSets.set("C", new VennSet(
						this,
						320,
						300,
						144,
						{
							text: "C",
							x: 320 + .6 * 144,
							y: 300 + .9 * 144
						}
					));
				}
				else { // default - variation 0; C on top, A, B on bottom

					this.vennRegions.set("I", new VennRegion(
						this,
						"000", // Complement of all sets
						0
					));

					this.vennRegions.set("II", new VennRegion(
						this,
						"100",
						0
					));

					this.vennRegions.set("III", new VennRegion(
						this,
						"010",
						0
					));
					
					this.vennRegions.set("IV", new VennRegion(
						this,
						"001",
						0
					));

					this.vennRegions.set("V", new VennRegion(
						this,
						"110",
						0
					));
					
					this.vennRegions.set("VI", new VennRegion(
						this,
						"101",
						0
					));
					
					this.vennRegions.set("VII", new VennRegion(
						this,
						"011",
						0
					));
					
					this.vennRegions.set("VIII", new VennRegion(
						this,
						"111", // Intersection of all sets A, B, C
						0
					));

					this.vennSets.set("A", new VennSet(
						this,
						256,
						300,
						144,
						{
							text: "A",
							x: 256 - .75 * 144 - this.ctx.measureText("A").width,
							y: 300 + 144
						}
					));

					this.vennSets.set("B", new VennSet(
						this,
						384,
						300,
						144,
						{
							text: "B",
							x: 384 + .75 * 144,
							y: 300 + 144
						}
					));	

					this.vennSets.set("C", new VennSet(
						this,
						320,
						168,
						144,
						{
							text: "C",
							x: 320 + .75 * 144,
							y: 168 - .75 * 144
						}
					));
				}
				break;
		}

		this.ctx.restore(); // return to previous font
	}

	// Some graph theory methods:
	addEdge(edge) {
		this.edges.push(edge);
	}

	addVertex(vertex) {
		this.vertices.push(vertex);
	}

	removeEdge(edge) {
		this.edges.splice(this.edges.indexOf(edge), 1);
	}

	removeVertex(vertex) {
		this.vertices.splice(this.vertices.indexOf(vertex), 1);
	}

	/**
	 * Sets webpage to fullscreen mode if available.
	 * @param {string} [orientationChoice] - The preferred orientation to
	 *   present the screen in, e.g., "portrait" or "landscape"
	 */
	enterFullscreen(orientationChoice) {
		let elm = document.documentElement;
		if (elm.requestFullscreen) {
			elm.requestFullscreen();
		} else if (elm.msRequestFullscreen) {
			elm.msRequestFullscreen();
		} else if (elm.mozRequestFullScreen) {
			elm.mozRequestFullScreen();
		} else if (elm.webkitRequestFullscreen) {
			elm.webkitRequestFullscreen(Element.ALLOW_KEYBOARD_INPUT);
		}

		if(!orientationChoice) {
			return;
		}

		let canLock;
		try {
			if(window.screen.orientation) {
				canLock = this.orientationLock.call(window.screen.orientation, orientationChoice || "landscape");
			} else {
				canLock = this.orientationLock.call(window.screen, orientationChoice || "landscape");
			}
		} catch(e) {
			console.log("Cannot lock orientation");
		}
	}

	/** Exits fullscreen if document is in fullscreen mode. */
	exitFullscreen() {
		if (document.exitFullscreen) {
			document.exitFullscreen();
		} else if (document.msExitFullscreen) {
			document.msExitFullscreen();
		} else if (document.mozCancelFullScreen) {
			document.mozCancelFullScreen();
		} else if (document.webkitExitFullscreen) {
			document.webkitExitFullscreen();
		}
	}
}

/**
 * We provide multiple static methods
 * below for working with arrays. These
 * are static so that, if preferred, the
 * dev can randomly choose setup
 * options before the game is initiated.
 */

/**
 * Clears all elements from an array,
 * Map, or JS object, and returns
 * the empty version as a convenience.
 * Can also take in multiple arguments and clear each,
 * in which case it will return an array containing the
 * list of (now emptied) arguments that were passed in.
 * @param {array|object} arr - Any array, Map instance, or plain JS object
 * @returns {array}
 */
CMGame.clearAll = function(arr) {
	if(arguments.length > 1) {
		for(let i = 0; i < arguments.length; i++) {
			CMGame.clearAll(arguments[i]);
		}

		return Array.from(arguments);
	}

	if(Array.isArray(arr)) {
		arr.splice(0, arr.length);
	}
	else
	if(arr instanceof Map) {
		arr.clear();
	}
	else { // Assume a normal JS object (or another object with custom keys)
		for(let key in arr) {
			if(arr.hasOwnProperty(key)) {
				delete arr[key];
			}
		}
	}

	return arr;
};

/**
 * Picks random item from an array,
 * Map instance, or plain JS object of values,
 * without removing the item.
 * @param {array|object} arr - Any array, Map instance, or plain JS object
 * @returns {*}
 */
CMGame.pickFrom = (arr) => {
	if(Array.isArray(arr)) {
		return arr[CMRandom.range(0, arr.length)];
	}
	else
	if(arr instanceof Map) {
		let tempArr = [];
		for(let [key, value] of arr) {
			tempArr.push(value);
		}

		return tempArr[CMRandom.range(0, tempArr.length)];
	}
	else { // Assume a normal JS object
		let valArr = Object.values(arr);
		return valArr[CMRandom.range(0, valArr.length)]
	}
};

/**
 * Picks (and returns) random item from an array,
 * Map instance, or plain JS object of values,
 * and removes the item.
 * @param {array|object} arr - Any array, Map instance, or plain JS object
 * @returns {*}
 */
CMGame.pluckFrom = (arr) => {
	if(Array.isArray(arr)) {
		return arr.splice(CMRandom.range(0, arr.length), 1);
	}
	else
	if(arr instanceof Map) {
		let tempArr = [];
		for(let [key, value] of arr) {
			tempArr.push(value);
		}

		let item = tempArr[CMRandom.range(0, tempArr.length)];
		arr.delete(item); // Removes key-value association, without destroying object
		return item;
	}
	else { // Assume a normal JS object
		let keyArr = Object.keys(arr);
		let chosenKey = keyArr[CMRandom.range(0, keyArr.length)];
		let val = arr[chosenKey];
		delete arr[chosenKey];
		return val;
	}
};

/**
 * Shuffles an array and returns shuffled version
 * @param {array} arr - Any array
 * @returns {array}
 */
CMGame.shuffle = (arr) => {

	// Create copy to pluck from
	let tempArray = []; // Only works for primitive objects: JSON.parse( JSON.stringify(arr) );
	for(let i = 0; i < arr.length; i++) {
		tempArray.push(arr[i]);
	}

	// Clear out array - break down to build back up!
	arr = CMGame.clearAll(arr);

	// Rebuild
	while(tempArray.length > 0) {
		arr.push(
			CMGame.pluckFrom(tempArray)
		);
	}

	return arr;
}

/**
 * Gets the last element in an array
 * @param {object} arrGument - An array or array-like object
 * @returns {*}
 */
CMGame.last = ( arrGument ) => {
	let arr = Array.from( arrGument );
	return arr[arr.length - 1];
};

/**
 * Detects if an array is contained in another.
 * As the name suggests, this is ONLY for
 * use when the array contents are all
 * primitive, e.g., numbers or strings.
 * @param {array} subArray - The array to check is included
 * @param {array} bigArray - The array to check contains subArr
 * @returns {boolean}
 */
CMGame.isPrimitiveSubArray = (subArr, bigArr) => {
	let delimiter = "{(*&$(*(";
	return bigArr.join(delimiter).includes(subArr.join(delimiter));
};

// Empty function. Static so can be used as placeholder before page load
CMGame.noop = () => { /* noop */ };

// Static so user can set it before creating CMGame instance
CMGame.onpageload = CMGame.noop;
CMGame.pageLoaded = false; // Mainly for internal use

// After page load, before CMGame initialization
CMGame.onresourcesload = CMGame.noop;
CMGame.resourcesLoaded = false; // Mainly for internal use

/** Single function to handle initial page load - only used internally */
CMGame.manageLoad = (e) => {

	// This allows us to try multiple load events without excess handling
	if(CMGame.pageLoaded) {
		return;
	}

	CMGame.pageLoaded = true;
	CMGame.onpageload.call(window, e);
	domLoaded = true;
	initializeIfReady();
};

/** Try a few load implementations, to overcome occasional browser inconsistencies. */
window.addEventListener("pageshow", CMGame.manageLoad, false);
window.addEventListener("load", CMGame.manageLoad, false);
document.addEventListener("readystatechange", 
	() => {
		if(document.readyState === "complete") {
			CMGame.manageLoad.call(window);
		}
	}, false);

/**
 * Defines the least # of pixels finger can move to trigger a swipe
 * Set to 0 for continuous response but worse performance
 */
CMGame.PIXELS_FOR_SWIPE = 5;

// This is used to store/retrieve game data. Do not change this for the same game.
CMGame.SAVE_PREFIX = "cmgamesave_";

// Create some setters/getters in an IIFE to keep initial variables private
(function() {

	/**
	 * CMGame.FPS is animation speed (roughly) in frames per second
	 * CMGame.FRAME_DELAY is the milliseconds between frames
	 *
	 * These are the rough "FPS" and delay between
	 * frames using requestNextFrame. This is
	 * the fastest expected animation rate, so these
	 * should only be changed if you purposely want
	 * to create a slower game.
	 *
	 * CMGame.MAX_FPS and CMGame.MIN_FRAME_DELAY
	 * are constants for reference. Do not attempt to change them.
	 */
	Object.defineProperty(CMGame, "MAX_FPS", {
		value: 60,
		writable: false
	});

	Object.defineProperty(CMGame, "MIN_FRAME_DELAY", {
		value: 16.7,
		writable: false
	});

	/**
	 * Dev may change FPS, in which case FRAME_DELAY
	 * will update automatically since this is the value used
	 * to time animations. If you change FRAME_DELAY,
	 * FPS will not be affected (to avoid infinite loops),
	 * so you may want to set it yourself with
	 * newFPS = 1000 / CMGame.FRAME_DELAY
	 */

	// "private" variables, only used in getters/setters below
	let fps = CMGame.MAX_FPS;
	let frameDelay = CMGame.MIN_FRAME_DELAY;
	let slowerFrameId = null;

	Object.defineProperty(CMGame, "FPS", {

		get() {
			return fps;
		},

		set(newFPS) {
			fps = Math.min(newFPS, CMGame.MAX_FPS);

			if(CMGame.FRAME_DELAY !== 1000 / newFPS) { // Prevent infinite loop since...
				CMGame.FRAME_DELAY = 1000 / newFPS; // ... triggers FRAME_DELAY setter
			}
		}
	});

	Object.defineProperty(CMGame, "FRAME_DELAY", {

		get() {
			return frameDelay;
		},

		set(newFrameDelay) {
			frameDelay = Math.max(newFrameDelay, CMGame.MIN_FRAME_DELAY);

			if(frameDelay === CMGame.MIN_FRAME_DELAY) { // return to normal
				window.requestNextFrame = window.requestAnimationFrame;
				window.cancelNextFrame = window.cancelAnimationFrame;
			}
			else {
				window.requestNextFrame = function(callback) {
					setTimeout(function() {
						slowerFrameId = requestAnimationFrame(callback);
					}, newFrameDelay);
				}

				window.cancelNextFrame = function() {
					cancelAnimationFrame(slowerFrameId);
				};
			}

			// This creates an infinite loop & stack overflow. Just stick to setting FPS.
			/**
			if(CMGame.FPS !== 1000 / newFrameDelay) { // Prevent infinite loop since...
				CMGame.FPS = 1000 / newFrameDelay; // ... triggers FPS setter

				if(newFrameDelay === CMGame.MIN_FRAME_DELAY) { // return to normal
					window.requestNextFrame = window.requestAnimationFrame;
					window.cancelNextFrame = window.cancelAnimationFrame;
				}
				else {
					window.requestNextFrame = function(callback) {
						setTimeout(function() {
							slowerFrameId = requestAnimationFrame(callback);
						}, newFrameDelay);
					}

					window.cancelNextFrame = function() {
						cancelAnimationFrame(slowerFrameId);
					};
				}
			}
			*/
		}
	});

}());

/**
 * Some colors are predefined here as
 * a convenience. These match
 * corresponding classes in cmgame.css
 *
 * Color is capitalized here, as it is
 * planned to become a class in a
 * future iteration.
 */
CMGame.Color = {
	// colorscale / non-grayscale colors
	FUSCHIA: "rgb(253, 13, 136)",
	MAGENTA: "rgb(228, 0, 228)",
	PINK: "rgb(254, 3, 133)",
	RED: "rgb(250, 0, 92)",
	DARK_RED: "rgb(133, 33, 33)",

	ORANGE: "rgb(254, 137, 39)", // "rgb(247, 101, 3)"
	YELLOW: "rgb(255, 245, 10)",

	LIGHT_GREEN: "rgb(0, 240, 0)",
	GREEN: "rgb(0, 185, 0)",
	DARK_GREEN: "rgb(0, 136, 0)",

	SKY_BLUE: "rgb(142, 227, 252)",
	LIGHT_BLUE: "rgb(0, 250, 235)",
	BLUE: "rgb(1, 97, 251)",

	BLUE_GREEN: "rgb(0, 168, 153)",

	VIOLET: "rgb(185, 51, 158)",
	PURPLE: "rgb(128, 0, 128)", // 143, 41, 140

	BROWN: "rgb(121, 74, 25)",
	TAN: "rgb(242, 245, 235)", // sand-like

	// grayscale colors
	WHITE: "rgb(255, 255, 255)",
	ALMOST_WHITE: "rgb(250, 250, 250)", // material white
	BLACK: "rgb(0, 0, 0)",
	ALMOST_BLACK: "rgb(15, 23, 33)",
	GRAY: "rgb(158, 158, 158)",
	LIGHT_GRAY: "rgb(205, 205, 205)",
	DARK_GRAY: "rgb(58, 58, 58)",

	// translucent colors, e.g., for modal overlays
	TRANSLUCENT_WHITE: "rgba(255, 255, 255, 0.85)",
	TRANSLUCENT_BLACK: "rgba(0, 0, 0, 0.85)",

	// clear: dev should use this constant to be consistent (rather than, say, "transparent")
	TRANSPARENT: "rgba(0, 0, 0, 0)"
};

/**
 * A few standard fonts, as a convenience
 * This must be nonstatic in order to
 * use the context's current font size.
 *
 * Example usage:
 *
 * ctx.font = game.font.SANS_SERIF; // Sets font to Arial in current font size
 *
 */
Object.defineProperty(CMGame.prototype, "font", {

	/**
	 * Returns object of font strings
	 * @returns {object}
	 */
	get() {
		let self = this;
		let currentFontSize = this.offscreenCtx.font.match(/[0-9]+[A-Za-z]+/, "");
		if(currentFontSize) {
			currentFontSize = currentFontSize[0];
		}
		else {
			currentFontSize = "10px";
		}

		// Font relative to scaling example: ctx.font = game.font.rel(12) + "px Arial";
		return {
			rel: (pxForScale1) => pxForScale1 / self.screenScalar,
			MONO: `${currentFontSize} monospace`,
			SANS_SERIF: `${currentFontSize} Arial, sans-serif`,
			SERIF: `${currentFontSize} Times New Roman, serif`,
			VARIABLE: `italic ${currentFontSize} Times New Roman, serif`
		};
	}
});

(function() {
	let gsVal = 20;

	Object.defineProperty(CMGame.prototype, "graphScalar", {

		get() {
			return gsVal;
		},

		set(newVal) {
			let oldVal = gsVal;
			gsVal = newVal;
			for(let func of this.functions) {
				func.updateBoundsOnResize(oldVal);
			}
		}
	});
}());

/**
 * One reusable HTML element is used for
 * displaying brief "toast" messages to user.
 * This is a span with inline-block display,
 * centered in the top middle of the screen.
 */
if(!CMGame.toastElement) {
	CMGame.toastElement = document.createElement("span");
	CMGame.toastElement.setAttribute("id", "cmToast");
	CMGame.toastElement.classList.add("cm-toast");
	documentBodyElm.appendChild(CMGame.toastElement);

	// When a toast is shown, it fades to invisible after a few seconds, but then we need it to leave the HTML
	CMGame.toastElement.addEventListener("animationend", function() {
		CMGame.toastElement.style.display = "none";
	}, false);

	// Completely remove toast if it is covered by another element before animation completes
	CMGame.toastElement.addEventListener("animationcancel", function() {
		CMGame.toastElement.style.display = "none";
	}, false);
};

/**
 * Because of opacity/display animations,
 * the game's toast element can give inaccurate
 * size calculations when trying to center. To
 * account for this we store a clone, offscreen,
 * without visual animations, and use it for
 * our calculations.
 */
if(!CMGame.offscreenToastElement) {
	CMGame.offscreenToastElement = document.createElement("span");
	CMGame.offscreenToastElement.setAttribute("id", "cmOffscreenToast");
	CMGame.offscreenToastElement.classList.add("cm-toast");
	CMGame.offscreenToastElement.style.display = "inline-block";

	// Positive values here result in incorrect client rect values
	CMGame.offscreenToastElement.style.left = "-100vw";
	CMGame.offscreenToastElement.style.top = "-100vh";
	documentBodyElm.appendChild(CMGame.offscreenToastElement);
};

/**
 * Creates a toast message, showing briefly
 * @param {string} toastMessage - A text or HTML string to show in the toast
 * @param {number} [startDelay=0] - How long (ms) to wait before showing toast
 * @param {number|string} [duration="auto"] - How many milliseconds to show the toast - for
 *   convenience, the default automatically calculates a time based on string length
 * @param {function} [callback=CMGame.noop] - A function to perform after the toast completely fades
 */
CMGame.showToast = function(toastMessage, startDelay=0, duration="auto", callback=CMGame.noop) {
	CMGame.offscreenToastElement.innerHTML = toastMessage;
	CMGame.toastElement.innerHTML = toastMessage;

	// Get CSS animation duration in seconds
	let toastDuration;
	if(typeof duration === "number") {
		toastDuration = duration / 1000;
	}
	else {
		// Create duration, based roughly on number of words
		toastDuration = 2 +
			Math.ceil(.3 * toastMessage.split(/\s|(<br>)|(<br\/>)/).length);
	}

	// Add to the callback to make sure this event is removed
	let amendedCallback = function(e) {

		// As a static function, current game is not accessed. Instead we set `this` to the HTML message element
		callback.call(CMGame.toastElement, e);
		CMGame.toastElement.removeEventListener("animationend", amendedCallback, false);
	};

	CMGame.toastElement.addEventListener("animationend", amendedCallback, false);

	setTimeout(function() {
		let boundingRect = CMGame.offscreenToastElement.getBoundingClientRect();
		let widthStr = window.getComputedStyle(CMGame.offscreenToastElement).getPropertyValue("width").replace("px", "");
		let computedWidth = parseFloat(widthStr) || 0; // if "auto", "", etc., defaults to 0
		let assumedWidth = Math.max(boundingRect.right - boundingRect.left, computedWidth);

		CMGame.toastElement.style.opacity = "0";
		CMGame.toastElement.style.display = "none";
		CMGame.toastElement.style.left = `calc(50vw - ${.5 * assumedWidth}px)`;

		CMGame.toastElement.style.animationDuration =
				CMGame.toastElement.style.webkitAnimationDuration = `${toastDuration}s`;

		CMGame.toastElement.style.display = "inline-block";
	}, startDelay);
};

/**
 * Shows multiple toast messages, one at a time. Each
 * duration is automatically calculated based on message.
 * If you prefer to handle time calculations yourself, use
 * CMGame.showToast()
 * @param {string[]} toastMessages - The text (or HTML) to show in each toast
 * @param {number} [initialDelay=0] - Delay in ms before showing first toast
 */
CMGame.showToasts = function(toastMessages, initialDelay=0) {

	let nextStart = initialDelay;
	let nextDuration = 4000;

	for(let i = 0; i < toastMessages.length; i++) {

		// Create duration, based roughly on number of words
		nextDuration = 2000 +
			1000 *
			Math.ceil(.3 * toastMessages[i].split(/\s|(<br>)|(<br\/>)/).length);

		(function(idx, nextStart) {
			setTimeout(function() {
				CMGame.showToast(toastMessages[idx]);
			},
			nextStart);
		}(i, nextStart));

		// provide 1 second buffer between toasts, for animation to complete
		nextStart += nextDuration + 1000;
	}
};

/** Manages a foreground image game object */
CMGame.Sprite = class {
	/**
	 * Creates a CMGame.Sprite instance. These come in
	 * two general shapes - the standard "rect" bounding
	 * box, or "circle" which is useful for many math-based
	 * games (e.g., drawing a point, a graph theory vertex,
	 * or Venn diagram circle).
	 *
	 * @param {CMGame} game - The associated CMGame instance
	 * @param {number} x - The starting left value, or center x if circular
	 * @param {number} y - The starting top value, or center y if circular
	 * @param {number} widthOrRadius - The starting width value, or radius if circular
	 * @param {number|string} heightOrCircle - The starting height value, or "circle" if circular, or "line"
	 * @param {object|string|function} drawRule - An image or default color string or 
	 *   draw function (taking game's drawing context as its sole parameter). Default is null.
	 * @param {string} [boundingRule="none"] - How to handle collision with screen edge
	 *   "wraparound": object appears on other side of screen once completely off screen
	 *   "bounce": object bounces away from wall with same momentum
	 *   "clip": object is pushed back so that it just rests on the wall
	 *   "destroy": object is removed from game
	 *   "none": (default) object just keeps moving offscreen,
	 * @param {number} [layer=0] - A number than can be used to define the
	 *   order to draw sprites in a frame. Sprites with the same layer number
	 *   will be drawn in the order they were created. By default, all sprites have
	 *   layer 0, so are drawn in the order they were created. Negative numbers
	 *   are permitted as well, e.g., for background sprites.
	 * @param {boolean} omitFromSprites=false - true if you do not want engine to manage
	 *   (this is primarily for extended classes, like VennRegion)
	 */
	constructor(game, x, y, widthOrRadius, heightOrCircle, drawRule=null, boundingRule="none", layer=0, omitFromSprites=false) {

		this.game = game;
		this.x = x;
		this.y = y;

		// Do not override this - it is used with Object.defineProperty. Override boundingRule instead.
		this.boundingRulePrivate = boundingRule;

		this.boundingRuleTop = "none";
		this.boundingRuleRight = "none";
		this.boundingRuleBottom = "none";
		this.boundingRuleLeft = "none";

		this.boundingRule = boundingRule;

		this.shape;
		this.width;
		this.height;
		this.radius;

		if(heightOrCircle === "circle") {
			this.shape = "circle";
			this.radius = widthOrRadius;
			this.width = 2 * this.radius;
			this.height = 2 * this.radius;
		}
		else
		if(heightOrCircle === "line") {
			this.shape = "line";
			this.width = widthOrRadius;
			this.height = widthOrRadius;
			this.radius = 0;
			this.start = {
				x: x,
				y: y
			};

			this.end = {
				x: x + widthOrRadius,
				y: y
			};
		}
		else {
			this.shape = "rect";
			this.width = widthOrRadius;
			this.height = heightOrCircle;
			this.radius = Math.hypot(this.width, this.height); // i.e., the "diagonal"
		}

		this.image = null;
		this.fillStyle = "black";

		if(typeof drawRule === "string") {
			this.fillStyle = drawRule;
		}
		else
		if(drawRule instanceof CMImageLoad) {
			this.image = drawRule;	
		}
		else
		if(typeof drawRule === "function") {
			this.draw = drawRule.bind(this);
		}

		this.velocity = new CMPoint();
		this.acceleration = new CMPoint();

		this.onupdate = CMGame.noop;
		this.ondraw = CMGame.noop;

		this.layer = layer;

		/**
		// @deprecated Use addSprite() instead
		if(!omitFromSprites) {
			this.game.sprites.push(this);
			this.game.sprites.sort((a, b) => a.layer - b.layer);
		}
		*/

		this.onscreen = false;		
		if(this.x > this.game.width ||
				this.y > this.game.height ||
				this.x + this.width < 0 ||
				this.y + this.height < 0) {
			this.onscreen = false;
		}
		else {
			this.onscreen = true;
		}

		this.pathFunction = null;
		this.hitbox = null;

		let self = this;

		/**
		 * Since a sprite's hitbox will be constantly changing,
		 * we will only update it when necessary, e.g., when
		 * performing collision checks.
		 */
		(function() {

			let hb = null;
			Object.defineProperty(self, "hitbox", {

				/**
				 * Sets the hitbox to a custom object or function
				 * @param {object|function} newBox - An object with x, y, width, and height properties,
				 *   or a function that returns such an object
				 */
				set(newBox) {
					hb = newBox;
				},

				/**
				 * Returns sprite's current collision box ("hitbox")
				 * @returns {object}
				 */
				get() {
					switch(typeof hb) {
						case "function":
							return hb.call(self);
						case "object":
							return hb;
						default:
							return this;
					}
				}
			});

		}());
	}

	/**
	 * Removes this sprite from current game
	 * @deprecated - use game.removeSprite instead
	 */
	destroy() {
		this.game.sprites
				.splice(this.game.sprites.indexOf(this), 1);
	}

	/**
	 * Sets the sprite's current movement path.
	 * @param {function|array|object} newPath - If a CMGame.Function, this will be invoked
	 *   on each update to determine sprite's movement. If an object, this sprite's
	 *   velocity will be set to that object's x, y, z values (setting any undefined to 0).
	 *   If an array, sprite's velocity x, y, z values will be set to the array's first,
	 *   second, and third index, respectively.
	 */
	setPath(newPath) {
		if(newPath instanceof CMGame.Function) {
			this.pathFunction = newPath;
			this.pathFunction.animationTime = 0;
			this.pathFunction.velocity.animationTime = 1;
		}
		else
		if(Array.isArray(newPath)) {
			this.velocity.x = newPath[0];
			this.velocity.y = newPath[1];
			this.velocity.z = newPath[2] || 0;
			this.pathFunction = null;
		}
		else { // object, just setting velocities
			this.velocity.x = newPath.x || 0;
			this.velocity.y = newPath.y || 0;
			this.velocity.z = newPath.z || 0;
			this.pathFunction = null;
		}
	}

	/**
	 * Updates the sprite for one animation cycle,
	 * moving it and bounding if necessary
	 */
	update() {
		if(this.pathFunction instanceof CMGame.Function) {
			this.pathFunction.update();

			switch(this.pathFunction.type) {
				case "xofy":
					this.y = this.game.yToScreen(this.pathFunction.end.y);
					this.x = this.game.xToScreen(this.pathFunction.of(this.pathFunction.end.y));
					break;
				case "polar":
					let cartPoint = this.game.fromPolar(
						this.pathFunction.of(this.pathFunction.end.theta), // r
						this.pathFunction.end.theta
					);
					this.x = this.game.xToScreen(cartPoint.x);
					this.y = this.game.yToScreen(cartPoint.y);
					break;
				case "parametric":
					let funcPoint = this.pathFunction.of( this.pathFunction.end.t );

					this.x = this.game.xToScreen( funcPoint.x );
					this.y = this.game.yToScreen( funcPoint.y );
					break;
				case "cartesian":
					default:
					this.x = this.game.xToScreen(this.pathFunction.end.x);
					this.y = this.game.yToScreen(this.pathFunction.of(this.pathFunction.end.x));
					break;
			}

			// Sprite's "center" point is what follows the path
			this.x -= .5 * this.width;
			this.y -= .5 * this.height;
		}
		else {
			this.velocity.x += this.acceleration.x;
			this.velocity.y += this.acceleration.y;

			if(this.velocity.z && this.acceleration.z) {
				this.velocity.z += this.acceleration.z;
			}

			this.x += this.velocity.x;
			this.y += this.velocity.y;

			if(this.velocity.z) {
				this.z += this.velocity.z;
			}
		}

		if(this.shape === "rect") {
			this.boundAsRect();
		}
		else
		if(this.shape === "line") {
			this.boundAsLine();
		}
		else {
			this.boundAsCircle();
		}

		this.onupdate();
	}

	/**
	 * Manages screen boundaries for "line" shape,
	 * in a simple form, by considering the rectangle
	 * enclosing the line, and bounding it as a rect.
	 */
	boundAsLine() {

		let boundingRect = {
			x: Math.min(this.start.x, this.end.x),
			y: Math.min(this.start.y, this.end.y),
			width: Math.abs(this.end.x - this.start.x),
			height: Math.abs(this.end.y - this.start.y)
		};

		this.boundAsRect(boundingRect);
	}

	/** Manages screen boundaries for "circle" shape */
	boundAsCircle() {
		if(this.x <= this.radius) { // left wall		
			switch(this.boundingRuleLeft) {
				case "wraparound":
					if(this.x <= -this.radius)
						this.x = this.game.width + this.radius;
					break;
				case "bounce":
					this.x = this.radius;
					this.velocity.x = Math.abs(this.velocity.x);
					break;
				case "clip":
					this.x = this.radius;
					break;
				case "destroy":
					if(this.x < this.radius)
						this.destroy();
					break;
				case "none":
					break;
				default:
					if(typeof this.boundingRuleLeft === "function") {
						this.boundingRuleLeft.call(this);
					}
					break;
			}
		}
		else
		if(this.x + this.radius >= this.game.width) { // right wall		
			switch(this.boundingRuleRight) {
				case "wraparound":
					if(this.x - this.radius >= this.game.width)
						this.x = -this.radius;
					break;
				case "bounce":
					this.x = this.game.width - this.radius;
					this.velocity.x = -Math.abs(this.velocity.x);
					break;
				case "clip":
					this.x = this.game.width - this.radius;
					break;
				case "destroy":
					if(this.x - this.radius > this.game.width)
						this.destroy();
					break;
				case "none":
					break;
				default:
					if(typeof this.boundingRuleRight === "function") {
						this.boundingRuleRight.call(this);
					}
					break;
			}
		}
		else
		if(this.y - this.radius <= 0) { // top wall
			switch(this.boundingRuleTop) {
				case "wraparound":
					if(this.y + this.radius <= 0)
						this.y = this.game.height + this.radius;
					break;
				case "bounce":
					this.y = this.radius;
					this.velocity.y = Math.abs(this.velocity.y);
					break;
				case "clip":
					this.y = this.radius;
					break;
				case "destroy":
					if(this.y + this.radius < 0)
						this.destroy();
					break;
				case "none":
					break;
				default:
					if(typeof this.boundingRuleTop === "function") {
						this.boundingRuleTop.call(this);
					}
					break;
			}
		}
		else
		if(this.y + this.radius >= this.game.height) { // bottom wall
			switch(this.boundingRuleBottom) {
				case "wraparound":
					if(this.y - this.radius >= this.game.height)
						this.y = -this.radius;
					break;
				case "bounce":
					this.y = this.game.height - this.radius;
					this.velocity.y = -Math.abs(this.velocity.y);
					break;
				case "clip":
					this.y = this.game.height - this.radius;
					break;
				case "destroy":
					if(this.y - this.radius > this.game.height)
						this.destroy();
					break;
				case "none":
					break;
				default:
					if(typeof this.boundingRuleBottom === "function") {
						this.boundingRuleBottom.call(this);
					}
					break;
			}
		}

		if(this.x - this.radius > this.game.width ||
				this.y - this.radius > this.game.height ||
				this.x + this.radius < 0 ||
				this.y + this.radius < 0) {
			this.onscreen = false;
		}
		else {
			this.onscreen = true;
		}
	}

	/**
	 * Manages screen boundaries for "rect" shape sprite.
	 * @param {object} [boundingRect=this] - A custom "rectangle" used as a "hit box"
	 */
	boundAsRect(boundingRect=this) {

		if(boundingRect.x <= 0) { // left wall
			switch(this.boundingRuleLeft) {
				case "wraparound":
					if(boundingRect.x + boundingRect.width <= 0)
						boundingRect.x = this.game.width;
					break;
				case "bounce":
					boundingRect.x = 0;
					this.velocity.x = Math.abs(this.velocity.x);
					break;
				case "clip":
					boundingRect.x = 0;
					break;
				case "destroy":
					if(boundingRect.x + boundingRect.width < 0)
						this.destroy();
					break;
				case "none":
					break;
				default:
					if(typeof this.boundingRuleLeft === "function") {
						this.boundingRuleLeft.call(this);
					}
					break;
			}
		}
		else
		if(boundingRect.x + boundingRect.width >= this.game.width) { // right wall
			switch(this.boundingRuleRight) {
				case "wraparound":
					if(boundingRect.x >= this.game.width)
						boundingRect.x = 0;
					break;
				case "bounce":
					boundingRect.x = this.game.width - boundingRect.width;
					this.velocity.x = -Math.abs(this.velocity.x);
					break;
				case "clip":
					boundingRect.x = this.game.width - boundingRect.width;
					break;
				case "destroy":
					if(boundingRect.x > this.game.width)
						this.destroy();
					break;
				case "none":
					break;
				default:
					if(typeof this.boundingRuleRight === "function") {
						this.boundingRuleRight.call(this);
					}
					break;
			}
		}
		else
		if(boundingRect.y <= 0) { // top wall
			switch(this.boundingRuleTop) {
				case "wraparound":
					if(boundingRect.y + boundingRect.height <= 0)
						boundingRect.y = this.game.height;
					break;
				case "bounce":
					boundingRect.y = 0;
					this.velocity.y = Math.abs(this.velocity.y);
					break;
				case "clip":
					boundingRect.y = 0;
					break;
				case "destroy":
					if(boundingRect.y + boundingRect.height < 0)
						this.destroy();
					break;
				case "none":
					break;
				default:
					if(typeof this.boundingRuleTop === "function") {
						this.boundingRuleTop.call(this);
					}
					break;
			}
		}
		else
		if(boundingRect.y + boundingRect.height >= this.game.height) { // bottom wall
			switch(this.boundingRuleBottom) {
				case "wraparound":
					if(boundingRect.y >= this.game.height)
						boundingRect.y = 0;
					break;
				case "bounce":
					boundingRect.y = this.game.height - boundingRect.height;
					this.velocity.y = -Math.abs(this.velocity.y);
					break;
				case "clip":
					boundingRect.y = this.game.height - boundingRect.height;
					break;
				case "destroy":
					if(boundingRect.y > this.game.height)
						this.destroy();
					break;
				case "none":
					break;
				default:
					if(typeof this.boundingRuleBottom === "function") {
						this.boundingRuleBottom.call(this);
					}
					break;
			}
		}

		if(this.x > this.game.width ||
				this.y > this.game.height ||
				this.x + this.width < 0 ||
				this.y + this.height < 0) {
			this.onscreen = false;
		}
		else {
			this.onscreen = true;
		}
	}

	/**
	 * Draws sprite's image or rectangular placeholder for the sprite
	 * Can be overridden in constructor's drawRule
	 * @param {CanvasRenderingContext2D} ctx - The drawing context
	 */
	draw(ctx) {
		// We will often want to show the graph "trail"
		if(this.pathFunction instanceof CMGame.Function) {
			this.pathFunction.draw(ctx);
		}

		if(this.image) {
			ctx.drawImage(this.image, this.x, this.y, this.width, this.height);
		}
		else
		if(this.shape === "circle") {
			ctx.fillStyle = this.fillStyle;
			this.game.fillOval(this.x, this.y, this.radius);
		}
		else
		if(this.shape === "line") {
			ctx.lineWidth = this.width;
			this.game.drawLine(this.start, this.end);
		}
		else { // "rect"
			ctx.fillStyle = this.fillStyle;
			ctx.fillRect(this.x, this.y, this.width, this.height);
		}

		this.ondraw(ctx);
	}

	/**
	 * Determines if a given point is on this
	 * object. Useful for player interaction
	 * via mouse clicks or touch points.
	 * @param {object|number} The point, or point's x value
	 * @param {number} The point's y value
	 * @returns {boolean}
	 */
	containsPoint(pointOrX, y) {
		let pointToCheck = null;

		if(typeof pointOrX === "number") {
			pointToCheck = {
				x: pointOrX,
				y: y
			};
		}
		else { // single point
			pointToCheck = pointOrX;
		}

		if(this.shape === "circle") {
			return this.game.distance(this, pointToCheck) <= this.radius;
		}
		if(this.shape === "line") { // e.g., for CMEdge
			this.game.ctx.lineWidth = this.width;
			return this.game.ctx.isPointInStroke(this.path, pointToCheck.x, pointToCheck.y);
		}
		else { // "rect"
			return this.game.areColliding(this,
				{x: pointToCheck.x, y: pointToCheck.y, width: 1, height: 1});
		}
	}
}

/**
 * Define the sprite's center as an accessor
 * so it does not need to update until needed.
 * Especially useful if sprite's size is animated.
 */
Object.defineProperty(CMGame.Sprite.prototype, "center", {

	/**
	 * Gets sprite's center point.
	 * Obvious when sprite is "circle", so
	 * primarily used for "rect"
	 * @returns {Point}
	 */
	get() {
		if(this.shape === "rect") {
			return new CMPoint(
				this.x + .5 * this.width,
				this.y + .5 * this.height
			);
		}
		else
		if(this.shape === "line") {
			return CMGame.midpoint(this.start, this.end);
		}
		else { // "circle"
			return new CMPoint(
				this.x,
				this.y
			);
		}
	}
});

/**
 * Because the bounding rules on the 4 sides of
 * the screen can be decided by a single value,
 * we must set them each any time that one
 * value is set.
 */
Object.defineProperty(CMGame.Sprite.prototype, "boundingRule", {

	get() {
		return this.boundingRulePrivate;
	},

	set(newRule) {
		this.boundingRulePrivate = newRule;

		if(Array.isArray(newRule)) {
			[this.boundingRuleTop, this.boundingRuleRight,
				this.boundingRuleBottom, this.boundingRuleLeft] = newRule;
		}
		else {
			[this.boundingRuleTop, this.boundingRuleRight,
				this.boundingRuleBottom, this.boundingRuleLeft] = new Array(4).fill(newRule);
		}
	}
});

/**
 * Get n! ("n factorial") value for a given integer n
 * @param {number} n - The nonnegative integer input
 * @returns {number}
 */
CMGame.factorial = (n) => {
	let prod = 1; // Note: 0! is defined to be 1

	for(let i = 1; i <= n; i++) {
		prod *= i;
	}

	return prod;
};

/**
 * Get C(n, r) ("n choose r") value for a given n
 * @param {number} n - The number of elements to "permute" from
 * @param {number} r - The number of elements to permute
 * @returns {number}
 */
CMGame.P = (n, r) => {
	let quotient = CMGame.factorial(n) /
		(CMGame.factorial(n- r));

	return quotient;
};

/**
 * Get C(n, r) ("n choose r") value for a given n
 * @param {number} n - The number of elements to "choose" from
 * @param {number} r - The number of elements to choose
 * @returns {number}
 */
CMGame.C = (n, r) => {
	let quotient = CMGame.factorial(n) /
		(CMGame.factorial(r) * CMGame.factorial(n- r));

	return quotient;
};

(function() {

	/**
	 * Adds together a list of numbers;
	 * helper function for CMGame.sum
	 */
	let sumNumbers = function(... args) {
		return args.reduce((previous, current) => {
			return previous + current;
		});
	};

	/**
	 * Sum up a list of numbers, provided as all
	 * the arguments, or add up a sigma sum
	 * between the given indices.
	 * @param {function|number} func - The sigma sum formula to use
	 */
	CMGame.sum = function(func, k=0, n=0) {
		if(typeof func !== "function") {
			// Assume all arguments are numbers if first one is
			return sumNumbers(...arguments);
		}

		let partialSum = 0;
		let nextSummand = func(k);
		let nextPartial = partialSum+ nextSummand;

		if(Number.isFinite(n)) {
			for(let i = k; i <= n; i++) {
				partialSum += func(i);
			}
		}
		else {
			// If n is Infinity, we assume this is a series. Continue while additions are still significant.
			try {
				for(let i = k; i <= n && nextPartial < Number.EPSILON; i++) {
					partialSum += nextSummand; // Add amount calculated from previous iteration
					nextSummand = func(i + 1);
					nextPartial = partialSum + nextSummand;
				}
			} catch(/* Maximum call stack size exceeded error */ e) {
				/**
				 * Stack overflow due to loop not stopping - 
				 * return undefined, let dev decide what that means
				 * e.g., could be Infinity, -Infinity, or may oscillate
				 */
				return;
			}
		}

		return partialSum;
	};

} ());

/**
 * Gets the mean average of a list of numbers.
 * Useful, e.g., for finding center points
 * @returns {number}
 */
CMGame.mean = (...args) => {
	return CMGame.sum(...args) / args.length;
};

/**
 * Gets the point at the center of the line
 * connecting two points
 * @param {object} p1 - The first point (or object with x, y values)
 * @param {object} p2 - The second point (or object with x, y values)
 * @returns {object}
 */
CMGame.midpoint = (p1, p2) => {
	return new Point(
		CMGame.mean(p1.x, p2.x),
		CMGame.mean(p1.y, p2.y));
};

/** Class to manage drawable functions */
CMGame.Function = class {

	/**
	 * Creates a CMGame.Function instance.
	 *
	 * @param {CMGame} game - The associated CMGame instance
	 * @param {function} func - A single input function defining the graph.
	 *   The default assumption is a standard Cartesian "return y as a function
	 *   of x" function, but other options can be set in options.type.
	 *
	 * @param {object} [opts] - An object of options
	 * @param {string} [opts.type="cartesian"] "cartesian" (default), "polar", "parametric", "xofy" (sideways)
	 *   "cartesian" is standard. func should take a single input (x) and return single output (y)
	 *   "yofox" is essentially Cartesian along y-axis, instead of x. func should take a single
	 *      input (y) and return single output (x)
	 *   "polar" is polar coordinates. func should take a single input (theta) and return single output (r)
	 *   "parametric" is based on an extra parameter (t). func should take a single input (t) and
	 *      return a point with an x value and a y value, e.g., func = (t) => {x: t**2, y: Math.cos(t)}
	 * @param {string} [opts.strokeStyle] color for the graph curve
	 * @param {string} [opts.fillStyleBelow] color for area below graph curve
	 * @param {string} [opts.fillStyleAbove] color for area above graph curve
	 * @param {string} [opts.lineWidth] line width for the graph curve
	 * @param {string} [opts.name] Convenience, e.g., for drawing name to screen
	 * @param {boolean} [opts.static] true if you know the graph will not change
	 * @param {object} [opts.start] Object defining real number start values for x, t, etc.
	 * @param {object} [opts.end] Object defining real number end values for x, t, etc.
	 * @param {object} [opts.velocity] Object defining quantity to change values per frame
	 * @param {function} [opts.onupdate] A callback called after
	 *   update(). Take game's frameCount as only parameter
	 * @param {function} [opts.ondraw] A callback called after
	 *   draw(). Takes game's drawing context as only parameter
	 */
	constructor(game, func, opts={}) {
		this.game = game;
		this.type = opts.type || "cartesian";
		this.lineWidth = opts.lineWidth || 1;

		this.of = func; // e.g., if you name this function f, then f.of(2) is similar to f(2)
		this.scaledOf = null; // A function shifting and scaling given function to the screen

		this.tStep = 0;
		this.thetaStep = 0;

		this.strokeStyle = opts.strokeStyle || CMGame.Color.DARK_GRAY;
		this.fillStyleBelow = opts.fillStyleBelow;
		this.fillStyleAbove = opts.fillStyleAbove;
		this.name = opts.name || "";

		if(typeof opts.color !== "undefined") {
			console.warn("\"color\" is not a valid option for CMGame.Function. Use \"strokeStyle\" instead.");
		}

		this.animationTime = 0;
		this.start = {
			t: 0,
			x: -(this.game.origin.x / this.game.graphScalar),
			y: -((this.game.height - this.game.origin.y) / this.game.graphScalar),
			r: 0,
			theta: 0
		};

		if(!opts.start) {
			opts.start = {};
		}
		
		for(let key in opts.start) {
			this.start[key] = opts.start[key];
		}

		this.end = {
			t: 0,
			x: ((this.game.width - this.game.origin.x) / this.game.graphScalar),
			y: (game.origin.y / game.graphScalar),
			r: 0,
			theta: Math.TAU
		};

		if(!opts.end) {
			opts.end = {};
		}

		for(let key in opts.end) {
			this.end[key] = opts.end[key];
		}

		this.velocity = {
			/**
			// There is currently no need for these values...
			t: 0,
			x: 0,
			y: 0,
			r: 0,
			theta: 0,
			*/

			animationTime: 0, // If not animated, no need to build this variable

			start: {t: 0, x: 0, y: 0, r: 0, theta: 0},
			end: {t: 0, x: 0, y: 0, r: 0, theta: 0}
		};

		if(!opts.velocity) {
			opts.velocity = {};
		}

		// Let dev define some variables, without setting other keys to undefined
		for(let key in opts.velocity) {
			if(key === "start" || key === "end") {
				for(let keyInEndpoint in opts.velocity[key]) {
					this.velocity[key][keyInEndpoint] = opts.velocity[key][keyInEndpoint];
				}
			}
			else
				this.velocity[key] = opts.velocity[key];
		}

		this.onupdate = opts.onupdate || CMGame.noop;
		this.ondraw = opts.ondraw || CMGame.noop;

		this.path = new Path2D();

		// Path2D instances stored for "filling in" colors above/below graph
		this.pathAbove = null;
		this.pathBelow = null;

		let self = this;
		this.valsArray = null;
		this.static = !!opts.static;

		/**
		// @todo Set up `static` instances to use arrays, as an optimization
		if(this.static) {

			// For a function without values changing, we can store the values once
			switch(self.type) {
				case "xofy":
					self.valsArray = new Array(self.game.height - 0)
						.fill(0)
						.map((element, idx, fullArr) => idx)
						.map(y => self.of( self.game.xToReal( y ) ) );
					break;
				case "polar":
					self.valsArray = new Array(360 - 0)
						.fill(0)
						.map((element, idx, fullArr) => idx)
						.map(theta => self.of( theta ) );
					break;
				case "parametric":
					self.valsArray = new Array(self.end.t - self.start.t)
						.fill(0)
						.map((element, idx, fullArr) => idx)
						.map(t => self.of( t ) );
					break;
				case "cartesian":
				default:
					
					// self.valsArray = new Array(self.game.graphScalar * (self.end.x - self.start.x))
						// .map((element, idx, fullArr)=>idx)
						// .map(idx=>self.of( self.start.x + idx ));

					self.valsArray = new Array(self.game.width - 0)
						.fill(0)
						.map((element, idx, fullArr) => idx)
						.map(x => self.of( self.game.xToReal( x ) ) );
					break;
			}

			this.of = function(x) {
				return self.valsArray[x];
			};
		}
		*/

		switch(this.type) {
			case "xofy":
				self.scaledOf = function(y) { return game.xToScreen(self.of(y)); };
				break;
			case "polar":
				self.thetaStep = typeof opts.thetaStep === "number" ? opts.thetaStep : (Math.TAU / 360);
				self.scaledOf = function(theta) {
					return self.of(theta) * self.game.graphScalar;
				};
				break;
			case "parametric":
				self.tStep = typeof opts.tStep === "number" ? opts.tStep : 0.1;
				self.scaledOf = function(t) {
					let xyFromParam = self.of(t);

					return {
						x: game.xToScreen(xyFromParam.x),
						y: game.yToScreen(xyFromParam.y)
					};
				};
				break;
			case "cartesian":
			default:
				self.scaledOf = function(x) { return game.yToScreen(self.of(x)); };
				break;
		}

		this.scaledValsArray = null;

		if(this.static) {
			// @todo Set up `static` instances to use arrays, as an optimization

			/*
			// Basic setup - Note: these assume the graph crosses entire screen
			// this.scaledValsArray = new Array(640)
			//   .map({element, idx, fullArr}=>idx)
			//   .map(x=>this.scaledOf(x));

			// For a function without values changing, we can store the values once
			switch(this.type) {
				case "xofy":
					self.scaledValsArray = new Array(self.game.height - 0)
						.fill(0)
						.map((element, idx, fullArr) => idx)
						.map(y => self.scaledOf( self.game.xToReal( y ) ) );
					break;
				case "polar":
					self.scaledValsArray = new Array(360 - 0)
						.fill(0)
						.map((element, idx, fullArr) => idx)
						.map(theta => self.scaledOf( theta ) );
					break;
				case "parametric":
					self.scaledValsArray = new Array(self.end.t - self.start.t)
						.fill(0)
						.map((element, idx, fullArr) => idx)
						.map(t => self.scaledOf( t ) );
					break;
				case "cartesian":
				default:
					self.scaledValsArray = new Array(self.game.width - 0)
						.fill(0)
						.map((element, idx, fullArr) => idx)
						.map(x => self.scaledOf( x ) );
					break;
			}
			*/

			// function(x) { return game.yToScreen(self.of(x)); };

			// this.scaledValsArray = this.valsArray.map(val => game.yToScreen(self.of(x)) );

			//	Not quite... self.of(x) here is going from 0 to 640, but we need it to go from xToReal...
			/*
			self.scaledValsArray = new Array(self.game.width - 0)
						.fill(0)
						.map((element, idx, fullArr) => idx)
						.map(screenX => game.yToScreen(self.of( game.xToReal( screenX ) )) );

			this.scaledOf = function(input) {
				return self.scaledValsArray[input];
			};
			*/

			this.buildGraphPath(this.game.ctx);
			this.draw = this.drawGraphPath;
		}

		// Information stored for checking point positions later
		this.continuous = true;
	}

	/**
	 * Redefines graph bounds to current screen,
	 * in particular when graphScalar is changed
	 * dynamically - only really affects Cartesian
	 * graphs, as they tend to the screen
	 * boundaries. For simplicity, this is only
	 * invoked on "zoom out".
	 * Mostly used internally.
	 * @param {number} oldScalar - graphScalar before the change
	 */
	updateBoundsOnResize(oldScalar) {
		if(this.game.origin.x - (oldScalar * this.start.x) === 0) {
			this.start.x = -(this.game.origin.x / this.game.graphScalar);
		}

		if(this.game.origin.x + (oldScalar * this.end.x) === this.game.canvas.width) {
			this.end.x = ((this.game.width - this.game.origin.x) / this.game.graphScalar);
		}

		if(this.game.origin.y - oldScalar * this.start.y === 0) {
			this.start.y = -((this.game.height - this.game.origin.y) / this.game.graphScalar);
		}

		if(this.game.origin.y - oldScalar * this.end.y === this.game.canvas.height) {
			this.end.y = (this.game.origin.y / this.game.graphScalar);
		}
	}

	/**
	 * For optimization, prebuilds the drawing path
	 * when dev knows it will not change. (options.static=true)
	 * @param {CanvasRenderingContext2D} ctx - The game's drawing context
	 */
	buildGraphPath(ctx) {
		let game = this.game;
		let canvas = game.canvas;
		// Note: using ctx.canvas will not account for devicePixelRatio
		// let canvas = ctx.canvas;

		let initialI;
		let finalI;
		let initialScreenRealX;
		let initialScreenRealY;
		let initialPoint;

		this.path = new Path2D();

		switch(this.type) {
			case "cartesian":
				// Set up endpoints, bounding horizontally within visible canvas (to optimize)
				initialI = Math.max(0, this.game.xToScreen( this.start.x ) );
				initialScreenRealX = (initialI - game.origin.x) / game.graphScalar;
				finalI = Math.min(canvas.width, this.game.xToScreen( this.end.x) );

				this.path.moveTo(initialI, this.scaledOf( initialScreenRealX ) );

				for(let i = initialI + 1; i <= finalI; i++) {

					let screenGraphX = (i - game.origin.x) / game.graphScalar;
					let screenGraphXMinus1 = (i - 1 - game.origin.x) / game.graphScalar;

					// Don't connect over vertical asymptotes
					if(
						(this.scaledOf(screenGraphX) < 0 && this.scaledOf(screenGraphXMinus1) > canvas.height) ||
						(this.scaledOf(screenGraphXMinus1) < 0 && this.scaledOf(screenGraphX) > canvas.height)) {

						this.continuous = false;
						this.path.moveTo(i, this.scaledOf(screenGraphX) );
					}
					else {
						this.path.lineTo(i, this.scaledOf(screenGraphX) );
					}
				}

				if(this.fillStyleBelow && this.fillStyleBelow !== CMGame.Color.TRANSPARENT) {
					this.pathBelow = new Path2D(this.path);
					this.pathBelow.lineTo(finalI, canvas.height + ctx.lineWidth);
					this.pathBelow.lineTo(canvas.width, canvas.height + ctx.lineWidth);
					this.pathBelow.lineTo(initialI, canvas.height + ctx.lineWidth);
					this.pathBelow.closePath();
				}

				if(this.fillStyleAbove && this.fillStyleAbove !== CMGame.Color.TRANSPARENT) {
					this.pathAbove = new Path2D(this.path);
					this.pathAbove.lineTo(finalI, 0 - ctx.lineWidth);
					this.pathAbove.lineTo(initialI, 0 - ctx.lineWidth);
					this.pathAbove.closePath();
				}
				break;
			case "xofy":
				/**
				 * Graph path moves up y-axis, starting at game.height,
				 * but we allow our index to move from 0 to game.height
				 * and subtract from game.height when drawing the path
				 */
				initialI = Math.max(0, game.height - game.yToScreen( this.start.y ) );
				initialScreenRealY = (initialI - game.origin.y) / game.graphScalar;
				finalI = Math.min(game.height, game.height - game.yToScreen( this.end.y) );

				this.path.moveTo(this.scaledOf( initialScreenRealY ), game.height - initialI);

				for(let i = initialI + 1; i <= finalI; i++) {

					let screenGraphY = -((game.height - i) - game.origin.y) / game.graphScalar;
					let screenGraphYMinus1 = -(game.origin.y - (i - 1)) / game.graphScalar;

					// Don't connect over horizontal asymptotes
					if(
						(this.scaledOf(screenGraphY) < 0 && this.scaledOf(screenGraphYMinus1) > canvas.width) ||
						(this.scaledOf(screenGraphYMinus1) < 0 && this.scaledOf(screenGraphY) > canvas.width)) {

						this.continuous = false;
						this.path.moveTo(this.scaledOf(screenGraphY), game.height - i );
					}
					else {
						this.path.lineTo(this.scaledOf(screenGraphY), game.height - i);
					}
				}

				if(this.fillStyleBelow && this.fillStyleBelow !== CMGame.Color.TRANSPARENT) {
					this.pathBelow = new Path2D(this.path);
					this.pathBelow.lineTo(-ctx.lineWidth, game.height - finalI);
					this.pathBelow.lineTo(-ctx.lineWidth, game.height - initialI);
					this.pathBelow.closePath();
				}

				if(this.fillStyleAbove && this.fillStyleAbove !== CMGame.Color.TRANSPARENT) {
					this.pathAbove = new Path2D(this.path);
					this.pathAbove.lineTo(canvas.width + ctx.lineWidth, game.height - finalI);
					this.pathAbove.lineTo(canvas.width + ctx.lineWidth, game.height - initialI);
					this.pathAbove.closePath();
				}
				break;
			case "polar":
				initialPoint = game.fromPolar({
						r: this.scaledOf(0),
						theta: 0
					});

				this.path.moveTo(game.origin.x + initialPoint.x, game.origin.y - initialPoint.y);
				for(let th = this.thetaStep; th <= Math.TAU; th += this.thetaStep) {

					let point = game.fromPolar(
						{
							r: this.scaledOf(th),
							theta: th
						});

					this.path.lineTo( game.origin.x + point.x, game.origin.y - point.y);
				}

				if(this.fillStyleBelow && this.fillStyleBelow !== CMGame.Color.TRANSPARENT) {
					this.pathBelow = new Path2D(this.path);
					this.pathBelow.closePath(); // if necessary
				}

				// Attempt to fill area outside the path. Note: may not work as expected if polar path is not closed
				if(this.fillStyleAbove && this.fillStyleAbove !== CMGame.Color.TRANSPARENT) {
					this.pathAbove = new Path2D(this.path);

					this.pathAbove.moveTo(game.width + ctx.lineWidth, game.origin.y - initialPoint.y); // right wall
					this.pathAbove.lineTo(game.width + ctx.lineWidth, game.height + ctx.lineWidth); // bottom right corner
					this.pathAbove.lineTo(0 - ctx.lineWidth, game.height + ctx.lineWidth);
					this.pathAbove.lineTo(0 - ctx.lineWidth, 0 - ctx.lineWidth);
					this.pathAbove.lineTo(game.width + ctx.lineWidth, 0 - ctx.lineWidth);
					this.pathAbove.lineTo(game.width + ctx.lineWidth, game.origin.y - initialPoint.y);
				}
				break;
			case "parametric":
				initialPoint = this.scaledOf(0);
				this.path.moveTo(initialPoint.x, initialPoint.y);

				// If no end has been provided, there is nothing to draw (no time elapses)
				for(let tIndex = this.tStep; tIndex < this.end.t; tIndex += this.tStep) {
					let point = this.scaledOf(tIndex);
					this.path.lineTo( point.x, point.y);
				}
				break;
		}		
	}

	/**
	 * Draws static graph in current frame, using a
	 * stored Path2D. If this CMGame.Function instance
	 * is static, this function replaces the draw() method
	 * as an optimization.
	 * @param {CanvasRenderingContext2D} ctx - The game's drawing context
	 */
	drawGraphPath(ctx=this.game.offscreenCtx) {
		if(this.pathBelow) {
			ctx.fillStyle = this.fillStyleBelow;
			ctx.fill(this.pathBelow);
		}

		if(this.pathAbove) {
			ctx.fillStyle = this.fillStyleAbove;
			ctx.fill(this.pathAbove);
		}

		ctx.lineWidth = this.lineWidth;
		ctx.strokeStyle = this.strokeStyle;
		ctx.stroke(this.path);

		this.ondraw(ctx);
	}

	/**
	 * Updates graph animation state in current
	 * frame, if relevant
	 * @param {number} frameCount - The game's frame count
	 */
	update(frameCount) {
		for(let key in this.velocity) {
			if(key === "start" || key === "end") {
				for(let keyInEndpoint in this.velocity[key]) {
					this[key][keyInEndpoint] += this.velocity[key][keyInEndpoint];
				}
			}
			else
				this[key] += this.velocity[key];
		}

		this.onupdate(frameCount);
	}

	/**
	 * Delegates drawing function based on graph type
	 * @param {object} ctx - The drawing context
	 */
	draw(ctx) {
		switch(this.type) {
			case "cartesian":
				return this.drawCartesian(ctx);
			case "polar":
				return this.drawPolar(ctx);
			case "parametric":
				return this.drawParametric(ctx);
			case "xofy":
				return this.drawXOfY(ctx);
		}

		this.ondraw(ctx);
	}

	/**
	 * Draws as a polar function
	 * @param {object} ctx - The drawing context
	 */
	drawPolar(ctx) {
		let game = this.game;
		let canvas = game.canvas;
		// Note: using ctx.canvas is offscreen, so dimensions are scaled up for devicePixelRatio

		let initialPoint = game.fromPolar({
				r: this.scaledOf(0),
				theta: 0
			});

		this.path = new Path2D();
		this.path.moveTo(game.origin.x + initialPoint.x, game.origin.y - initialPoint.y);
		for(let th = this.thetaStep; th <= Math.TAU; th += this.thetaStep) {

			let point = game.fromPolar(
				{
					r: this.scaledOf(th),
					theta: th
				});

			this.path.lineTo( game.origin.x + point.x, game.origin.y - point.y);
		}

		if(this.fillStyleBelow && this.fillStyleBelow !== CMGame.Color.TRANSPARENT) {
			this.pathBelow = new Path2D(this.path);
			this.pathBelow.closePath(); // if necessary
			ctx.fillStyle = this.fillStyleBelow;
			ctx.fill(this.pathBelow);
		}

		// Attempt to fill area outside the path. Note: may not work as expected if polar path is not closed
		if(this.fillStyleAbove && this.fillStyleAbove !== CMGame.Color.TRANSPARENT) {
			this.pathAbove = new Path2D(this.path);

			this.pathAbove.moveTo(game.width + ctx.lineWidth, game.origin.y - initialPoint.y); // right wall
			this.pathAbove.lineTo(game.width + ctx.lineWidth, game.height + ctx.lineWidth); // bottom right corner
			this.pathAbove.lineTo(0 - ctx.lineWidth, game.height + ctx.lineWidth);
			this.pathAbove.lineTo(0 - ctx.lineWidth, 0 - ctx.lineWidth);
			this.pathAbove.lineTo(game.width + ctx.lineWidth, 0 - ctx.lineWidth);
			this.pathAbove.lineTo(game.width + ctx.lineWidth, game.origin.y - initialPoint.y);

			ctx.fillStyle = this.fillStyleAbove;
			ctx.fill(this.pathAbove);
		}

		ctx.beginPath();
		ctx.lineWidth = this.lineWidth;
		ctx.strokeStyle = this.strokeStyle;
		ctx.stroke(this.path);
	}

	/**
	 * Draws as a polar function
	 * @param {object} ctx - The drawing context
	 */
	drawParametric(ctx) {
		let game = this.game;
		let canvas = game.canvas;
		// Note: using ctx.canvas is offscreen, so dimensions are scaled up for devicePixelRatio

		let initialPoint = this.scaledOf(0);
		this.path = new Path2D();
		this.path.moveTo(initialPoint.x, initialPoint.y);

		// If no end has been provided, there is nothing to draw (no time elapses)
		for(let tIndex = this.tStep; tIndex < this.end.t; tIndex += this.tStep) {
			let point = this.scaledOf(tIndex);
			this.path.lineTo( point.x, point.y);
		}

		ctx.beginPath();
		ctx.lineWidth = this.lineWidth;
		ctx.strokeStyle = this.strokeStyle;
		ctx.stroke(this.path);
	}

	/**
	 * Draws as a Cartesian function with reversed coordinates
	 * @param {object} ctx - The drawing context
	 */
	drawXOfY(ctx) {
		let game = this.game;
		let canvas = game.canvas;
		// Note: using ctx.canvas is offscreen, so dimensions are scaled up for devicePixelRatio

		/**
		 * Graph path moves up y-axis, starting at game.height,
		 * but we allow our index to move from 0 to game.height
		 * and subtract from game.height when drawing the path
		 */
		let initialI = Math.max(0, game.height - game.yToScreen( this.start.y ) );
		let initialScreenRealY = (initialI - game.origin.y) / game.graphScalar;
		let finalI = Math.min(game.height, game.height - game.yToScreen( this.end.y) );

		// Draw the current graph
		this.path = new Path2D();
		this.path.moveTo(this.scaledOf( initialScreenRealY ), game.height - initialI);

		for(let i = initialI + 1; i <= finalI; i++) {

			let screenGraphY = -((game.height - i) - game.origin.y) / game.graphScalar;
			let screenGraphYMinus1 = -(game.origin.y - (i - 1)) / game.graphScalar;

			// Don't connect over horizontal asymptotes
			if(
				(this.scaledOf(screenGraphY) < 0 && this.scaledOf(screenGraphYMinus1) > canvas.width) ||
				(this.scaledOf(screenGraphYMinus1) < 0 && this.scaledOf(screenGraphY) > canvas.width)) {

				ctx.stroke(this.path);
				this.continuous = false;
				this.path.moveTo(this.scaledOf(screenGraphY), game.height - i );
			}
			else {
				this.path.lineTo(this.scaledOf(screenGraphY), game.height - i);
			}
		}

		if(this.fillStyleBelow && this.fillStyleBelow !== CMGame.Color.TRANSPARENT) {
			this.pathBelow = new Path2D(this.path);
			this.pathBelow.lineTo(-ctx.lineWidth, game.height - finalI);
			this.pathBelow.lineTo(-ctx.lineWidth, game.height - initialI);
			this.pathBelow.closePath();
			ctx.fillStyle = this.fillStyleBelow;
			ctx.fill(this.pathBelow);
		}

		if(this.fillStyleAbove && this.fillStyleAbove !== CMGame.Color.TRANSPARENT) {
			this.pathAbove = new Path2D(this.path);
			this.pathAbove.lineTo(canvas.width + ctx.lineWidth, game.height - finalI);
			this.pathAbove.lineTo(canvas.width + ctx.lineWidth, game.height - initialI);
			this.pathAbove.closePath();
			ctx.fillStyle = this.fillStyleAbove;
			ctx.fill(this.pathAbove);
		}

		ctx.lineWidth = this.lineWidth;
		ctx.strokeStyle = this.strokeStyle;
		ctx.stroke(this.path);
		this.ondraw(ctx);
	}

	/**
	 * Draws graph in current frame
	 * @param {CanvasRenderingContext2D} ctx - The game's drawing context
	 */
	drawCartesian(ctx) {
		let game = this.game;
		let canvas = game.canvas;
		// Note: using ctx.canvas is offscreen, so dimensions are scaled up for devicePixelRatio

		// Set up endpoints, bounding horizontally within visible canvas (to optimize)
		let initialI = Math.max(0, game.xToScreen( this.start.x ) );
		let initialScreenRealX = (initialI - game.origin.x) / game.graphScalar;
		let finalI = Math.min(canvas.width, game.xToScreen( this.end.x) );

		// Draw the current graph
		this.path = new Path2D();
		this.path.moveTo(initialI, this.scaledOf( initialScreenRealX ) );

		for(let i = initialI + 1; i <= finalI; i++) {

			let screenGraphX = (i - game.origin.x) / game.graphScalar;
			let screenGraphXMinus1 = (i - 1 - game.origin.x) / game.graphScalar;

			// Don't connect over vertical asymptotes
			if(
				(this.scaledOf(screenGraphX) < 0 && this.scaledOf(screenGraphXMinus1) > canvas.height) ||
				(this.scaledOf(screenGraphXMinus1) < 0 && this.scaledOf(screenGraphX) > canvas.height)) {

				ctx.stroke(this.path);
				this.continuous = false;
				this.path.moveTo(i, this.scaledOf(screenGraphX) );
			}
			else {
				this.path.lineTo(i, this.scaledOf(screenGraphX) );
			}
		}

		if(this.fillStyleBelow && this.fillStyleBelow !== CMGame.Color.TRANSPARENT) {
			this.pathBelow = new Path2D(this.path);
			this.pathBelow.lineTo(finalI, canvas.height + ctx.lineWidth);
			this.pathBelow.lineTo(initialI, canvas.height + ctx.lineWidth);
			this.pathBelow.closePath();
			ctx.fillStyle = this.fillStyleBelow;
			ctx.fill(this.pathBelow);
		}

		if(this.fillStyleAbove && this.fillStyleAbove !== CMGame.Color.TRANSPARENT) {
			this.pathAbove = new Path2D(this.path);
			this.pathAbove.lineTo(finalI, 0 - ctx.lineWidth);
			this.pathAbove.lineTo(initialI, 0 - ctx.lineWidth);
			this.pathAbove.closePath();
			ctx.fillStyle = this.fillStyleAbove;
			ctx.fill(this.pathAbove);
		}

		ctx.lineWidth = this.lineWidth;
		ctx.strokeStyle = this.strokeStyle;
		ctx.stroke(this.path);
		this.ondraw(ctx);
	}

	/**
	 * Determines if given point lies below
	 * above, or on the given curve. The returned
	 * string refers to visual comparison (rather
	 * than flipped y values for screen). E.g.,
	 * [[x^2]].positionOf(0, 4); returns "above" since
	 * visually the real point (0, 4) sits "above" the
	 * graph.
	 * @param {number|object} xOrPoint - Point with x, y values, or a point's x value
	 * @param {number} [y] - A point's y value
	 * @returns {string} "above", "below", "on", "unknown"
	 */
	positionOf(xOrPoint, y) {
		let point = {};

		if(typeof xOrPoint === "number") {
			point.x = xOrPoint;
			point.y = y;
		}
		else {
			point = xOrPoint;
		}

		if(this.continuous) {
			let ctx = this.game.ctx;

			if(ctx.isPointInStroke(this.path, point.x, point.y) ) {
				return "on";
			}
			else
			if(ctx.isPointInPath(this.pathAbove, point.x, point.y)) {
				return "above";
			}
			else
			if(ctx.isPointInPath(this.pathBelow, point.x, point.y)) {
				return "below";
			}
			else {
				console.log(`Point (${point.x}, ${point.y}) is outside canvas`);
				return "unknown";
			}
		}
		else {
			// Cannot assume only 3 paths exist; must calculate specific point

			let funcRealY = this.of( this.game.xToReal( point.x ));
			let pointRealY = this.game.yToReal( point.y );

			// Remember, pixels are flipped upside down
			if(pointRealY === funcRealY) {
				return "on";
			}
			else
			if(pointRealY > funcRealY) {
				return "above";
			}
			else
			if(pointRealY < funcRealY) {
				return "below";
			}
			else {
				return "uknown";
			}
		}
	}
};

/**
 * Bonus! Manage game based on Venn Diagrams
 */

/** Manages individual regions within a Venn diagram */
class VennRegion extends CMGame.Sprite {

	/**
	 * Creates a VennRegion instance.
	 * @param {string} regionCode - A binary string defining
	 *   this region. The string includes leading zeros
	 *   corresponding to the number of sets in the
	 *   diagram. For instance, in a 3-set diagram, say,
	 *   A, B, C, the region "B minus (A U C)" has
	 *   regionCode "010" (note the leading zero).
	 * @param {number} [variation=0] - If 1, this
	 *   diagram shows circle sets embedded in one another.
	 *   See variation parameter in <CMGame>setNumberOfSets
	 */
	constructor(game, regionCode, variation=0) {
		super(game, 0, 0, 0, "circle", null, "none", 0, true);
		this.regionCode = regionCode;
		this.variation = variation;
		this.filled = false;
		this.fillStyle = "red"; // Since regions are created when diagram is, dev can set fill color later
		this.path = new Path2D();

		this.label = {
			text: "",
			x: 0,
			y: 0,
			active: false,
			fillStyle: CMGame.Color.BLACK
		};

		// Use expected font for reference in centering labels
		let fontSize = Math.floor(this.game.width / 16);
		this.game.ctx.font = `italic ${fontSize}px Times New Roman, serif`;

		switch(this.regionCode) {
			case "":
				this.label.text = "I";
				this.label.x = .5 * this.game.width - .5 * this.game.ctx.measureText("I").width;
				this.label.y = .5 * this.game.height;
				break;
			case "0":
				this.label.text = "I";
				this.label.x = .15 * this.game.width - .5 * this.game.ctx.measureText("I").width;
				this.label.y = .25 * this.game.height;
				break;
			case "1":
				this.label.text = "II";
				this.label.x = .5 * this.game.width - .5 * this.game.ctx.measureText("I").width;
				this.label.y = .5 * this.game.height;
				break;
			case "00":
				this.label.text = "I";
				this.label.x = .15 * this.game.width - .5 * this.game.ctx.measureText("I").width;
				this.label.y = .2 * this.game.height;
				break;
			case "0S0":
				this.label.text = "I";
				this.label.x = .15 * this.game.width - .5 * this.game.ctx.measureText("I").width;
				this.label.y = .2 * this.game.height;
				break;
			case "10":
				this.label.text = "II";
				this.label.x = .25 * this.game.width - .5 * this.game.ctx.measureText("II").width;
				this.label.y = .5 * this.game.height;
				break;
			case "01":
				this.label.text = "III";
				this.label.x = .75 * this.game.width - .5 * this.game.ctx.measureText("III").width;
				this.label.y = .5 * this.game.height;
				break;
			case "0S1":
				this.label.text = "II";
				this.label.x = .5 * this.game.width - .5 * this.game.ctx.measureText("II").width;
				this.label.y = .25 * this.game.height;
				break;
			case "11":
				this.label.text = "IV";
				this.label.x = .5 * this.game.width - .5 * this.game.ctx.measureText("IV").width;
				this.label.y = .5 * this.game.height;
				break;
			case "1S1":
				this.label.text = "III";
				this.label.x = .5 * this.game.width - .5 * this.game.ctx.measureText("III").width;
				this.label.y = .6 * this.game.height;
				break;

			// 3-set diagram
			case "0S0S0":
				this.label.text = "I";
				this.label.x = .15 * this.game.width - .5 * this.game.ctx.measureText("I").width;
				this.label.y = .2 * this.game.height;
				break;
			case "0S0S1": // C, outside B so outside A
				this.label.text = "II";
				this.label.x = .5 * this.game.width - .5 * this.game.ctx.measureText("II").width;
				this.label.y = 95;
				break;
			case "0S1S1": // B (so in C) outside A
				this.label.text = "III";
				this.label.x = .5 * this.game.width - .5 * this.game.ctx.measureText("III").width;
				this.label.y = 182;
				break;
			case "1S1S1":
				this.label.text = "IV";
				this.label.x = .5 * this.game.width - .5 * this.game.ctx.measureText("IV").width;
				this.label.y = 292;
				break;

			case "000":
				this.label.text = "I";
				this.label.x = .15 * this.game.width - .5 * this.game.ctx.measureText("I").width;
				this.label.y = .2 * this.game.height;
				break;
			case "100":
				this.label.text = "II";
				this.label.x = .25 * this.game.width - .5 * this.game.ctx.measureText("II").width;
				this.label.y = .7 * this.game.height;
				break;
			case "010":
				this.label.text = "III";
				this.label.x = .75 * this.game.width - .5 * this.game.ctx.measureText("III").width;
				this.label.y = .7 * this.game.height;
				break;
			case "001":
				this.label.text = "IV";
				this.label.x = .5 * this.game.width - .5 * this.game.ctx.measureText("IV").width;
				this.label.y = .2 * this.game.height;
				break;
			case "110":
				this.label.text = "V";
				this.label.x = .5 * this.game.width - .5 * this.game.ctx.measureText("V").width;
				this.label.y = .775 * this.game.height;
				break;
			case "101":
				this.label.text = "VI";
				this.label.x = .35 * this.game.width - .5 * this.game.ctx.measureText("VI").width;
				this.label.y = .45 * this.game.height;
				break;
			case "011":
				this.label.text = "VII";
				this.label.x = .65 * this.game.width - .5 * this.game.ctx.measureText("VII").width;
				this.label.y = .45 * this.game.height;
				break;
			case "111":
				this.label.text = "VIII";
				this.label.x = .5 * this.game.width - .5 * this.game.ctx.measureText("VIII").width;
				this.label.y = .525 * this.game.height;
				break;
		}

		// Adjust for different positions
		if(variation === 2) {
			switch(this.regionCode) {
				case "000":
					this.label.text = "I";
					this.label.x = .075 * this.game.width - .5 * this.game.ctx.measureText("I").width;
					this.label.y = .2 * this.game.height;
					break;
				case "100":
					this.label.text = "II";
					this.label.x = .2875 * this.game.width - .5 * this.game.ctx.measureText("II").width;
					this.label.y = .25 * this.game.height;
					break;
				case "010":
					this.label.text = "III";
					this.label.x = .7125 * this.game.width - .5 * this.game.ctx.measureText("III").width;
					this.label.y = .25 * this.game.height;
					break;
				case "001":
					this.label.text = "IV";
					this.label.x = .5 * this.game.width - .5 * this.game.ctx.measureText("IV").width;
					this.label.y = .7875 * this.game.height;
					break;
				case "110":
					this.label.text = "V";
					this.label.x = .5 * this.game.width - .5 * this.game.ctx.measureText("V").width;
					this.label.y = .225 * this.game.height;
					break;
				case "101":
					this.label.text = "VI";
					this.label.x = .35 * this.game.width - .5 * this.game.ctx.measureText("VI").width;
					this.label.y = .55 * this.game.height;
					break;
				case "011":
					this.label.text = "VII";
					this.label.x = .65 * this.game.width - .5 * this.game.ctx.measureText("VII").width;
					this.label.y = .55 * this.game.height;
					break;
				case "111":
					this.label.text = "VIII";
					this.label.x = .5 * this.game.width - .5 * this.game.ctx.measureText("VIII").width;
					this.label.y = .47 * this.game.height;
					break;
			}
		}
	}

	/**
	 * Overrides sprite's containsPoint logic,
	 * due to unusual shapes for regions.
	 * Also returns true if point is on bounding
	 * stroke line.
	 * @param {object|number} The point, or point's x value
	 * @param {number} The point's y value
	 * @returns {boolean}
	 */
	containsPoint(pointOrX, y) {
		let pointToCheck = null;

		if(typeof pointOrX === "number") {
			pointToCheck = {
				x: pointOrX,
				y: y
			};
		}
		else { // single point
			pointToCheck = pointOrX;
		}

		let A, B, C;

		switch(this.regionCode) {
			case "":
				return true;
			case "0":
				A = this.game.vennSets.get("A");
				return !A.containsPoint(pointOrX, y);
			case "1":
				A = this.game.vennSets.get("A");
				return A.containsPoint(pointOrX, y);
			case "00":
			case "0S0":
				A = this.game.vennSets.get("A");
				B = this.game.vennSets.get("B");
				return !(A.containsPoint(pointOrX, y) || B.containsPoint(pointOrX, y));
			case "10":
				A = this.game.vennSets.get("A");
				B = this.game.vennSets.get("B");
				return (A.containsPoint(pointOrX, y) && !B.containsPoint(pointOrX, y));
			case "01":
			case "0S1":
				A = this.game.vennSets.get("A");
				B = this.game.vennSets.get("B");
				return (!A.containsPoint(pointOrX, y) && B.containsPoint(pointOrX, y));
			case "11":
			case "1S1":
				A = this.game.vennSets.get("A");
				B = this.game.vennSets.get("B");
				return (A.containsPoint(pointOrX, y) && B.containsPoint(pointOrX, y));

			// 3-set diagram
			case "000":
			case "0S0S0":
				A = this.game.vennSets.get("A");
				B = this.game.vennSets.get("B");
				C = this.game.vennSets.get("C");
				return !(A.containsPoint(pointOrX, y) || B.containsPoint(pointOrX, y) || C.containsPoint(pointOrX, y));
			case "100":
				A = this.game.vennSets.get("A");
				B = this.game.vennSets.get("B");
				C = this.game.vennSets.get("C");
				return (A.containsPoint(pointOrX, y) && !B.containsPoint(pointOrX, y) && !C.containsPoint(pointOrX, y));
			case "010":
				A = this.game.vennSets.get("A");
				B = this.game.vennSets.get("B");
				C = this.game.vennSets.get("C");
				return (!A.containsPoint(pointOrX, y) && B.containsPoint(pointOrX, y) && !C.containsPoint(pointOrX, y));
			case "001":
			case "0S0S1": // C, outside B so outside A
				A = this.game.vennSets.get("A");
				B = this.game.vennSets.get("B");
				C = this.game.vennSets.get("C");
				return (!A.containsPoint(pointOrX, y) && !B.containsPoint(pointOrX, y) && C.containsPoint(pointOrX, y));			
			case "110":
				A = this.game.vennSets.get("A");
				B = this.game.vennSets.get("B");
				C = this.game.vennSets.get("C");
				return (A.containsPoint(pointOrX, y) && B.containsPoint(pointOrX, y) && !C.containsPoint(pointOrX, y));
			case "101":
				A = this.game.vennSets.get("A");
				B = this.game.vennSets.get("B");
				C = this.game.vennSets.get("C");
				return (A.containsPoint(pointOrX, y) && !B.containsPoint(pointOrX, y) && C.containsPoint(pointOrX, y));
			case "011":
			case "0S1S1": // B (so in C) outside A
				A = this.game.vennSets.get("A");
				B = this.game.vennSets.get("B");
				C = this.game.vennSets.get("C");
				return (!A.containsPoint(pointOrX, y) && B.containsPoint(pointOrX, y) && C.containsPoint(pointOrX, y));
			case "100":
				A = this.game.vennSets.get("A");
				B = this.game.vennSets.get("B");
				C = this.game.vennSets.get("C");
				return (A.containsPoint(pointOrX, y) && !B.containsPoint(pointOrX, y) && !C.containsPoint(pointOrX, y));
			case "010":
				A = this.game.vennSets.get("A");
				B = this.game.vennSets.get("B");
				C = this.game.vennSets.get("C");
				return (!A.containsPoint(pointOrX, y) && B.containsPoint(pointOrX, y) && !C.containsPoint(pointOrX, y));
			case "111":
			case "1S1S1":
				A = this.game.vennSets.get("A");
				B = this.game.vennSets.get("B");
				C = this.game.vennSets.get("C");
				return (A.containsPoint(pointOrX, y) && B.containsPoint(pointOrX, y) && C.containsPoint(pointOrX, y));
		}
	}

	/**
	 * Draws this region for current frame
	 * (essentially does nothing if region is not filled)
	 * @param {object} ctx - The drawing context
	 */
	draw(ctx) {
		if(this.filled) {
			let A,
				B,
				C,
				U,
				APath,
				BPath,
				CPath,
				ACompPath,
				BCompPath,
				CCompPath;

			ctx.save();
			ctx.fillStyle = this.fillStyle;

			switch(this.regionCode) {

				 // Empty Diagram, only region is just "U"
				case "": // U
					ctx.fillRect(0, 0, this.game.canvas.width, this.game.canvas.height);
					break;

				// 1-diagram set (mostly)
				case "0": // U \ A
					A = this.game.vennSets.get("A");
					A.drawComplement(ctx);
					break;
				case "1": // A
				case "1S1": // A \subset B
				case "1S1S1": // A \subset B \subset C
					A = this.game.vennSets.get("A");
					ctx.fill( A.getPath(ctx) );
					break;

				// 2-diagram set (mostly)
				case "10": // A \ B
					A = this.game.vennSets.get("A");
					B = this.game.vennSets.get("B");
					BCompPath = B.getComplementPath(ctx);
					ctx.clip(BCompPath);

					ctx.beginPath();
					ctx.arc(A.x, A.y, A.radius, 0, Math.TAU, false);
					ctx.fill();
					break;
				case "01": // B \ A
				case "0S1":
					A = this.game.vennSets.get("A");
					B = this.game.vennSets.get("B");
					ACompPath = A.getComplementPath(ctx);
					ctx.clip(ACompPath);

					ctx.beginPath();
					ctx.arc(B.x, B.y, B.radius, 0, Math.TAU, false);
					ctx.fill();
					break;
				case "11": // A \int B
					A = this.game.vennSets.get("A");
					B = this.game.vennSets.get("B");

					ctx.beginPath();
					ctx.arc(A.x, A.y, A.radius, 0, Math.TAU, false);
					ctx.clip();

					ctx.beginPath();
					// Since clipped to only show stuff contain in A, this draws A int B
					ctx.arc(B.x, B.y, B.radius, 0, Math.TAU, false);
					ctx.clip();

					ctx.fill();
					break;
				case "00": // U outside of A, B
				case "0S0": // U outside B, which contains A
					A = this.game.vennSets.get("A");
					B = this.game.vennSets.get("B");

					ACompPath = A.getComplementPath(ctx);
					BCompPath = B.getComplementPath(ctx);

					ctx.clip(ACompPath);
					ctx.clip(BCompPath);
					ctx.fillRect(0, 0, this.game.canvas.width, this.game.canvas.height);
					break;

				case "0S0S0":
					C = this.game.vennSets.get("C");
					C.drawComplement(ctx);
					break;

				// 3-set diagram
				case "000": // U, outside all sets A, B, C
					A = this.game.vennSets.get("A");
					B = this.game.vennSets.get("B");
					C = this.game.vennSets.get("C");

					ACompPath = A.getComplementPath(ctx);
					BCompPath = B.getComplementPath(ctx);
					CCompPath = C.getComplementPath(ctx);

					ctx.clip(ACompPath);
					ctx.clip(BCompPath);
					ctx.clip(CCompPath);
					ctx.fillRect(0, 0, this.game.canvas.width, this.game.canvas.height);
					break;
				case "100":
					A = this.game.vennSets.get("A");
					B = this.game.vennSets.get("B");
					C = this.game.vennSets.get("C");

					APath = A.getPath(ctx);
					BCompPath = B.getComplementPath(ctx);
					CCompPath = C.getComplementPath(ctx);

					ctx.clip(APath);
					ctx.clip(BCompPath);
					ctx.clip(CCompPath);
					ctx.fillRect(0, 0, this.game.canvas.width, this.game.canvas.height);
					break;
				case "010":
					A = this.game.vennSets.get("A");
					B = this.game.vennSets.get("B");
					C = this.game.vennSets.get("C");

					ACompPath = A.getComplementPath(ctx);
					BPath = B.getPath(ctx);
					CCompPath = C.getComplementPath(ctx);

					ctx.clip(ACompPath);
					ctx.clip(BPath);
					ctx.clip(CCompPath);
					ctx.fillRect(0, 0, this.game.canvas.width, this.game.canvas.height);
					break;
				case "001":
				case "0S0S1": // C \ B as subsets
					A = this.game.vennSets.get("A");
					B = this.game.vennSets.get("B");
					C = this.game.vennSets.get("C");
					
					A = this.game.vennSets.get("A");
					B = this.game.vennSets.get("B");
					C = this.game.vennSets.get("C");

					ACompPath = A.getComplementPath(ctx);
					BCompPath = B.getComplementPath(ctx);
					CPath = C.getPath(ctx);

					ctx.clip(ACompPath);
					ctx.clip(BCompPath);
					ctx.clip(CPath);
					ctx.fillRect(0, 0, this.game.canvas.width, this.game.canvas.height);
					break;
				case "110":
					A = this.game.vennSets.get("A");
					B = this.game.vennSets.get("B");
					C = this.game.vennSets.get("C");
					
					APath = A.getPath(ctx);
					BPath = B.getPath(ctx);
					CCompPath = C.getComplementPath(ctx);

					ctx.clip(APath);
					ctx.clip(BPath);
					ctx.clip(CCompPath);
					ctx.fillRect(0, 0, this.game.canvas.width, this.game.canvas.height);
					break;
				case "101":
					A = this.game.vennSets.get("A");
					B = this.game.vennSets.get("B");
					C = this.game.vennSets.get("C");

					APath = A.getPath(ctx);
					BCompPath = B.getComplementPath(ctx);
					CPath = C.getPath(ctx);

					ctx.clip(APath);
					ctx.clip(BCompPath);
					ctx.clip(CPath);
					ctx.fillRect(0, 0, this.game.canvas.width, this.game.canvas.height);
					break;
				case "011":
				case "0S1S1": // B \ A as subsets
					A = this.game.vennSets.get("A");
					B = this.game.vennSets.get("B");
					C = this.game.vennSets.get("C");

					ACompPath = A.getComplementPath(ctx);
					BPath = B.getPath(ctx);
					CPath = C.getPath(ctx);

					ctx.clip(ACompPath);
					ctx.clip(BPath);
					ctx.clip(CPath);
					ctx.fillRect(0, 0, this.game.canvas.width, this.game.canvas.height);
					break;
				case "100":
					A = this.game.vennSets.get("A");
					B = this.game.vennSets.get("B");
					C = this.game.vennSets.get("C");
					
					APath = A.getPath(ctx);
					BCompPath = B.getComplementPath(ctx);
					CCompPath = C.getComplementPath(ctx);

					ctx.clip(APath);
					ctx.clip(BCompPath);
					ctx.clip(CCompPath);
					ctx.fillRect(0, 0, this.game.canvas.width, this.game.canvas.height);
					break;
				case "010":
					A = this.game.vennSets.get("A");
					B = this.game.vennSets.get("B");
					C = this.game.vennSets.get("C");

					ACompPath = A.getComplementPath(ctx);
					BPath = B.getPath(ctx);
					CCompPath = C.getComplementPath(ctx);

					ctx.clip(ACompPath);
					ctx.clip(BPath);
					ctx.clip(CCompPath);
					ctx.fillRect(0, 0, this.game.canvas.width, this.game.canvas.height);
					break;
				case "111":
					A = this.game.vennSets.get("A");
					B = this.game.vennSets.get("B");
					C = this.game.vennSets.get("C");

					ctx.beginPath();
					ctx.arc(A.x, A.y, A.radius, 0, Math.TAU, false);
					ctx.clip();

					ctx.beginPath();
					// Since clipped to only show stuff contain in A, this draws A int B
					ctx.arc(B.x, B.y, B.radius, 0, Math.TAU, false);
					ctx.clip();

					ctx.beginPath();
					// Since clipped to only show stuff contain in A in B, this draws A int B in C
					ctx.arc(C.x, C.y, C.radius, 0, Math.TAU, false);

					ctx.fill();
					break;
			}

			ctx.restore(); // Exit "clip" region
		}

		if(this.label.active) {
			ctx.save();
			let fontSize = Math.floor(this.game.width / 16);
			ctx.font = `italic ${fontSize}px Times New Roman, serif`;
			ctx.textBaseline = "middle";
			ctx.fillStyle = this.label.fillStyle;
			ctx.fillText(this.label.text, this.label.x, this.label.y);
			ctx.restore();
		}
	}
}

/** Manages full circle sets ("A", "B", etc.) in a Venn Diagram */
class VennSet extends CMGame.Sprite {

	/**
	 * Creates a VennSet instance, represented by
	 * a stroked circle.
	 * @param {CMGame} game - The current game instance
	 * @param {number} x - The center point's x value
	 * @param {number} y - The center point's y value
	 * @param {number} radius - The radius of the circle
	 * @param {object} label - A plain JS object defining the set's label
	 */
	constructor(game, x, y, radius, label) {
		super(game, x, y, radius, "circle", null, "none", 1, true);

		this.path = null;
		this.complementPath = null;

		this.label = {
			text: "",
			x: x + .75 * radius,
			y: y + radius,
			active: false,
			fillStyle: CMGame.Color.BLACK
		};

		if(label) {
			this.label.active = true;
			this.label.x = label.x || this.label.x;
			this.label.y = label.y || this.label.y;
			this.label.text = label.text || this.label.text;
		}
	}

	/**
	 * Determines if a given point is in this
	 * circle. We can check multiple sets to
	 * detect if a point is in a particular region.
	 * @param {object|number} The point, or point's x value
	 * @param {number} The point's y value
	 * @returns {boolean}
	 */
	containsPoint(pointOrX, y) {
		let pointToCheck = null;

		if(typeof pointOrX === "number") {
			pointToCheck = {
				x: pointOrX,
				y: y
			};
		}
		else { // single point
			pointToCheck = pointOrX;
		}

		return this.game.distance(this, pointToCheck) <= this.radius;
	}

	update(frameCount) {}

	draw(ctx) {
		ctx.save();
		ctx.strokeStyle = ctx.fillStyle = CMGame.Color.BLACK;
		ctx.lineWidth = 1.5;
		this.game.strokeOval(this.x, this.y, this.radius);
		if(this.label.active) {
			let fontSize = Math.floor(this.game.width / 16);
			ctx.font = `italic ${fontSize}px Times New Roman, serif`;
			ctx.textBaseline = "middle";
			ctx.fillStyle = this.label.fillStyle;
			ctx.fillText(this.label.text, this.label.x, this.label.y);
		}
		ctx.restore();
	}

	/**
	 * Draws only the complement of this set
	 * @param {object} ctx - The drawing context
	 */
	drawComplement(ctx) {
		ctx.fill(this.getComplementPath(ctx));
	}

	/**
	 * Gets the circular path for this set.
	 * Can be used to construct set
	 * operations, or for collision detection.
	 * @param {boolean} [overrideOldPaths=false] - true if this should
	 *   not return stored path. Path is stored to optimize code,
	 *   so only set this to true if the set changes x, y, or
	 *   radius value (e.g., for a moving animation)
	 * @returns {Path2D}
	 */
	getPath(ctx, overrideOldPaths=false) {
		if(this.path && !overrideOldPaths) {
			return this.path;
		}

		this.path = new Path2D();
		this.path.arc(this.x, this.y, this.radius, 0, Math.TAU, false);
		return this.path;
	}

	/**
	 * Constructs and returns the drawing path
	 * for this set's complement, without
	 * drawing. Can be used to construct set
	 * operations, or for collision detection.
	 * @param {object} ctx - The drawing context
	 * @param {boolean} [overrideOldPaths=false] - true if this should
	 *   not return stored path. Path is stored to optimize code,
	 *   so only set this to true if the set changes x, y, or
	 *   radius value (e.g., for a moving animation)
	 * @returns {Path2D}
	 */
	getComplementPath(ctx, overrideOldPaths=false)  {
		if(this.complementPath && !overrideOldPaths) {
			return this.complementPath;
		}

		// Fill outer area above, then below set circle
		this.complementPath = new Path2D();
		this.complementPath.moveTo(0, 0); // top left corner of screen
		this.complementPath.lineTo(this.game.canvas.width, 0); // top right
		this.complementPath.lineTo(this.game.canvas.width, this.game.canvas.height); // bottom left
		this.complementPath.lineTo(0, this.game.canvas.height); // bottom right
		this.complementPath.lineTo(0, this.y); // left side, at circle's center
		this.complementPath.lineTo(this.x - this.radius, this.y); // circle's center height, left side
		this.complementPath.arc(this.x, this.y, this.radius, 0, Math.TAU, true); // round the circle, counterclockwise
		this.complementPath.lineTo(0, this.y); // return to point on left side matching this circle's center y
		this.complementPath.closePath(); // return to top left corner
		return this.complementPath;
	}
}

// Bonus bonus! Graph theory

/** A class to manage graph theory "vertices" */
class CMVertex extends CMGame.Sprite {
	/**
	 * Creates a CMVertex instance
	 * @param {CMGame} game - The current CMGame instance
	 * @param {number} x - The screen x for this vertex's center
	 * @param {number} y - The screen y for this vertex's center
	 * @param {number} radius - The radius for this vertex, drawn as a circle
	 * @param {string} fillStyle - The color to draw this vertex with
	 * @param {object} [label] - A plain JS object of options for a label
	 * @param {string} [label.text] - A string label for this vertex
	 * @param {number} [label.x] - The x position for this label
	 * @param {number} [label.y] - The y position for this label
	 * @param {boolean} [label.active=true] - Whether to draw the label. Defaults
	 *   to true if not set but label.text has been set.
	 * @param {string} [label.fillStyle=CMGame.Color.BLACK] - Color to draw the label with
	 */
	constructor(game, x, y, radius, fillStyle=CMGame.Color.BLACK, label) {
		super(game, x, y, radius, "circle", fillStyle, "none", 1, true);

		this.degree = 0;
		this.adjacentVertices  = [];
		this.incidentEdges = [];

		this.label = {
			text: "",
			x: 0,
			y: 0,
			active: false,
			fillStyle: this.fillStyle,
			font: (.5 * radius) + "px Times New Roman, serif"
		};

		if(label) {
			for(let key in label) {
				this.label[key] = label[key];
			}

			if(label.text && typeof label.active === "undefined") {
				this.label.active = true;
			}
		}
	}

	/** Update this vertex for current frame */
	update() {
		super.update();
		for(let edge of this.incidentEdges) {
			if(this === edge.vertex1) {
				edge.start.x = this.x;
				edge.start.y = this.y;
			}
			else
			if(this === edge.vertex2) {
				edge.end.x = this.x;
				edge.end.y = this.y;
			}
		}
	}

	/**
	 * Helper function to determine if another
	 * vertex is connected to this one by an edge
	 * @param {CMVertex} otherVertex - The other to check
	 * @returns {boolean}
	 */
	adjacentTo(otherVertex) {
		return this.adjacentVertices.includes(otherVertex);
	}

	/**
	 * Helper function to determine if an
	 * edge is incident to this vertex
	 * @param {CMEdge} edge - The edge to check
	 * @returns {boolean}
	 */
	incidentTo(edge) {
		return this.incidentEdges.includes(edge);
	}

	/** Draws this vertex for current frame */
	draw(ctx) {
		super.draw(ctx);
		if(this.label.active) {
			ctx.fillStyle = this.label.fillStyle;
			ctx.font = this.label.font;
			ctx.fillText(this.label.text, this.label.x, this.label.y);
		}
	}
}

/** A class to manage graph theory "edges" */
class CMEdge extends CMGame.Sprite {

	/**
	 * Creates a CMEdge instance. Note that in standard
	 * graph theory, every edge is defined by two vertices.
	 * We only allow null as options here for gameplay
	 * purposes (e.g., if play needs to connect two vertices
	 * with this edge, it does not make sense for them to
	 * already be connected).
	 * @param {CMGame} game - The current CMGame instance
	 * @param {CMVertex} [vertex1=null] - One adjacent vertex (if directed, this should be the source vertex)
	 * @param {CMVertex} [vertex2=null] - A different adjacent vertex (if directed, this should be the destination vertex) 
	 * @param {number} [lineWidth=1] - The thickness in pixels to draw this vertex
	 * @param {string} [fillStyle=CMGame.Color.BLACK] - The color to draw this vertex with
	 * @param {object} [label] - A plain JS object of options for a label
	 * @param {string} [label.text] - A string label for this vertex
	 * @param {number} [label.x] - The x position for this label
	 * @param {number} [label.y] - The y position for this label
	 * @param {boolean} [label.active=true] - Whether to draw the label. Defaults
	 *   to true if not set but label.text has been set.
	 * @param {string} [label.fillStyle=CMGame.Color.BLACK] - Color to draw the label with
	 */
	constructor(game, vertex1=null, vertex2=null, lineWidth=1,
			fillStyle=CMGame.Color.BLACK, label={}, directed=false, weight) {

		super(game, 0, 0, lineWidth, "line", fillStyle, "none", 0, true);

		// vertex1 and vertex2 are the "incident" vertices to this edge
		this.vertex1 = vertex1;
		this.vertex2 = vertex2;
		this.directed = directed;
		this.weight = weight;

		this.incidentVertices  = [];
		this.incidentEdges = [];

		this.length = 0;
		this.start = {
			x: 0,
			y: 0
		};

		this.end = {
			x: 0,
			y: 0
		};

		if(this.vertex1) {
			this.vertex1.incidentEdges.push(this);

			for(let edge of this.vertex1.incidentEdges) {
				if(!this.incidentEdges.includes(edge) && edge !== this) {
					this.incidentEdges.push(edge);
				}
			}

			this.start = {
				x: this.vertex1.x,
				y: this.vertex1.y
			};

			this.x = this.start.x;
			this.y = this.start.y;
		}

		if(this.vertex2) {
			this.vertex2.incidentEdges.push(this);

			for(let edge of this.vertex2.incidentEdges) {
				if(!this.incidentEdges.includes(edge) && edge !== this) {
					this.incidentEdges.push(edge);
				}
			}

			this.end = {
				x: this.vertex2.x,
				y: this.vertex2.y
			};
		}
		else {
			this.end = {
				x: this.start.x,
				y: this.start.y
			};
		}

		this.length = this.game.distance(this.start, this.end);

		// drawing paths, not "path" in Graph Theory sense
		this.path = new Path2D();
		this.arrowPath = new Path2D();
		this.rebuildPath(); // Set up initial form

		if(this.vertex1 && this.vertex2) {
			if(!this.vertex1.adjacentVertices.includes(this.vertex2)) {
				this.vertex1.adjacentVertices.push(this.vertex2);
				this.vertex1.degree++;
			}

			if(!this.vertex2.adjacentVertices.includes(this.vertex1)) {
				this.vertex2.adjacentVertices.push(this.vertex1);
				this.vertex2.degree++;
			}
		}

		this.label = {
			text: "",
			x: 0,
			y: 0,
			active: false,
			fillStyle: this.fillStyle,
			font: Math.max(lineWidth * 5, 16) + "px Times New Roman, serif"
		};

		if(label) {
			for(let key in label) {
				this.label[key] = label[key];
			}

			if(label.text && typeof label.active === "undefined") {
				this.label.active = true;
			}
		}
	}

	/**
	 * For a directed graph, reverses direction
	 * of arrow, by switching vertex1 and vertex2
	 */
	changeDirection() {
		let v1Idx = this.game.vertices.indexOf( this.vertex1 );
		let v2Idx = this.game.vertices.indexOf( this.vertex2 );

		this.vertex1 = this.game.vertices[v2Idx];
		this.vertex2 = this.game.vertices[v1Idx];

		if(this.vertex1) {
			this.start = {
				x: this.vertex1.x,
				y: this.vertex1.y
			};

			this.x = this.start.x;
			this.y = this.start.y;
		}

		if(this.vertex2) {
			this.end = {
				x: this.vertex2.x,
				y: this.vertex2.y
			};
		}
		else {
			this.end = {
				x: this.start.x,
				y: this.start.y
			};
		}

		this.rebuildPath();
	}

	/**
	 * Updates drawing path and arrow path
	 * for collisions, drawing, etc.
	 */
	rebuildPath() {
		this.path = new Path2D();
		this.path.moveTo(this.start.x, this.start.y);

		// No need to calculate these for non-directed graph
		let vBorder = null;
		let angle = 0;
		let oppositeAngle = 0;
		let arrowSide = 0;
		let arrowHeight = 0;

		if(this.directed) {
			vBorder = {
				x: this.end.x,
				y: this.end.y
			};

			angle = this.game.slopeToRadians( this.game.getSlope(this.start, this.end) );

			if(this.end.x < this.start.x) {
				angle += Math.PI;
			}

			while(angle >= Math.TAU) {
				angle -= Math.TAU;
			}

			oppositeAngle = angle + Math.PI;
			while(oppositeAngle >= Math.TAU) {
				oppositeAngle -= Math.TAU;
			}

			arrowSide = 1.5 * this.width;
			arrowHeight = Math.SQRT1_2 * arrowSide;
			
			if(this.vertex2) {
				vBorder.x = this.end.x + (this.vertex2.radius + arrowHeight) * Math.cos(oppositeAngle),
				vBorder.y = this.end.y + (this.vertex2.radius + arrowHeight) * Math.sin(oppositeAngle)
			}

			// Move outside circle, to leave space for arrow
			this.path.lineTo( vBorder.x, vBorder.y );
		}
		else {
			this.path.lineTo(this.end.x, this.end.y);
		}

		this.arrowPath = new Path2D();

		// Draw arrow at end of edge
		if(this.directed) {
			let arrowLeftAngle = angle - 3 * Math.PI / 4;
			let arrowRightAngle = angle + 3 * Math.PI / 4;

			while(arrowLeftAngle < 0) {
				arrowLeftAngle += Math.TAU;
			}

			while(arrowRightAngle > Math.TAU) {
				arrowRightAngle -= Math.TAU;
			}

			if(this.vertex2.radius) {
				vBorder.x = this.end.x + this.vertex2.radius * Math.cos(oppositeAngle),
				vBorder.y = this.end.y + this.vertex2.radius * Math.sin(oppositeAngle)
			}

			// Move outside circle (or to endpoint if no second vertex)
			this.arrowPath.lineTo( vBorder.x, vBorder.y );

			this.arrowPath.lineTo(
				vBorder.x + arrowSide * Math.cos(arrowLeftAngle), // x + r * Math.cos(theta),
				vBorder.y + arrowSide * Math.sin(arrowLeftAngle) // y + r * Math.sin(theta)
			); // move to left point

			this.arrowPath.lineTo(
				vBorder.x + arrowSide * Math.cos(arrowRightAngle), // x + r * Math.cos(theta),
				vBorder.y + arrowSide * Math.sin(arrowRightAngle) // y + r * Math.sin(theta)
			); // move to right point

			if(this.vertex2.radius) {
				// Return to point outside circle
				this.arrowPath.lineTo( vBorder.x, vBorder.y );
			}
			else {
				this.arrowPath.lineTo(this.end.x, this.end.y); // return to tip of triangle
			}
		}
	}

	/** Updates edge in current frame, and rebuilds path in case of animation */
	update() {
		super.update();
		this.rebuildPath();
	}

	/**
	 * Draws edge in current frame, including arrow
	 * if a directed graph.
	 * @param {object} ctx - The game's drawing context
	 */
	draw(ctx) {
		ctx.save();
		ctx.lineWidth = this.width;
		ctx.strokeStyle = this.fillStyle;
		ctx.stroke(this.path);
		ctx.restore();
		ctx.fillStyle = this.fillStyle;
		ctx.fill(this.arrowPath);

		if(this.label.active) {
			ctx.fillStyle = this.label.fillStyle;
			ctx.font = this.label.font;
			ctx.fillText(this.label.text, this.label.x, this.label.y);
		}

		this.ondraw(ctx);
	}
}

/**
 * But wait! There's more...
 */

/** A class to quickly create n-gons for 2D space */
class CMnGon extends CMGame.Sprite {
	/**
	 * Creates a CMVertex instance
	 * @param {CMGame} game - The current CMGame instance
	 * @param {number} n - The number of sides for this n-gon
	 * @param {number} x - The screen x for this shape's center
	 * @param {number} y - The screen y for this shape's center
	 * @param {number} radius - The radius from center to each corner
	 * @param {number} rotation - Number in radians to rotate by (clockwise, from viewer's perspective)
	 * @param {string} [fillStyle=CMGame.Color.BLACK] - The color to fill this shape with
	 * @param {string} [strokeStyle=CMGame.Color.TRANSPARENT] - The color to draw this outline with
	 * @param {number} [lineWidth=1] How thick the outline should be
	 */
	constructor(game, n, x, y, radius, rotation=0, fillStyle=CMGame.Color.BLACK,
			strokeStyle=CMGame.Color.TRANSPARENT, lineWidth=1) {

		super(game, x, y, radius, "circle", function(ctx) {
			ctx.fillStyle = this.fillStyle;
			ctx.fill(this.path);

			ctx.strokeStyle = this.strokeStyle;
			ctx.stroke(this.path);
		});

		this.fillStyle = fillStyle;
		this.strokeStyle = strokeStyle;
		this.lineWidth = lineWidth;

		this.n = n;
		this.rotation = rotation;
		this.rebuildPath();

		this.previousState = [this.n, this.x, this.y, this.radius, this.rotation].join(";");
	}

	/**
	 * Sets up the drawing path, based on shape's
	 * center, radius, rotation, and number of corners
	 */
	rebuildPath() {
		this.path = new Path2D();

		let arc = Math.TAU / this.n;

		this.path.moveTo(
			this.x + this.radius * Math.cos( this.rotation ),
			this.y + this.radius * Math.sin( this.rotation ));

		for(let i = this.rotation; i <= this.rotation + Math.TAU; i += arc) {

			this.path.lineTo(
				this.x + this.radius * Math.cos(i),
				this.y + this.radius * Math.sin(i));
		}
	}

	update() {
		super.update();

		if([this.n, this.x, this.y, this.radius, this.rotation].join(";") !== this.previousState) {
			this.rebuildPath();
			this.previousState = [this.n, this.x, this.y, this.radius, this.rotation].join(";");
		}
	}

	/**
	 * Determines if a given point is on this
	 * object. Useful for player interaction
	 * via mouse clicks or touch points.
	 * @param {object|number} The point, or point's x value
	 * @param {number} The point's y value
	 * @returns {boolean}
	 */
	containsPoint(pointOrX, y) {
		let pointToCheck = null;

		if(typeof pointOrX === "number") {
			pointToCheck = {
				x: pointOrX,
				y: y
			};
		}
		else { // single point
			pointToCheck = pointOrX;
		}

		return this.game.ctx.isPointInPath(
			this.path, pointToCheck.x, pointToCheck.y);
	}
}