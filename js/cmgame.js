/**
 * CMGame Engine
 *
 * A JS engine for games inspired by college math.
 * Built for use on the website collegemathgames.com,
 * but also available to use, free, under the MIT license.
 *
 * @author Tim S. Long, PhD
 * @copyright 2022 Tim S. Long, PhD
 * @license MIT
 */

"use strict";

// Add some useful static values
Math.TAU = Math.TAU || Math.PI * 2; // Convenience for drawing and polar calculations
Math.SQRT3 = Math.SQRT3 || Math.sqrt(3); // Convenience for unit circle, etc.
Math.SQRT5 = Math.SQRT5 || Math.sqrt(5); // Ditto
Math.PHI = Math.PHI || .5 * (1 + Math.SQRT5); // Golden ratio

Math.csc = x => 1/Math.sin(x);
Math.sec = x => 1/Math.cos(x);
Math.cot = x => 1/Math.tan(x);

// These will be overridden to control fps speed
window.requestNextFrame = window.requestAnimationFrame.bind(window);
window.cancelNextFrame = window.cancelAnimationFrame.bind(window);

window.documentBody = null;

/**
 * Some style guides suggest not using "optional" HTML tags,
 * including the <body> tag, but this can lead to unexpected
 * results when trying to bind handlers to dynamically added
 * elements (something we do a lot in this script).
 *
 * If no <body> is present, we create a temporary one
 * while the handlers bind, and remove any extra
 * generated <body> tags later.
 */
if(!document.body) {
	window.documentBody = document.body =
			document.documentElement.appendChild( document.createElement("body") );

	console.warn("Some issues may arise without certain HTML tags present. " +
		"If you need touch/mouse events, provide either " +
		"a <body> tag or a <canvas> tag in your HTML.");
}
else {
	window.documentBody = document.body;
}

/**
 * Manage web audio logic, overcoming iOS bug
 * that seems to prevent web audio playing,
 * even after user interaction.
 * Majority of this audio-handling script is based on this blog:
 * https://artandlogic.com/2019/07/unlocking-the-web-audio-api/
 */

if(document.currentScript !== null) {
	window.CM_SILENCE_PATH = document.currentScript.src.replace(/js\/cmgame(\/min)?\.js$/, "audio/silencesecond.wav");
}
else { // if currentScript is null, we assume CMGame code is being processed within the HTML file
	window.CM_SILENCE_PATH = "js/cmgame/audio/silencesecond.wav";
}

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

    const _af_buffers = new Map();

	let _audioCtxConstructor = (window.AudioContext || window.webkitAudioContext);
    let _audioCtx = null;

    let _isUnlocked = false;

	// To elminate warnings, we will hold off on _audioCtx initialization and file loading until user interaction
	let loadQueue = [];

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

        // We call this when user interaction will allow us to unlock
        // the audio API.
        const unlock = function (e) {

			_audioCtx = new _audioCtxConstructor();

			// Scratch buffer to prevent memory leaks on iOS.
			// See: https://stackoverflow.com/questions/24119684/web-audio-api-memory-leaks-on-mobile-platforms
			const _scratchBuffer = _audioCtx.createBuffer(1, 1, 22050);

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

						Promise.all(
							loadQueue.map(obj =>
								load(obj.filepath, obj.preferredName, "from prom"))
						).then(() => {
							// console.log("all audios loaded in CMSound");
						});
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
	 * @param {string} [preferredName] - If present, store loaded object under this key
     * @returns {Promise<AudioBuffer>}
     */
    async function load (sfxFile, preferredName=null) {

		/**
		 * To prevent decodeShim throwing an error as we wait for user interaction,
		 * we will store these requests in a queue
		 */
		if(!audUnlocked) {
			loadQueue.push({
				filepath: sfxFile,
				preferredName: preferredName
			});

			return Promise.resolve(null);
		}

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

        _af_buffers.set(preferredName || sfxFile, audiobuffer);
        return audiobuffer;
    };

    /**
     * Play the specified file, loading it first - either retrieving it from the saved buffers, or fetching
     * it from the network.
     * @param {string} sfxFile - The path of the audio file to play
	 * @param {boolean} [loopIfTrue] - Whether to loop the file
     * @returns {Promise<AudioBufferSourceNode>}
     */
    function play (sfxFile, loopIfTrue) {

		// Added to improve performance. I mean, like, barely.
		if(_af_buffers.has(sfxFile)) {
			sourceNodes[sfxFile] = _audioCtx.createBufferSource();
            sourceNodes[sfxFile].loop = !!loopIfTrue;
			sourceNodes[sfxFile].buffer = _af_buffers.get(sfxFile);
            sourceNodes[sfxFile].connect(_audioCtx.destination);
            sourceNodes[sfxFile].start();
			return Promise.resolve(sourceNodes[sfxFile]);
		}

        return load(sfxFile).then((audioBuffer) => {
			if(audioBuffer === null) {
				/**
				 * If sound is not loaded yet (e.g., on first user interaction)
				 * reject so game will play from normal <audio>
				 */
				return Promise.reject("CMSound audios not loaded");
			}

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
			return play(src, true);
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

	// zero isn't even in this range. Stop wasting my time...
	if(min > 0 || max < 0) {
		return CMRandom.range(min, max);
	}

	// We'll shift all "positive choices" left, then add if one of that collection's elements were picked
	let pick = 0,
		shift = 0;

	if(Number.isInteger(min) && Number.isInteger(max))
		shift = 1;
	else
		shift = Number.MIN_VALUE;

	if(Number.isInteger(min) && Number.isInteger(max - shift)) {
		// to account for the edge case where max is an integer + Number.MIN_VALUE
		pick = (min + Math.random() * (max - min));
	}
	else {
		pick = CMRandom.range(min, max - shift);
	}

	if(pick >= 0)
		pick += shift;

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
	 * To avoid grayscale, use CMColorscale
	 * @returns {string}
	 */
	color: {
		get: function() {
			let colorArray = Object.keys(CMColor).filter((name) => {
				return (name.indexOf("TRANS") === -1 &&
					name.indexOf("NONE") === -1 &&
					name.indexOf("CLEAR") === -1);
			});

			return CMColor[colorArray[CMRandom.range(0, colorArray.length)]];
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
			let colorArray = Object.keys(CMColor).filter((name) => {
				return !(name.match(/GRAY|BLACK|WHITE|SAND|TRANS|NONE|CLEAR/));
			});

			return CMColor[colorArray[CMRandom.range(0, colorArray.length)]];
		}
	},

	/**
	 * Randomly picks an opaque rgb gray, black, or white
	 * color from our predefined swatch, 
	 * @returns {string}
	 */
	grayscale: {
		get: function() {
			let colorArray = Object.keys(CMColor).filter((name) => {
				return !!(name.match(/GRAY|BLACK|WHITE/));
			});

			return CMColor[colorArray[CMRandom.range(0, colorArray.length)]];
		}
	},

	/**
	 * Randomly picks a sign (1 or -1; not 0) to
	 * assign to a positive integer.
	 * @returns {number}
	 */
	sign: {
		get: function() {
			return (-1)**CMRandom.range(0, 2);
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

		// A point, CMPoint instance, or similar object was passed in
		if(typeof x === "object") {
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
			!CMGame.roundSmall( this.x - otherPoint.x ) &&
			!CMGame.roundSmall( this.y - otherPoint.y ) &&
			!CMGame.roundSmall( this.z - otherZ )
		);
	}
}

// Note: this assumes a single game is being loaded, as expected
let domLoaded = false,
	numAudiosToLoad = 0,
	numAudiosLoaded = 0,
	numImagesToLoad = 0,
	numImagesLoaded = 0;

// Extend Image class to manage preloading
class CMImage extends Image {
	/**
	 * Creates a CMImage instance
	 * @param {string|object} imageSrc - The image's location, or an existing CMImage instance
	 */
	constructor(imageSrc) {
		super();

		// Has already been defined
		if(imageSrc instanceof CMImage) {
			return this;
		}

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
class CMAudio extends Audio {
	/**
	 * Creates a CMAudio instance
	 * @param {string|object} audioSrc - The audio file's location, or an existing CMImage instance
	 * @param {string} [preferredName|null] - A key the dev can use to call this
	 *   resource, e.g., game.playSound("guns"); rather than
	 *   game.playSound("audio/shots_2R3t.wav");
	 *   If not provided, the filename (without extension or path) is used,
	 *   e.g., "shots_2R3t" for the example above.
	 * @param {object} game - The current CMGame instance using this audio
	 */
	constructor(audioSrc, preferredName, game) {
		super();

		// Has already been defined
		if(audioSrc instanceof CMAudio) {
			return this;
		}

		numAudiosToLoad++;

		let progress = document.getElementById("cmLoadingProgress");
		if(progress !==  null) {
			progress.setAttribute("max", numImagesToLoad + numAudiosToLoad + 1); // +1 for domLoaded
		}

		this.oncanplaythrough = registerAudioLoad;
		this.src = audioSrc;
		this.load();

		let keyString = CMGame.trimFilename(audioSrc);

		if(typeof preferredName === "string") {
			game.audioMap.set(preferredName, this);
			CMSound.load(audioSrc, preferredName);
		}
		else { // preferredName and game are the same argument
			game.audioMap.set(keyString, this);
			CMSound.load(audioSrc);
		}
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
				splashPage.classList.remove("cm-intro-fade");
				splashPage.style.display = "none";
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
	/**
	 * Creates a CMDoodle instance
	 * @param {object} game - The current CMGame instance
	 * @param {object} [options] - A plain JS object of drawing options
	 * @param {object} [options.startPoint] - The screen (x, y) position of the initial point drawn
	 * @param {number} [options.lineWidth] - Thickness (in pixels) of the drawn curves
	 * @param {string} [options.strokeStyle] - Color string for curve color
	 * @param {string} [options.fillStyle] - Color string to "fill" closed area with
	 * @param {string} [options.fillStyleAbove] - Color string to fill screen above this drawn curve
	 * @param {string} [options.fillStyleBelow] - Color string to fill screen below this drawn curve
	 * @param {string} [options.fillStyleLeft] - Color string to fill screen left of this drawn curve
	 * @param {string} [options.fillStyleRight] - Color string to fill screen right of this drawn curve
	 */
	constructor(game, options) {
		this.game = game;

		let opts = {};
		let defaults = {
			startPoint: null,
			lineWidth: Math.max(game.ctx.lineWidth, 1),
			strokeStyle: CMColor.BLACK,
			fillStyle: CMColor.NONE,
			fillStyleAbove: CMColor.NONE,
			fillStyleBelow: CMColor.NONE,
			fillStyleLeft: CMColor.NONE,
			fillStyleRight: CMColor.NONE
		};

		for(let key in defaults) {
			if(typeof options[key] !== "undefined") {
				opts[key] = options[key];
			}
			else {
				opts[key] = defaults[key];
			}
		}

		this.startPoint = opts.startPoint;
		this.lineWidth = opts.lineWidth;
		this.strokeStyle = opts.strokeStyle;
		this.fillStyleAbove = opts.fillStyleAbove;
		this.fillStyleBelow = opts.fillStyleBelow;
		this.fillStyleLeft = opts.fillStyleLeft;
		this.fillStyleRight = opts.fillStyleRight;
		this.fillStyle = opts.fillStyle;

		this.points = [ this.startPoint ];

		this.path = new Path2D();
		this.path.moveTo(this.startPoint.x, this.startPoint.y);
		this.pathAbove = new Path2D();
		this.pathBelow = new Path2D();
		this.pathLeft = new Path2D();
		this.pathRight = new Path2D();

		// game.currentDoodle = this; // Moved to within game. Superfluous here
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
	 * @param {number|object} xOrPoint - The x value, or point-like object
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

		// Do not add same point twice in a row
		if(!this.points[this.points.length - 1].isPoint(point)) {
			this.points.push(new CMPoint(point));
			this.path.lineTo(point.x, point.y);
			this.rebuildPath();
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
	 * Determines if a given point is in this doodle's stroke path
	 * @param {number|object} xOrPoint - The x value, or point object
	 * @param {number} [y] - The y value (if xOrPoint is not a point)
	 * @returns {boolean}
	 */
	intersectsPoint(xOrPoint, y) {
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
		let isPointHere = game.ctx.isPointInStroke(this.path, point.x, point.y);
		this.game.ctx.restore();
		return isPointHere;
	}

	/**
	 * Determines if a given point is in this doodle's fill path. Note:
	 * this may not be verty reliable on complex shapes.
	 * @param {number|object} xOrPoint - The x value, or point object
	 * @param {number} [y] - The y value (if xOrPoint is not a point)
	 * @returns {boolean}
	 */
	containsPoint(xOrPoint, y) {
		let pointToCheck = {};
		if(typeof xOrPoint === "number") {
			pointToCheck = {
				x: xOrPoint,
				y: y
			};
		}
		else {
			pointToCheck = xOrPoint;
		}

		this.game.ctx.save();
		this.game.ctx.lineWidth = this.lineWidth;
		let isPointHere = game.ctx.isPointInPath(this.path, pointToCheck.x, pointToCheck.y);
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

		if(this.fillStyleBelow && this.fillStyleBelow !== CMColor.NONE) {
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

		if(this.fillStyleAbove && this.fillStyleAbove !== CMColor.NONE) {

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

		if(this.fillStyleLeft && this.fillStyleLeft !== CMColor.NONE) {
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

		if(this.fillStyleRight && this.fillStyleRight !== CMColor.NONE) {
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
	draw(ctx=this.game.offscreenCtx) {
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

			if(this.fillStyle && this.fillStyle !== CMColor.NONE) {
				ctx.fillStyle = this.fillStyle;
				ctx.fill(this.path);
			}

			ctx.stroke(this.path);
		}
		else
		if(this.points.length === 1) { // Single point does not show up in stroke
			ctx.fillStyle = this.strokeStyle;
			ctx.fillRect(this.points[0].x, this.points[0].y, Math.max(.5 * this.lineWidth, 1), Math.max(.5 * this.lineWidth, 1));
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
	 * @param {number} x - x value of the swipe's endpoint
	 * @param {number} y - y value of the swipe's endpoint
	 * @param {number} oldX - x value of the swipe's starting point
	 * @param {number} oldY - y value of the swipe's starting point
	 */
	constructor(game, x, y, oldX, oldY) {
		this.game = game;
		this.x = x;
		this.y = y;
		this.oldX = oldX;
		this.oldY = oldY;
		this.offsetX = this.x - this.oldX;
		this.offsetY = this.y - this.oldY;

		this.angle = this.game.toPolar(new CMPoint(x - oldX, y - oldY)).theta;

		this.direction = this.getDirection(oldX, oldY, x, y); // "left", "up", "down", "right"
		this.direction8 = this.getDirection8(oldX, oldY, x, y); // "left", "up", "upleft", "downright" , etc.

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
	 * @param {number} x - The swipe's ending point's x value
	 * @param {number} y - The swipe's ending point's y value
	 * @returns {string}
	 */
	getDirection(oldX, oldY, x, y) {
		let angle = this.angle;

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
	 * @param {number} x - The swipe's ending point's x value
	 * @param {number} y - The swipe's ending point's y value
	 * @returns {string}
	 */
	getDirection8(oldX, oldY, x, y) {
		let angle = this.angle;
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

/** A class to manage all game objects and processes */
class CMGame {
	/**
	 * Creates a CMGame instance. This essentially creates the current game.
	 * @param {object} [options] - A plain JS object of options. All are optional, including this object.
	 * @param {object|string} [options.startBtn] - An HTML element (or CSS selector for that element) that will be used to start the game, or an array of any combination of elements and selectors. Defaults to null, and game starts on first user interaction.
	 * @param {boolean} [options.options.fullscreen] - If true, the game will attempt to enter fullscreen browser mode on first user interaction (this does not necessarily change the canvas size itself; it only performs browser-specific actions like removing the address bar). Results vary by browser. Default is false.
	 * @param {string} [options.orientation] - A string, desired orientation when entering fullscreen. Only makes sense when fullscreen features are being used. Examples: "portrait", "landscape"
	 * @param {object|string} [options.enterFullscreenBtn] - An HTML element (or CSS selector for that element) to be used to enter fullscreen when user clicks. Default is null.
	 * @param {object|string} [options.exitFullscreenBtn] - An HTML element (or CSS selector for that element) to be used to exit fullscreen when user clicks. Default is null.
	 * @param {object|string} [options.screenshotBtn] - An HTML element (or CSS selector for that element) to be used to capture an in-game screenshot when user clicks.
	 * @param {string} [options.type] - A string describing the type of math game. Available options are "graph" (standard 2D Cartesian graph system), "venn" (Venn Diagrams), "graphtheory" (A system of vertices and edges, as presented in Graph Theory), or "none" (no math-specific resources, in case you just want to use this to make a basic game or animation). Since this engine is geared toward math games, "graph" is the default.
	 * @param {object} [options.images] - A plain JS object of images that may need preloading. Define these with the key being how you want to access the image later, and the value being the image's source path.
	 * @param {object} [options.audios] - A plain JS object of audio files that may need preloading. You can define these similar to images, by providing your string identifier in an object, or by listing the full file paths in an array, but you reference them using CMGame methods rather than accessing directly game.playSound(soundPath). This allows us internally to load the best playback option for the current environment.
	 * @param {function} [options.onload] - A function to call when the game's constructor has completed setup. Thus this only occurs as a constructor option, and is never used again in game's lifecycle.
	 * @param {array} [options.hideOnStart] - An array of HTML elements (or CSS selectors defining each) to be hidden from the screen when the game starts (e.g., when user presses Start button)
	 * @param {number} [options.tickDistance] - How many pixels apart x-axis (and y-axis) tick marks are from each other. Default is 20.
	 * @param {number} [options.gridlineDistance] - How many pixels apart graph gridlines should be (vertically or horizontally). Default is 20.
	 * @param {number} [options.graphScalar] - How much real numbers are scaled into the number of pixels on screen. For instance, if this is 30, then there will be 30 pixels between the point (0, 0) and the point (1, 0). Note: if your graphScalar and tickDistance do not match, this may be confusing to the user. Try to keep one a multiple of the other.
	 * @param {number} [options.tickFontSize] - Font size to draw tick marks. Default is based on tickDistance.
	 * @param {function|boolean} [options.tickLabelIf] - A function to check, taking current tick value as only parameter, returning true if label should be drawn or custom string to draw, or
	 *   false to draw nothing. A boolean can be provided as shorthand for a function always returning that boolean. Defaults to drawing all values on tick marks.
	 * @param {function|boolean} [options.tickLabelIfX] - Similar to options.tickLabelIf, but only for x-axis values. Defaults to options.tickLabelIf.
	 * @param {function|boolean} [options.tickLabelIfY] - Similar to options.tickLabelIf, but only for y-axis values. Defaults to options.tickLabelIf.
	 * @param {function|boolean} [options.tickLabelIfOrigin] - Similar to tickLabelIfX with specific designation to 0, which is by default not drawn.
	 * @param {number} [options.tickFontSize] - Preferred font size (in pixels) of font displaying tick values 
	 * @param {boolean} [options.soundOn] - true to allow sound effects to play, false to mute them. Defaults to false. Note: most browsers require user interaction before playing sound (having a start button to click is an easy way to overcome this).
	 * @param {boolean} [options.musicOn] - true to allow music (generally longer sound files) to play, false to mute them. Defaults to false. Note: most browsers require user interaction before playing sound (having a start button to click is an easy way to overcome this).
	 * @param {string} [options.saveName] - A string to use as the localStorage key for saving this game's state details. Essentially your "save file name". If not provided, one will be generated. (If you do not invoke save() or load() methods this value is never used)
	 * @param {number} [options.frameCap] - During each animation cycle, the game stores an internal frameCount variable tracking how many animation frames have passed. The dev may find this useful for certain cases like animations. If the game is long, you may want to prevent this value from becoming unbounded, by setting this frameCap to some positive integer, because the default is Infinity.
	 * @param {number} [options.width] - Desired game width in pixels (defaults to canvas width)
	 * @param {number} [options.height] - Desired game height in pixels (defaults to canvas height)
	 * @param {boolean} [options.overrideStyles] - If true, suppresses warnings when dev does not include CMGame stylesheet. Default is false.
	 * @param {boolean} [options.overrideResize] - If true, gives dev full command of canvas sizing and positioning. Default is false.
	 * @param {boolean} [options.allowContextMenu] - If true, lets right-click show context (e.g., to let user download canvas as an image). Default is false.
	 * @param {number[]} [options.originByRatio] - An array allowing you to define the Cartesian "origin" on screen based on game dimensions. This array has 2 elements: the first is a scalar to multiply by the canvas width to get the origin's x position on screen. The second element does the same with y using the game's height. Defaults to [0.5, 0.5] (i.e., the center point on the screen, or [half the width, half the height].
	 * @param {number[]|object} [options.origin] - An array, similar to originByRatio, but takes in actual x and y position, rather than scalars; or an object with x and y values. Defaults to game's center point.
	 * @param {object|string} [options.wrapper] - An HTML element (or CSS selector for that element) to be used as the canvas "host" or "wrapper" element, used for CSS scaling. If this option is not present, the game looks for an element with id "cmWrapper". If none is found, the game creates and adds a new div to take the role. Default is null.
	 * @param {object|string} [options.canvas] - An HTML element (or CSS selector for that element) to be used as the visible output canvas element for all game drawing. If this option is not present, the game looks for an element with id "cmCanvas". If none is found, the game creates and adds a new div to take the role. Default is null.
	 * @param {object|string} [options.backgroundCanvas] - An HTML element (or CSS selector for that element) to be used as the output canvas element for the game's background. If this option is not present, we assume there is no background canvas. Default is null.
	 * @param {object|string} [options.pressElement:]An HTML element (or CSS selector for that element) defining the element to be used for mouse/touch events. Defaults to the game's canvas (as expected). This option should only be used if you need touch/mouse events handled outside the actual game.
	 * @param {string} [options.tickStyle] - A color string for the Cartesian grid tick marks on the axes. Defaults to CMColor.DARK_GRAY.
	 * @param {string} [options.tickStyleX] - A color string for the Cartesian grid tick marks on the x axis. Defaults to determined `tickStyle` value.
	 * @param {string} [options.tickStyleY] - A color string for the Cartesian grid tick marks on the y axis. Defaults to determined `tickStyle` value.
	 * @param {string} [options.tickStyleOrigin] - A color string for the Cartesian grid tick mark for the centered origin (e.g., for charts with no y-axis). Defaults to CMColor.NONE.
	 * @param {string} [options.tickLabelStyle] - A color string for the Cartesian grid tick labels on the axes. Defaults to CMColor.DARK_GRAY.
	 * @param {string} [options.tickLabelStyleX] - A color string for the Cartesian grid tick labels on the x axis. Defaults to determined `tickLabelStyle` value.
	 * @param {string} [options.tickLabelStyleY] - A color string for the Cartesian grid tick labels on the y axis. Defaults to determined `tickLabelStyle` value.
	 * @param {string} [options.tickLabelStyleOrigin] - A color string for the Cartesian grid tick label representing the point (0, 0)
	 * @param {string} [options.xAxisStyle] - A color string for the line defining the x-axis. Defaults to CMColor.GRAY.
	 * @param {string} [options.yAxisStyle] - A color string for the line defining the y-axis. Defaults to CMColor.GRAY.
	 * @param {string} [options.gridStyle] - A color string for the Cartesian grid graph lines. Defaults to CMColor.LIGHT_GRAY.
	 * @param {string} [options.gridlineWidth] - The lineWidth to use for drawn Cartesian grid graph lines
	 * @param {boolean} [options.ignoreNumLock] - A boolean, for keyboard-based games. true if you want numpad arrows to always register as direction (even when NumLock is on); false if you want NumLock to force those keys to register as numbers. Default is false.
	 * @param {boolean} [options.multiTouch] - A boolean; true if you want every touch to register a new event even if touches are simultaneous; false to allow one touch/mouse press event at a time. Default is false, as this allows desktop and mobile experiences to be similar.
	 * @param {object} [options.doodleOptions] - A plain JS object defining whether the user can draw in the current game.
	 * @param {boolean} [options.doodleOptions.enabled] - Whether or not user can current "doodle" on the game screen. Defaults to false.
	 * @param {number} [options.doodleOptions.lineWidth] - Number of pixels wide these drawing lines should be.
	 * @param {string} [options.doodleOptions.strokeStyle] - Color string used to draw the new doodle. Default is CMColor.BLACK.
	 * @param {string} [options.doodleOptions.fillStyleAbove] - Color to (try and) fill above the drawn line. May be buggy. Defaults to CMColor.NONE.
	 * @param {string} [options.doodleOptions.fillStyleBelow] - Color to (try and) fill below the drawn line. May be buggy. Defaults to CMColor.NONE.
	 * @param {string} [options.doodleOptions.fillStyleLeft] - Color to (try and) fill to the left of the drawn line. May be buggy. Defaults to CMColor.NONE.
	 * @param {string} [options.doodleOptions.fillStyleRight] - Color to (try and) fill to the right of the drawn line. May be buggy. Defaults to CMColor.NONE.
	 * @param {function} [options.ontouchstart] - Custom callback called for touchstart event. Generally use onpressstart instead.
	 * @param {function} [options.ontouchmove] - Custom callback called for touchmove event. Generally use onpressmove instead.
	 * @param {function} [options.ontouchend] - Custom callback called for touchend event. Generally use onpressend instead.
	 * @param {function} [options.onmousedown] - Custom callback called for mousestart event. Generally use onpressstart instead.
	 * @param {function} [options.onmousemove] - Custom callback called for mousemove event. Generally use onpressmove instead.
	 * @param {function} [options.onmouseup] - Custom callback called for mouseend event. Generally use onpressend instead.
	 * @param {function} [options.onclick] - Custom callback called for a click event. Generally use onpressstart instead.
	 * @param {function} [options.onrightclick] - Custom callback called for a click event when right (or auxiliary) mouse button is
	 *   clicked. Generally use onpressstart instead. You can check for right click with: this.mouseStateString === "00010"
	 * @param {function} [options.onpressstart] - Callback to perform when canvas is touched or mouse is pressed
	 * @param {function} [options.onpressmove] - Callback to perform when finger on canvas is moved or mouse is moved while pressed
	 * @param {function} [options.onpressend] - Callback to perform when finger on canvas is lifted or mouse is released
	 * @param {function} [options.onswipe] - Callback to perform when finger on canvas is moved or mouse is moved while
	 *   pressed and distance is at least CMGame.PIXELS_FOR_SWIPE. Callback takes a CMSwipe instance as only argument.
	 * @param {function} [options.ondblclick] - Callback to perform if canvas is double-clicked with mouse or finger
	 * @param {function} [options.onkeydown] - Callback to perform when keyboard key is pressed. Argument is key event, with additional
	 *   property "direction" which maps arrow keys and standard ASDW keys to "left", "down", "right", "up"
	 * @param {function} [options.onkeyup] - Callback to perform when keyboard key is released. Argument is key event, with additional
	 *   property "direction" which maps arrow keys and standard ASDW keys to "left", "down", "right", "up"
	 * @param {function} [options.onbeforestart] - Callback to perform just before .start() actions are applied (like hiding elements and starting animations). Pressed button that triggered start is passed as the single (optional) parameter.
	 * @param {function} [options.onstart] - Callback to perform just as game starts (elements are hidden, first animation frame has been requested). Pressed button that triggered start is passed as the single (optional) parameter.
	 * @param {function} [options.onbeforeupdate] - Callback to perform just before state is updated for current animation frame.
	 * @param {function} [options.onupdate] - Callback to perform at the end of each update() call for this CMGame instance
	 * @param {function} [options.onbeforedraw] - Callback to perform just before a frame is drawn, but immediately after previous is cleared
	 * @param {function} [options.ondraw] - Callback to perform at the end of each draw() call for this CMGame instance
	 * @param {function} [options.onload] - Callback to perform after all other process in this constructor have been performed, except those involved in "debug"
	 * @param {boolean} [options.debug] - Set to true when testing/debugging. This hides loading screens,
	 *   and immediately starts game (no need for button clicks, etc.), and changes some hidden
	 *   screen elements (like graph grid) to show slightly.
	 * @param {object} [options.debugOptions] - When `debug` is set to true, any options that are set in
	 *   this plain JavaScript object will replace the property with the same key passed into the constructor.
	 * @returns {object} The created CMGame instance for chaining
	 */
	constructor(options={}) {
		let self = this;

		this.debug = !!options.debug;

		if(this.debug && typeof options.debugOptions === "object") {
			for(let key of Object.keys(options.debugOptions)) {
				if(key !== "debugOptions") {
					options[key] = options.debugOptions[key];
				}
			}
		}

		this.images = {};
		this.audios = {}; // Used internally as a fallback when `fetch` won't happen
		this.audioSources = {}; // Used to map key/id/name to source string
		this.audioMap = new Map(); // Main audio object; used for best performance

		if(Array.isArray(options.images)) {
			for(let i = 0; i < options.images.length; i++) {
				let keyString = CMGame.trimFilename( options.images[i] );

				// Allow dev to access item by clipped filename or index in their array
				this.images[i] = this.images[keyString] =
						new CMImage(options.images[i]);
			}
		}
		else {
			for(let key in options.images) {
				this.images[key] = new CMImage(options.images[key]);
			}
		}

		// Note: this.audios is mainly used internally. Use playSound(), etc.
		if(Array.isArray(options.audios)) {
			for(let i = 0; i < options.audios.length; i++) {
				let keyString = CMGame.trimFilename( options.audios[i] );
				this.audios[i] = this.audios[keyString] =
						new CMAudio(options.audios[i], null, this);

				this.audioSources[ keyString ] = options.audios[i];
			}
		}
		else {
			for(let key in options.audios) {
				this.audios[key] = new CMAudio(options.audios[key], key, this);
				this.audioSources[ key ] = options.audios[key];
			}
		}

		/**
		 * For programming noobs, we keep things as
		 * simple as possible, so they don't have to
		 * add a link to the CSS file. However, we leave
		 * the option open for devs to use their own
		 * CSS by adding an "overrideStyles: true" option
		 * to the CMGame constructor options.
		 */
		if(typeof options.overrideStyles === "undefined") {
			if(![... document.styleSheets].find(stylesheet => stylesheet?.href?.match("cmgame.css") ) ) {
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

		// Note: even after setting sound and music on, will not play until user interaction with page
		this.soundOn = options.soundOn || false;
		this.musicOn = options.musicOn || false;
		this.orientation = options.orientation || null;
		this.saveName = options.saveName || "";
		this.state = options.state || {};

		this.multiTouch = !!options.multiTouch;

		this.gridStyle = CMColor.LIGHT_GRAY;
		this.xAxisStyle = CMColor.GRAY;
		this.yAxisStyle = CMColor.GRAY;

		this.tickStyleX = CMColor.DARK_GRAY;
		this.tickStyleY = CMColor.DARK_GRAY;
		this.tickStyle = CMColor.DARK_GRAY;
		this.tickStyleOrigin = options.tickStyleOrigin || CMColor.NONE;
		this.tickLabelStyleX = CMColor.DARK_GRAY;
		this.tickLabelStyleY = CMColor.DARK_GRAY;
		this.tickLabelStyle = CMColor.DARK_GRAY;
		this.tickLabelStyleOrigin = CMColor.NONE;

		this.gridlineWidth = 1;

		if(typeof options.tickFontSize === "number") {
			this.tickFontSize = options.tickFontSize;
		}

		this.tickLabelIf = null;
		this.tickLabelIfX = null;
		this.tickLabelIfY = null;
		this.tickLabelIfOrigin = null;

		if(typeof options.tickLabelIf === "function") {
			this.tickLabelIf = options.tickLabelIf;
		}
		else
		if(Array.isArray(options.tickLabelIf)) {
			this.tickLabelIf = function(input) {
				return options.tickLabelIf.includes(input);
			};
		}
		else
		if(typeof options.tickLabelIf === "boolean") {
			this.tickLabelIf = function(input) { return options.tickLabelIf; };
		}
		else {
			this.tickLabelIf = function(input) { return true; };
		}

		if(typeof options.tickLabelIfX === "function") {
			this.tickLabelIfX = options.tickLabelIfX;
		}
		else
		if(Array.isArray(options.tickLabelIfX)) {
			this.tickLabelIfX = function(input) {
				return options.tickLabelIfX.includes(input);
			};
		}
		else
		if(typeof options.tickLabelIfX === "boolean") {
			this.tickLabelIfX = function(input) { return options.tickLabelIfX; };
		}
		else { // Default to letting tickLabelIf define X as well
			this.tickLabelIfX = this.tickLabelIf;
		}

		if(typeof options.tickLabelIfY === "function") {
			this.tickLabelIfY = options.tickLabelIfY;
		}
		else
		if(Array.isArray(options.tickLabelIfY)) {
			this.tickLabelIfY = function(input) {
				return options.tickLabelIfY.includes(input);
			};
		}
		else
		if(typeof options.tickLabelIfY === "boolean") {
			this.tickLabelIfY = function(input) { return options.tickLabelIfY; };
		}
		else { // Default to letting tickLabelIf define Y as well
			this.tickLabelIfY = this.tickLabelIf;
		}

		if(typeof options.tickLabelIfOrigin === "function") {
			this.tickLabelIfOrigin = options.tickLabelIfOrigin;
		}
		else
		if(typeof options.tickLabelIfOrigin === "boolean") {
			this.tickLabelIfOrigin = function(input) { return options.tickLabelIfOrigin; };
		}
		else { // Default to not showing the origin label (this usually looks cleaner)
			this.tickLabelIfOrigin = () => false;
		}

		if(typeof options.gridStyle !== "undefined") {
			this.gridStyle = options.gridStyle;
		}

		if(typeof options.gridlineWidth !== "undefined") {
			this.gridlineWidth = options.gridlineWidth;
		}

		if(typeof options.xAxisStyle !== "undefined") {
			this.xAxisStyle = options.xAxisStyle;
		}

		if(typeof options.yAxisStyle !== "undefined") {
			this.yAxisStyle = options.yAxisStyle;
		}

		if(typeof options.tickStyle !== "undefined") {
			this.tickStyle = options.tickStyle;
		}

		this.tickStyleX = options.tickStyleX || this.tickStyle;
		this.tickStyleY = options.tickStyleY || this.tickStyle;

		this.tickLabelStyleOrigin = options.tickLabelStyleOrigin || CMColor.NONE;

		if(typeof options.tickLabelStyle !== "undefined") {
			this.tickLabelStyle = options.tickLabelStyle;
		}

		this.tickLabelStyleX = options.tickLabelStyleX || this.tickLabelStyle;
		this.tickLabelStyleY = options.tickLabelStyleY || this.tickLabelStyle;

		this.fullscreen = false;
		if(typeof options.fullscreen !== "undefined") {
			this.fullscreen = options.fullscreen;
		}

		this.type = options.type || "graph";

		/**
		 * `ignoreNumLock` being true always
		 * registers numpad keys as relevant
		 * directions. Otherwise, they register
		 * as arrows only when NumLock is off.
		 */
		this.ignoreNumLock = false;
		if(typeof options.ignoreNumLock !== "undefined") {
			this.ignoreNumLock = !!options.ignoreNumLock;
		}

		// origin defaults to middle of canvas
		this.originByRatio = options.originByRatio || [0.5, 0.5];

		this.sprites = []; /* CMSprite */
		this.functions = []; /* CMFunction */
		this.tickDistance = (typeof options.tickDistance === "number") ? options.tickDistance : 20;
		this.gridlineDistance = (typeof options.gridlineDistance === "number") ?
			options.gridlineDistance :
				(this.tickDistance >= 40 ? this.tickDistance / 2 :
					this.tickDistance);

		this.graphScalar = options.graphScalar || this.gridlineDistance;
		this.graphScalar_Private = this.graphScalar;

		// CSS scaling for display; separate from graph - do not override
		this.screenScalar = 1.0;

		this.mouseState = Array(5).fill(0);
		this.mouseStateString = "00000";
		this.started = false;
		this.paused = true;
		this.animFrameId = null;

		this.frameDelay_Private = CMGame.MIN_FRAME_DELAY;
		this.fps_Private = options.fps || CMGame.MAX_FPS;

		this.gameOver = false;
		this.frameCount = 0;

		// The default here is arbitrary. For a long game letting this go indefinitely could hurt performance
		this.frameCap = (typeof options.frameCap === "number") ? options.frameCap : 100000;

		this.leftMousePressed = false; // Detects if mouse is down to simulate a finger swipe
		this.rightMousePressed = false;
		this.middleMousePressed = false;

		this.trackedScreenTouches = {}; // Will be used for multi-touch. Not currently used.

		// Mainly used to detect how many mouse buttons are pressed, or fingers are down
		this.numPressPoints = 0;

		this.latestPoint = null; // Used for identifying swipe actions
		this.latestSwipes = []; // Stores all swipes until lift, for complex swipe actions
		this.latestSwipeStrings = []; // Similar to latestSwipes, but only stores directions
		this.latestSwipeStrings8 = []; // Similar to latestSwipeStrings, with 8 directions

		this.latestSwipePath = []; // Similar to latestSwipeStrings, but discarding consecutive repeats
		this.latestSwipePath8 = []; // Similar to latestSwipePath, with 8 directions

		this.hideOnStart = options.hideOnStart;

		this.wrapper = null;
		switch(typeof options.wrapper) {
			case "object":
				this.wrapper = options.wrapper;
				break;
			case "string":
				this.wrapper = document.querySelector(options.wrapper);
				if(this.canvas === null) {
					console.error(options.wrapper + " is not a valid CSS selector, or returned null");
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
			documentBody.appendChild(this.wrapper);
		}

		this.canvas = null;
		switch(typeof options.canvas) {
			case "object":
				this.canvas = options.canvas;
				break;
			case "string":
				this.canvas = document.querySelector(options.canvas);
				if(this.canvas === null) {
					console.error(options.canvas + " is not a valid CSS selector, or returned null");
				}
				break;
			default: {
				this.canvas = document.getElementById("cmCanvas") ||
					document.querySelector("canvas");
				break;
			}
		}

		if(this.canvas) { // some DOM element exists, so use its dimensions
			if(typeof options.width === "undefined") {
				options.width = this.canvas.width;
			}

			if(typeof options.height === "undefined") {
				options.height = this.canvas.height;
			}
		}
		else { // no <canvas> in HTML, and no option specified. Build our own.
			this.canvas = document.createElement("canvas");
			options.width = options.width || 640;
			options.height = options.height || 480;
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
		switch(typeof options.backgroundCanvas) {
			case "object":
				this.backgroundCanvas = options.backgroundCanvas;
				break;
			case "string":
				this.backgroundCanvas = document.querySelector(options.backgroundCanvas);
				if(this.backgroundCanvas === null) {
					console.error(options.backgroundCanvas + " is not a valid CSS selector, or returned null");
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

		this.devicePixelRatio = window.devicePixelRatio || 1;

		// store initial <canvas> dimensions for screen resizing
		this.canvasReferenceWidth = options.width || 640;
		this.canvasReferenceHeight = options.height || 480;
		this.width = this.canvasReferenceWidth;
		this.height = this.canvasReferenceHeight;

		this.canvas.style.width = this.width + "px";
		this.canvas.style.height = this.height + "px"

		/**
		 * Consider multiplying by devicePixelRatio here, as the output looks nicer (but
		 * values become complicated- for instance, drawStringsCentered would need
		 * to be modified, as text is no longer centered)
		 */
		this.canvas.width = this.width;
		this.canvas.height = this.height;

		if(this.backgroundCanvas) {
			this.backgroundCanvas.style.width = this.width + "px";
			this.backgroundCanvas.style.height = this.height + "px"

			this.backgroundCanvas.width = this.width * this.devicePixelRatio;
			this.backgroundCanvas.height = this.height * this.devicePixelRatio;
		}

		/** Create an offscreen canvas for drawing optimization */
		this.offscreenCanvas = document.createElement("canvas");
		this.offscreenCtx = this.offscreenCanvas.getContext("2d");

		this.offscreenCanvas.style.width = this.width + "px";
		this.offscreenCanvas.style.height = this.height + "px";

		this.offscreenCanvas.width = Math.floor(this.canvas.width * this.devicePixelRatio);
		this.offscreenCanvas.height = Math.floor(this.canvas.height * this.devicePixelRatio);

		this.spriteWorkCanvas = document.createElement("canvas");
		this.spriteWorkCtx = this.spriteWorkCanvas.getContext("2d");

		// store origin an center as CMPoints in case we wish to check for instance this.origin.isPoint( this.center );
		this.origin = null;
		if(Array.isArray(options.origin)) {
			this.origin = new CMPoint(
				options.origin[0],
				options.origin[1],
				0);
		}
		else
		if(typeof options.origin === "object") {
			this.origin = new CMPoint(
				options.origin.x,
				options.origin.y,
				0
			);
		}
		else { // No origin specified directly
			this.origin = new CMPoint(
				this.originByRatio[0] * this.width,
				this.originByRatio[1] * this.height
			);
		}

		// Game size does not change, only scales via CSS. So these values should not change
		this.center = Object.freeze(new CMPoint(
			.5 * this.width,
			.5 * this.height
		));

		// Values for "passive" touch events, suggested for touch surfaces
		this.supportsPassive = false; // Current OS supposedly supports passive events
		this.passiveFlag = false; // Actual options to pass in for touch events (differs for iOS, arrgh)

		/** Dev may want to allow context menu for downloading screenshot */
		if(!options.allowContextMenu) {

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
			if(!CMGame.running_Android) {
				window.addEventListener("contextmenu", overrideContext, false);
				this.canvas.addEventListener("contextmenu", overrideContext, false);
			}

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
						 *   Settings -> Haptic & 3D Touch -> Off (also Vibration -> Off)
						 */
						if(!CMGame.running_iOS) {
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
		switch(typeof options.pressElement) {
			case "object":
				this.pressElement = options.pressElement;
				break;
			case "string":
				this.pressElement = document.querySelector(options.pressElement);
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
		this.pressElement.addEventListener("touchend", function(e) {
			/**
			 * Preventing default should generally prevent a touch
			 * registering as a mouse click.
			 */
			if(e.cancelable && !options.allowContextMenu)
				e.preventDefault();

			self.touchEnd.call(self, e);
		}, false);
		this.pressElement.addEventListener("mouseup", self.mouseUp.bind(self), false);
		this.pressElement.addEventListener("click", self.click.bind(self), false);
		this.pressElement.addEventListener("dblclick", self.dblClick.bind(self), false);

		window.addEventListener("keydown", self.keyDown.bind(self), false);
		window.addEventListener("keyup", self.keyUp.bind(self), false);

		if(!options.overrideResize) {
			window.addEventListener("resize", self.resizeCanvas.bind(self), false);
			this.resizeCanvas.call(this); // for loaded screen size
		}

		// This property is only really used here, and is used to pause game on browser tab change etc.
		this.unpausedWhenVisible = true;
		window.addEventListener("visibilitychange", e => {
			if(document.visibilityState === "visible") {
				if(self.unpausedWhenVisible) {
					self.unpause();
				}
			}
			else
			if(document.visibilityState === "hidden") {
				self.unpausedWhenVisible = !self.paused;
				if(self.unpausedWhenVisible) {
					self.pause();
				}
			}
		}, false);

		// Handle fullscreen and orientation setting processes
		this.orientationLock = screen.lockOrientation || screen.mozLockOrientation || screen.msLockOrientation || null;

		if(!this.orientationLock && screen.orientation) {
			this.orientationLock = screen.orientation.lock || CMGame.noop;
		}

		this.runCycle = this.updateAndDraw.bind(this);

		this.startBtn = null;
		if(Array.isArray(options.startBtn)) {
			options.startBtn.forEach((desc, idx) => {
				let btn;
				if(typeof desc === "string")
					btn = document.querySelector(desc);
				else
					btn = desc;

				// save first reference in case we need it for our fullscreen button
				if(idx === 0)
					this.startBtn = btn;

				if(btn === null)
					console.error("Cannot use null reference as start button.");
				else {
					btn.addEventListener("click", e => {
						e.preventDefault();
						self.start(btn);
					}, false);
				}
			});
		}
		else {
			switch(typeof options.startBtn) {
				case "object":
					this.startBtn = options.startBtn;
					break;
				case "string":
					this.startBtn = document.querySelector(options.startBtn);
					break;
				default: {
					this.startBtn = this.canvas;
					break;
				}
			}

			// Accept multiple inputs, e.g., ".start-buttons"
			if(typeof options.startBtn === "string" &&
					document.querySelectorAll(options.startBtn).length > 1) {

				document.querySelectorAll(options.startBtn).forEach(elm => {
						elm.addEventListener("click", e => {
							e.preventDefault();
							self.start(elm);
						}, false);
				});
			}
			else {
				this.startBtn.addEventListener("click", e => {
					e.preventDefault();
					self.start(self.startBtn);
				}, false);
			}
		}

		this.enterFullscreenBtn = null;
		this.exitFullscreenBtn = null;

		switch(typeof options.enterFullscreenBtn) {
			case "object":
				this.enterFullscreenBtn = options.enterFullscreenBtn;

				// defining the triggering element assumes you want fullscreen
				if(typeof this.fullscreen === "undefined") {
					this.fullscreen = true;
				}
				break;
			case "string":
				this.enterFullscreenBtn = document.querySelector(options.enterFullscreenBtn);

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

		switch(typeof options.exitFullscreenBtn) {
			case "object":
				this.exitFullscreenBtn = options.exitFullscreenBtn;
				break;
			case "string":
				this.exitFullscreenBtn = document.querySelector(options.exitFullscreenBtn);
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
		documentBody.appendChild(this.screenshotLink);

		this.screenshotBtn = null;
		if(options.screenshotBtn) {
			this.screenshotBtn = document.querySelector(options.screenshotBtn);

			this.screenshotBtn.addEventListener("click", (e) => {
				e.preventDefault();
				self.takeScreenshot();
			}, false);
		}

		this.videoRecorder = null;
		this.screenVideoLink = document.createElement("a");
		this.screenVideoLink.href = "";
		this.screenVideoLink.download = "cmgscreenvideo.mp4";
		this.screenVideoLink.style.display = "none";
		documentBody.appendChild(this.screenVideoLink);

		// For devs who just want the engine, no math drawing
		if(this.type === "none") {
			this.draw = function(ctx=this.offscreenCtx) {
				ctx.clearRect(0, 0,
					this.offscreenCanvas.width,
					this.offscreenCanvas.height);

				this.onbeforedraw(ctx);

				// Removed all built-in math drawing logic from here

				for(let sprite of this.sprites) {
					sprite.onbeforedraw(ctx);
					ctx.save();
					ctx.globalAlpha = sprite.opacity;
					sprite.draw(ctx);
					ctx.restore();
					sprite.ondraw(ctx);
				}

				for(let doodle of this.doodles) {
					doodle.draw(ctx);
				}

				this.ondraw(ctx);

				if(this.recordingVideo) {
					this.screenVideoCtx.clearRect(0, 0,
						this.screenVideoCanvas.width, this.screenVideoCanvas.height);

					this.screenVideoCtx.drawImage(game.canvas, this.screenVideoDetails.x, this.screenVideoDetails.y,
						this.screenVideoDetails.width, this.screenVideoDetails.height);
				}
			}
		}

		this.vennSets = null;
		this.vennRegions = null;
		this.vertices = [];
		this.edges = [];

		/**
		 * The game is optimized by type. If you want to use multiple types
		 * you can set type to "all" and it will combine all sprites, edges, etc.,
		 * but of course may run a little slower as it uses everything at
		 * once. That is useful for static drawing, like charts.
		 */

		// Create a Venn Diagram-based game
		switch(this.type) {
			case "venn": {

				this.vennSets = new Map(); // VennSet
				this.vennRegions = new Map(); // VennRegion

				this.setNumberOfSets(options.numSets || 0, options.variation || 0);

				/** Updates game state in current frame*/
				this.update = function(frameCount) {
					this.onbeforeupdate(frameCount);

					if(this.frameoutFunctions.has(frameCount)) {
						this.frameoutFunctions.get(frameCount).call(this, frameCount);

						// clean up, and prevent repeats in frameCap is finite
						this.frameoutFunctions.delete(frameCount);
					}

					for(let [id, vregion] of this.vennRegions) {
						vregion.update(frameCount);
					}

					for(let [name, vset] of this.vennSets) {
						vset.update(frameCount);
					}

					for(let sprite of this.sprites) {
						sprite.onbeforeupdate(frameCount);
						sprite.update(frameCount);
						sprite.onupdate(frameCount);
					}

					this.onupdate(frameCount);
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

					ctx.fillStyle = CMColor.BLACK;
					let fontSize = Math.floor(this.width / 16);
					ctx.font = `italic ${fontSize}px Times New Roman, serif`;
					ctx.fillText("U", this.width - fontSize * 1.5, fontSize * 1.25);

					for(let sprite of this.sprites) {
						sprite.onbeforedraw(ctx);
						ctx.save();
						ctx.globalAlpha = sprite.opacity;
						sprite.draw(ctx);
						ctx.restore();
						sprite.ondraw(ctx);
					}

					for(let doodle of this.doodles) {
						doodle.draw(ctx);
					}

					this.ondraw(ctx);

					if(this.recordingVideo) {
						this.screenVideoCtx.clearRect(0, 0,
							this.screenVideoCanvas.width, this.screenVideoCanvas.height);

						this.screenVideoCtx.drawImage(game.canvas, this.screenVideoDetails.x, this.screenVideoDetails.y,
							this.screenVideoDetails.width, this.screenVideoDetails.height);
					}
				};
			}
				break;
			case "graphtheory": {
				this.vertices = [];
				this.edges = [];

				/** Updates game state in current frame*/
				this.update = function(frameCount) {
					this.onbeforeupdate(frameCount);

					if(this.frameoutFunctions.has(frameCount)) {
						this.frameoutFunctions.get(frameCount).call(this, frameCount);

						// clean up, and prevent repeats in frameCap is finite
						this.frameoutFunctions.delete(frameCount);
					}

					for(let edge of this.edges) {
						edge.onbeforeupdate(frameCount);
						edge.update(frameCount);
						edge.onupdate(frameCount);
					}

					for(let vertex of this.vertices) {
						vertex.onbeforeupdate(frameCount);
						vertex.update(frameCount);
						vertex.onupdate(frameCount);
					}

					for(let sprite of this.sprites) {
						sprite.onbeforeupdate(frameCount);
						sprite.update(frameCount);
						sprite.onupdate(frameCount);
					}

					this.onupdate(frameCount);
				}

				this.draw = function(ctx=this.offscreenCtx) {
					ctx.clearRect(0, 0,
						this.offscreenCanvas.width,
						this.offscreenCanvas.height);

					this.onbeforedraw(ctx);

					for(let edge of this.edges) {
						edge.onbeforedraw(ctx);
						edge.draw(ctx);
						edge.ondraw(ctx);
					}

					for(let vertex of this.vertices) {
						vertex.onbeforedraw(ctx);
						vertex.draw(ctx);
						vertex.ondraw(ctx);
					}

					for(let sprite of this.sprites) {
						sprite.onbeforedraw(ctx);
						ctx.save();
						ctx.globalAlpha = sprite.opacity;
						sprite.draw(ctx);
						ctx.restore();
						sprite.ondraw(ctx);
					}

					for(let doodle of this.doodles) {
						doodle.draw(ctx);
					}

					this.ondraw(ctx);

					if(this.recordingVideo) {
						this.screenVideoCtx.clearRect(0, 0,
							this.screenVideoCanvas.width, this.screenVideoCanvas.height);

						this.screenVideoCtx.drawImage(game.canvas, this.screenVideoDetails.x, this.screenVideoDetails.y,
							this.screenVideoDetails.width, this.screenVideoDetails.height);
					}
				};
			}
				break;
			case "all": {

				// Need to manage CMFunctions, CMVennSets, CMVennRegions, CMVertices, CMEdges
				// 		CMSprites, CMDoodles

				this.vertices = [];
				this.edges = [];
				this.vennSets = new Map(); // VennSet
				this.vennRegions = new Map(); // VennRegion

				this.setNumberOfSets(options.numSets || 0, options.variation || 0);

				/** Updates game state in current frame*/
				this.update = function(frameCount) {
					this.onbeforeupdate(frameCount);

					if(this.frameoutFunctions.has(frameCount)) {
						this.frameoutFunctions.get(frameCount).call(this, frameCount);

						// clean up, and prevent repeats in frameCap is finite
						this.frameoutFunctions.delete(frameCount);
					}

					for(let [id, vregion] of this.vennRegions) {
						vregion.update(frameCount);
					}

					for(let [name, vset] of this.vennSets) {
						vset.update(frameCount);
					}

					for(let edge of this.edges) {
						edge.onbeforeupdate(frameCount);
						edge.update(frameCount);
						edge.onupdate(frameCount);
					}

					for(let vertex of this.vertices) {
						vertex.onbeforeupdate(frameCount);
						vertex.update(frameCount);
						vertex.onupdate(frameCount);
					}

					for(let sprite of this.sprites) {
						sprite.onbeforeupdate(frameCount);
						sprite.update(frameCount);
						sprite.onupdate(frameCount);
					}

					this.onupdate(frameCount);
				}

				this.draw = function(ctx=this.offscreenCtx) {
					ctx.clearRect(0, 0,
						this.offscreenCanvas.width,
						this.offscreenCanvas.height);

					this.onbeforedraw(ctx);

					// Background gridlines
					if(this.gridStyle && this.gridStyle !== CMColor.NONE) {
						ctx.strokeStyle = this.gridStyle;
						ctx.lineWidth = this.gridlineWidth;
						ctx.beginPath();

						// vertical lines, center to left
						for(let i = this.origin.x; i > 0; i -= this.gridlineDistance) {
							ctx.moveTo(i, 0);
							ctx.lineTo(i, this.canvas.height);
						}

						// vertical lines, center to right
						for(let i = this.origin.x; i < this.width; i += this.gridlineDistance) {
							ctx.moveTo(i, 0);
							ctx.lineTo(i, this.canvas.height);
						}

						// horizontal lines, center to top
						for(let i = this.origin.y; i > 0; i -= this.gridlineDistance) {
							ctx.moveTo(0, i);
							ctx.lineTo(this.canvas.width, i);
						}

						// horizontal lines, center to bottom
						for(let i = this.origin.y; i < this.height; i += this.gridlineDistance) {
							ctx.moveTo(0, i);
							ctx.lineTo(this.canvas.width, i);
						}

						ctx.stroke();
					}

					// Draw x and y axes
					// x axis
					if(this.xAxisStyle && this.xAxisStyle !== CMColor.NONE) {
						ctx.strokeStyle = this.xAxisStyle;

						this.drawLine(0, this.origin.y,
							this.width, this.origin.y);
					}

					// y axis
					if(this.yAxisStyle && this.yAxisStyle !== CMColor.NONE) {
						ctx.strokeStyle = this.yAxisStyle;
						
						this.drawLine(this.origin.x, 0,
							this.origin.x, this.height);	
					}

					// Draw tick marks
					let incrementer = this.tickDistance / this.graphScalar; // this.graphScalar / this.tickDistance;
					let tickFontSize = this.tickFontSize || Math.max(10, Math.min(
							Math.ceil(.55 * this.gridlineDistance),
							Math.ceil(.55 * this.tickDistance) ));

					ctx.font = tickFontSize + "px Arial, sans-serif";
					ctx.textBaseline = "middle";

					if(this.tickStyleOrigin && this.tickStyleOrigin !== CMColor.NONE) {
						let halfTickLength = Math.max(Math.min(5, .25 * this.tickDistance), 3);
						ctx.strokeStyle = this.tickStyleOrigin;

						this.drawLine(this.origin.x, this.origin.y - halfTickLength,
							this.origin.x, this.origin.y + halfTickLength);
					}

					if(this.tickLabelStyleOrigin && this.tickLabelStyleOrigin !== CMColor.NONE) {
						let halfTickLength = Math.max(Math.min(5, .25 * this.tickDistance), 3);

						ctx.fillStyle = this.tickLabelStyleOrigin;

						let nLabel = this.tickLabelIfOrigin(0);
						let oOffsetX = halfTickLength;

						// No y-axis; we can center the origin label
						if(!this.yAxisStyle || this.yAxisStyle === CMColor.NONE) {
							oOffsetX = 0;
						}

						if(typeof nLabel === "string")
							ctx.fillText(nLabel,
								this.origin.x + oOffsetX - .5 * ctx.measureText(nLabel).width,
								this.origin.y + halfTickLength + .75 * tickFontSize);
						else
						if(typeof nLabel === "number") // Note: this includes zero
							ctx.fillText("" + nLabel,
								this.origin.x + oOffsetX - .5 * ctx.measureText(nLabel + "").width,
								this.origin.y + halfTickLength + .75 * tickFontSize);
						else
						if(nLabel) // boolean, etc., so just write the expected #
							ctx.fillText("0",
								this.origin.x + oOffsetX - .5 * ctx.measureText("0").width,
								this.origin.y + halfTickLength + .75 * tickFontSize);
					}

					if(this.tickStyle && this.tickStyle !== CMColor.NONE) {
						let halfTickLength = Math.max(Math.min(5, .25 * this.tickDistance), 3);

						// vertical lines on x-axis, center to left
						ctx.strokeStyle = this.tickStyleX;
						ctx.fillStyle = this.tickLabelStyleX;
						for(let i = this.origin.x - this.tickDistance, n = -incrementer;
								i > 0;
								i -= this.tickDistance, n -= incrementer) {

							this.drawLine(i, this.origin.y - halfTickLength,
								i, this.origin.y + halfTickLength);

							let nLabel = this.tickLabelIfX(n);
							if(typeof nLabel === "string")
								ctx.fillText(nLabel,
									i - .5 * ctx.measureText(nLabel).width,
									this.origin.y + halfTickLength + .75 * tickFontSize);
							else
							if(typeof nLabel === "number") {
								if(nLabel < 0)
									ctx.fillText("" + nLabel,
										i - ctx.measureText("" + nLabel).width + ctx.measureText("-").width,
										this.origin.y + halfTickLength + .75 * tickFontSize);
								else
									ctx.fillText(nLabel,
										i - .5 * ctx.measureText("" + nLabel).width,
										this.origin.y + halfTickLength + .75 * tickFontSize);
							}
							else
							if(nLabel) // boolean, etc., so just write the expected (negative) #
								ctx.fillText("" + n,
									i - ctx.measureText("" + n).width + ctx.measureText("-").width,
									this.origin.y + halfTickLength + .75 * tickFontSize);
						}

						// vertical lines on x-axis, center to right
						for(let i = this.origin.x + this.tickDistance, n = incrementer;
								i < this.width;
								i += this.tickDistance, n += incrementer) {

							this.drawLine(i, this.origin.y - halfTickLength,
								i, this.origin.y + halfTickLength);

							let nLabel = this.tickLabelIfX(n);
							if(typeof nLabel === "string")
								ctx.fillText(nLabel,
									i - .5 * ctx.measureText(nLabel).width,
									this.origin.y + halfTickLength + .75 * tickFontSize);
							else
							if(typeof nLabel === "number") {
								if(nLabel < 0)
									ctx.fillText("" + nLabel,
										i - ctx.measureText("" + nLabel).width + ctx.measureText("-").width,
										this.origin.y + halfTickLength + .75 * tickFontSize);
								else
									ctx.fillText(nLabel,
										i - .5 * ctx.measureText("" + nLabel).width,
										this.origin.y + halfTickLength + .75 * tickFontSize);
							}
							else // boolean, etc., so just write the expected (positive) #
							if(nLabel)
								ctx.fillText("" + n,
									i - .5 * ctx.measureText("" + n).width,
									this.origin.y + halfTickLength + .75 * tickFontSize);
						}

						// horizontal lines on y-axis, center to top
						ctx.strokeStyle = this.tickStyleY;
						ctx.fillStyle = this.tickLabelStyleY;
						for(let i = this.origin.y - this.tickDistance, n = incrementer;
								i > 0;
								i -= this.tickDistance, n += incrementer) {

							this.drawLine(this.origin.x - halfTickLength, i,
								this.origin.x + halfTickLength, i);

							let nLabel = this.tickLabelIfY(n);
							if(typeof nLabel === "string")
								ctx.fillText(nLabel,
									this.origin.x - halfTickLength - 1.25 * ctx.measureText(nLabel).width,
									i);
							else
							if(typeof nLabel === "number")
								ctx.fillText("" + nLabel,
									this.origin.x - halfTickLength - 1.25 * ctx.measureText("" + nLabel).width,
									i);
							else
							if(nLabel)
								ctx.fillText("" + n,
									this.origin.x - halfTickLength - 1.25 * ctx.measureText("" + n).width,
									i);
						}

						// horizontal lines on y-axis, center to bottom
						for(let i = this.origin.y + this.tickDistance, n = -incrementer;
								i < this.height;
								i += this.tickDistance, n -= incrementer) {

							this.drawLine(this.origin.x - halfTickLength, i,
								this.origin.x + halfTickLength, i);

							let nLabel = this.tickLabelIfY(n);
							if(typeof nLabel === "string")
								ctx.fillText(nLabel,
									this.origin.x - halfTickLength - 1.25 * ctx.measureText(nLabel).width,
									i);
							else
							if(typeof nLabel === "number")
								ctx.fillText("" + nLabel,
									this.origin.x - halfTickLength - 1.25 * ctx.measureText("" + nLabel).width,
									i);
							else
							if(nLabel)
								ctx.fillText("" + n,
									this.origin.x - halfTickLength - 1.25 * ctx.measureText("" + n).width,
									i);
						}
					}

					for(let func of this.functions) {
						func.onbeforedraw(ctx);
						func.draw(ctx);
						func.ondraw(ctx);
					}

					let allToDraw = this.getVennRegions()
						.concat( this.getVennSets() )
						.concat( this.getEdges() )
						.concat( this.getVertices() )
						.concat( this.getFunctions() )
						.concat( this.getSprites() ).slice(0).sort((a, b) => {
								return a.layer - b.layer;
						});

					for(let i = 0, len = allToDraw.length; i < len; i++) {
						allToDraw[i].draw(ctx);
					}

					for(let sprite of this.sprites) {
						sprite.onbeforedraw(ctx);
						ctx.save();
						ctx.globalAlpha = sprite.opacity;
						sprite.draw(ctx);
						ctx.restore();
						sprite.ondraw(ctx);
					}

					for(let doodle of this.doodles) {
						doodle.draw(ctx);
					}

					this.ondraw(ctx);

					if(this.recordingVideo) {
						this.screenVideoCtx.clearRect(0, 0,
							this.screenVideoCanvas.width, this.screenVideoCanvas.height);

						this.screenVideoCtx.drawImage(game.canvas, this.screenVideoDetails.x, this.screenVideoDetails.y,
							this.screenVideoDetails.width, this.screenVideoDetails.height);
					}
				};
			}
				break;
		}

		this.doodleOptions = { enabled: false };
		if(options.doodleOptions) {
			this.doodleOptions = options.doodleOptions;

			// User set up doodle options without bothering to enable/disable, so we assume enable
			if(typeof options.doodleOptions.enabled === "undefined") {
				this.doodleOptions.enabled = true;
			}
		}

		this.doodles = [];
		this.currentDoodle = null;

		// Store some zoom information for returning to unzoomed window
		this.zoomLevel = 1; // Use percentages as decimals
		this.unzoomedGraphScalar = this.graphScalar;
		this.unzoomedTickDistance = this.tickDistance;
		this.unzoomedGridlineDistance = this.gridlineDistance;
		this.unzoomedOrigin = new CMPoint(
			this.origin.x,
			this.origin.y
		);

		// This allows dev to enter handlers directly into the CMGame constructor
		let eventKeys = [

			// Prefer not to use these, but they are available
			"ontouchstart",
			"ontouchmove",
			"ontouchend",
			"onmousedown",
			"onmousemove",
			"onmouseup",
			"onclick",
			"onrightclick",

			// These are the preferred event callbacks
			"onpressstart",
			"onpressmove",
			"onpressend",
			"onswipe",
			"ondblclick",
			"onkeydown",
			"onkeyup",
			"onresize",
			"onbeforezoom",
			"onzoom",

			// These are helper methods you can override for the game loop
			"onbeforestart",
			"onstart",
			"onbeforeupdate",
			"onupdate",
			"onbeforedraw",
			"ondraw",
			"onload"
		];

		this.frameoutFunctions = new Map();

		for(let key of eventKeys) {
			if(typeof options[key] === "function") {
				this[key] = options[key].bind(self);
			}
		}

		this.screenshotCanvas = null;
		this.screenshotCtx = null;
		this.screenVideoCanvas = null;
		this.screenVideoCtx = null;
		this.recordingVideo = false;
		this.screenVideoDetails = null;

		// 1920 x 1080 looks great but causes a lot of slowdown
		const PREFERRED_VIDEO_WIDTH = 1920;
		const PREFERRED_VIDEO_HEIGHT = 1080;

		// Base output calculations on ideal MP4 resolution
		let videoWidthScalar = PREFERRED_VIDEO_WIDTH / this.width;
		let videoHeightScalar = PREFERRED_VIDEO_HEIGHT / this.height;

		if(videoWidthScalar > videoHeightScalar) {
			this.screenVideoDetails = {
				x: Math.max((PREFERRED_VIDEO_WIDTH - this.width * videoHeightScalar) / 2, 0),
				y: Math.max((PREFERRED_VIDEO_HEIGHT - this.height * videoHeightScalar) / 2, 0),
				width: this.width * videoHeightScalar,
				height: this.height * videoHeightScalar
			};
		}
		else {
			this.screenVideoDetails = {
				x: Math.max((PREFERRED_VIDEO_WIDTH - this.width * videoWidthScalar) / 2, 0),
				y: Math.max((PREFERRED_VIDEO_HEIGHT - this.height * videoWidthScalar) / 2, 0),
				width: this.width * videoWidthScalar,
				height: this.height * videoWidthScalar
			};
		}

		this.screenVideoCanvas = document.createElement("canvas");

		// Aim for resolution of for ideal MP4 output without
		this.screenVideoCanvas.width = PREFERRED_VIDEO_WIDTH;
		this.screenVideoCanvas.height = PREFERRED_VIDEO_HEIGHT;
		this.screenVideoCanvas.style.width = PREFERRED_VIDEO_WIDTH + "px";
		this.screenVideoCanvas.style.height = PREFERRED_VIDEO_HEIGHT + "px";

		this.screenVideoCtx = this.screenVideoCanvas.getContext("2d", {alpha: false});

		this.alertOverlay = document.createElement("div");
		this.alertOverlay.classList = "cm-overlay";

		this.alertElement = document.createElement("aside");
		this.alertElement.setAttribute("id", "cmAlert");

		let header = document.createElement("header");
		let h3 = document.createElement("h3");
		this.alertMessage = document.createElement("p");
		this.alertMessage.classList.add("cm-center-text");
		let p2 = document.createElement("p");
		p2.classList.add("cm-center-text");

		this.alertInput = document.createElement("input");
		this.alertInput.type = "text";
		this.alertInput.style.background = "white";

		this.alertOKButton = document.createElement("button");
		this.alertOKButton.className = "cm-dark_green cm-text-white";
		this.alertOKButton.setAttribute("id", "cmAlertOKBtn");
		this.alertOKButton.innerText = "OK";
		this.alertInput.onkeydown = function(e) {
			if(e.keyCode === 13) {
				e.preventDefault();
				self.alertOKButton.click();
			}			
		};

		this.alertCancelButton = document.createElement("button");
		this.alertCancelButton.className = "cm-gray cm-text-white";
		this.alertCancelButton.setAttribute("id", "cmAlertCancelBtn");
		this.alertCancelButton.innerText = "Cancel";

		this.alertOverlay.appendChild(this.alertElement);
		h3.innerText = (document.title || "Game") + " says:";
		header.appendChild(h3);
		this.alertElement.appendChild(header);
		this.alertElement.appendChild(this.alertMessage);
		
		this.alertOverlay.onkeydown = function() {};

		p2.appendChild(this.alertInput);
		p2.appendChild(this.alertOKButton);
		p2.appendChild(this.alertCancelButton);
		this.alertElement.appendChild(p2);
		this.alertOverlay.style.display = "none";
		documentBody.appendChild(this.alertOverlay);

		this.awaitingAnimFrame = false; // Required to manage cancelling delayed animations
		window.requestNextFrame = function(callback) {
			self.awaitingAnimFrame = true;
			setTimeout(function() {
				if(!self.paused)
					self.animFrameId = requestAnimationFrame(callback);

				self.awaitingAnimFrame = false;
			}, CMGame.MIN_FRAME_DELAY);
		};

		let tryToCancelFrame = function(frameRequestId) {
			if(self.awaitingAnimFrame) {
				return setTimeout(function() {
					tryToCancelFrame(frameRequestId);
				}, 20);
			}

			return window.cancelAnimationFrame(frameRequestId);
		};

		window.cancelNextFrame = function(frameRequestId) {
			if(frameRequestId === null)
				return;

			return tryToCancelFrame(frameRequestId);
		};

		if(typeof this.onload === "function") {
			this.onload();
		}

		/**
		 * `debug` option immediately hides the load screen, and
		 * any `hideOnStart` elements, starting game immediately.
		 */
		if(this.debug) {
			try {
				document.getElementById("cmLoading").style.display = "none";
			} catch(e) {}

			/**
			 * We show hidden grid elements for testing, UNLESS the dev has specifically
			 * set these values in debugOptions.
			 */
			let debugOpts = options.debugOptions || {};
			if(this.tickStyle === CMColor.NONE &&
					typeof debugOpts.tickStyle === "undefined")
				this.tickStyle = "rgba(60, 30, 0, 0.5)";

			if(this.gridStyle === CMColor.NONE &&
					typeof debugOpts.gridStyle === "undefined")
				this.gridStyle = "rgba(65, 65, 65, 0.5)";

			if(this.xAxisStyle ===  CMColor.NONE &&
					typeof debugOpts.xAxisStyle === "undefined")
				this.xAxisStyle = "rgba(65, 65, 255, 0.5)";

			if(this.yAxisStyle === CMColor.NONE &&
					typeof debugOpts.yAxisStyle === "undefined")
				this.yAxisStyle = "rgba(255, 65, 65, 0.5)";

			// start game after DOM is loaded and scripts are parsed (to avoid errors)
			window.addEventListener("load", self.start.bind(self), false);
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
	 * Captures a snapshot of the current frame.
	 * Attempts to copy background if it is a defined
	 * color or single image. If your background is more
	 * complicated, you may wish to draw it into
	 * the canvas with the canvas context, to
	 * ensure it is included in the screenshots.
	 * Returns a promise, resolving with an object with "image"
	 * property set to an <img> element (the options.output element
	 * if defined, or a new Image otherwise) and a "src"
	 * property set to the captured image source string.
	 *
	 * NOTE: if you are testing locally, and draw image resources into
	 * the canvas, it will be considered "tainted" and this method
	 * will not work (toDataURL() will throw an error).
	 *
	 * @param {object} [options={}] - A plain JS object of options (if desired)
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

					// Note: this does not currently account for the background canvas having its own CSS background-image
					self.screenshotCtx.drawImage(self.backgroundCanvas,
									0, 0,
									self.screenshotCanvas.width,
									self.screenshotCanvas.height);
				}
				else
				if(bgImg && bgImg.startsWith("url")) { // Attempt to copy background image - need url, not linear-gradient, "none", etc.

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
	 *   set to that number (of milliseconds).
	 * @param {number} [options.start=0] - Number of milliseconds to wait before starting capture
	 * @param {number|string} [options.duration=5000] - Number of milliseconds to capture, or
	 *   "indefinite" to continue recording until stopScreenVideo is called. This value can
	 *   be off by a few seconds due to the nature of browser lag and video stream capture.
	 *   To mitigate this, the method first tries to convert this amount to the expected # of
	 *   frames, and stops the video after the appropriate delay in frames rather than time.
	 *   There are still some kinks, so you may want to add a few seconds to your expected time.
	 * @param {number} [options.fps=this.fps] - Desired frame rate for capture (default's to game's rate)
	 * @param {number} [options.mimeType="video/mp4"] - Desired mimeType for the
	 *   output video. If not present, will be inferred from options.filename (the preferred option)
	 * @param {string|Video} [options.output] Option for handling. "download"  to download immediately, "none"
	 *   to do nothing (e.g., if dev wants to wait for Promise), or an HTMLVideo element whose source will
	 *   be set to the output video once available. Default is "download".
	 * @returns {Promise}
	 */
	takeScreenVideo(options={}) {
		if(this.recordingVideo) {
			console.error("Cannot record multiple videos simultaneously");
			return Promise.resolve({video: null, src: ""});
		}

		let self = this;

		let opts = {
			start: 0,
			duration: 5000,
			fps: this.fps,
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
					console.warn(`takeScreenVideo "filename" does not match "mimeType".
						Inferred extension will be appended to filename.`);
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

		let durationInSeconds = opts.duration / 1000;
		let durationInFrames = Math.ceil(opts.fps * durationInSeconds);

		return new Promise(function(resolve, reject) {

			let stream = self.screenVideoCanvas.captureStream(opts.fps);
			let recordedChunks = [];

			/**
			 * Only webm seems to be well supported for the initial stream;
			 * requested mimeType will be used for the output Blob
			 */
			self.videoRecorder = new MediaRecorder(stream, { mimeType: "video/webm; codecs=vp9" });

			self.videoRecorder.ondataavailable = function(e) {
				if(e.data.size > 0) {
					recordedChunks.push(e.data);
				}
			};

			self.videoRecorder.onstart = function() {

				/**
				 * Stop recording only after requested time. Because recording
				 * video causes some slowdown, we use setFrameout to record
				 * the expected amount of time, where the speed can be edited
				 * later in a video editor.
				 */
				if(opts.duration !== "indefinite") { // Set duration to "indefinite" if you will stop manually

					// Due to lag in browser, we'll try to stop after appropriate # of frames, rather than time
					self.setFrameout(() => {
						self.videoRecorder.stop();
						self.recordingVideo = false;
					}, durationInFrames);
				}
			};

			self.videoRecorder.onstop = function() {
				let blob = new Blob(recordedChunks, {
					type: opts.mimeType // "video/mp4", etc.
				});

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

				// garbage collection
				recordedChunks = [];
				window.URL.revokeObjectURL(videoUrl);
				self.videoRecorder = null;
				resolve(resolvedObj);
			};

			// Start recording only after requested delay (opts.start)
			setTimeout(() => {
				self.videoRecorder.start();
				self.recordingVideo = true;
			}, opts.start);
		});
	}

	/**
	 * Convenience function for recording video
	 * to be started/stopped manually.
	 * Returns the Promise returned from takeScreenVideo.
	 * Since duration is not set, be sure to stop
	 * the video later with game.stopScreenVideo();
	 * @returns {Promise}
	 */
	startScreenVideo() {
		if(this.recordingVideo) {
			console.error("Cannot record multiple videos simultaneously");
			return Promise.resolve();
		}

		return this.takeScreenVideo({duration: "indefinite"});
	}

	/**
	 * For manual use when takeScreenVideo has
	 * the optional "duration" set to "indefinite",
	 * or to interrupt a currently recording video
	 * early and stop recording. Note that the
	 * Promise returned by takeScreenVideo
	 * will be resolved.
	 *
	 * game.takeScreenVideo({
	 *   duration: "indefinite"
	 * }).then(function(data) {
	 *    console.log("done");
	 * });
	 *
	 * // later...
	 * game.stopScreenVideo(); // This will finish recording, download, and clean up, and then "done" will be logged
	 *
	 */
	stopScreenVideo() {
		if(this.videoRecorder && this.recordingVideo) {
			this.videoRecorder.stop();
			this.recordingVideo = false;
		}
		else {
			console.warn("No video to stop");
		}
	}

	/**
	 * Start current game processes, animations, etc.
	 * Note: the startBtn parameter is not used in this method, but is passed to
	 * onbeforestart and onstart as the only argument, for instance to start
	 * on different difficulty level based on which button was clicked.
	 * @param {object} [startBtn] - Whatever HTML element was pressed to start the game
	 */
	start(startBtn) {
		let self = this;
		if(this.started) { // Prevent double calls
			return this;
		}

		if(typeof this.onbeforestart === "function") {
			this.onbeforestart(startBtn);
		}

		if(Array.isArray( this.hideOnStart ) ) {
			for(let item of this.hideOnStart) {
				if(typeof item === "object")
					elm.style.display = "none";
				else
				if(typeof item === "string") {
					if(document.querySelector(item) !== null)
						document.querySelector(item).style.display = "none";
				}
			}
		}

		this.started = true;
		this.paused = false;

		// First frame is runs immediately, then onstart() is called
		this.animFrameId = requestAnimationFrame(function() {
			self.runCycle();

			if(typeof self.onstart === "function") {
				try {
					self.onstart(startBtn);
				}
				catch(e) {
					console.error(e);
					console.log(`CMGame engine says: Chaining on creation may lead to an initialization error ` +
						`if your onstart() method references the current game instance. ` +
						`Try separating the .start() call from initialization. For instance,

					const game = new CMGame();
					game.start();`);
				}
			}
		});

		return this;
	}

	/** Pause current game cycle */
	pause() {
		this.paused = true;
		window.cancelNextFrame(this.animFrameId);
		this.animFrameId = null;

		return this;
	}

	/** Restart paused game cycle */
	unpause() {
		let self = this;

		if(this.paused) {
			this.paused = false;

			if(this.animFrameId === null)
				// this.animFrameId =
				requestNextFrame(self.runCycle);
		}

		return this;
	}

	/** These are meant to be overridden */
	onbeforeupdate(frameCount) {} // Occurs just before game's update()
	onupdate(frameCount) {} // Occurs just after game's update()
	onbeforedraw(ctx) {} // Occurs just before game's draw(), but after previous screen was cleared
	ondraw(ctx) {} // Occurs just after game's draw()
	onbeforezoom(newZoomLvl, oldZoomLvl) {} // Occurs just before zoom() processes are invoked
	onzoom(newZoomLvl, oldZoomLvl) {} // Occurs just after zoom() is invoked

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

	// Triggered by significant mousemove or touchmove by user
	onswipe(/* CMSwipe */ cmSwipe) {}

	/**
	 * Updates game state (and state of components) in current frame
	 * @param {number} frameCount - Which frame this is from the start (modded
	 *   out by this.frameCap if that is not infinite)
	 */
	update(frameCount) {
		this.onbeforeupdate(frameCount);

		if(this.frameoutFunctions.has(frameCount)) {
			this.frameoutFunctions.get(frameCount).call(this, frameCount);

			// clean up, and prevent repeats in frameCap is finite
			this.frameoutFunctions.delete(frameCount);
		}

		for(let func of this.functions) {
			func.update(frameCount);
		}

		/**
		 * "destroy" causes a jump in a for loop when splicing out,
		 * essentially missing the next sprite's update() call.
		 * We could replace with a decrementing while loop,
		 * but this forces us to update the sprites in reverse order.
		 * Instead we'll check if the sprite was destroyed in its
		 * update() call, and if so, decrement the appropriate variables.
		 */
		for(let i = 0, cap = this.sprites.length; i < cap; i++) {

			let sprite = this.sprites[i];
			sprite.onbeforeupdate(frameCount);
			sprite.update(frameCount); // Note: this is where "destroy" occurs, shifting i
			sprite.onupdate(frameCount);

			// sprites[i] was removed; jump back until all "destroyed" sprites are acounted for
			while(this.sprites.length < cap) {
				i--;
				cap--;
			}
		}

		this.onupdate(frameCount);
	}

	/**
	 * Draws game screen in current frame
	 * @param {CanvasRenderingContext2D} [ctx=this.offscreenCtx] - The drawing context
	 */
	draw(ctx=this.offscreenCtx) {
		ctx.clearRect(0, 0, this.width, this.height);
		this.onbeforedraw(ctx);

		// Background gridlines
		if(this.gridStyle && this.gridStyle !== CMColor.NONE) {
			ctx.strokeStyle = this.gridStyle;
			ctx.lineWidth = this.gridlineWidth;
			ctx.beginPath();

			// vertical lines, center to left
			for(let i = this.origin.x; i > 0; i -= this.gridlineDistance) {
				ctx.moveTo(i, 0);
				ctx.lineTo(i, this.canvas.height);
			}

			// vertical lines, center to right
			for(let i = this.origin.x; i < this.width; i += this.gridlineDistance) {
				ctx.moveTo(i, 0);
				ctx.lineTo(i, this.canvas.height);
			}

			// horizontal lines, center to top
			for(let i = this.origin.y; i > 0; i -= this.gridlineDistance) {
				ctx.moveTo(0, i);
				ctx.lineTo(this.canvas.width, i);
			}

			// horizontal lines, center to bottom
			for(let i = this.origin.y; i < this.height; i += this.gridlineDistance) {
				ctx.moveTo(0, i);
				ctx.lineTo(this.canvas.width, i);
			}

			ctx.stroke();
		}

		// Draw x and y axes
		// x axis
		if(this.xAxisStyle && this.xAxisStyle !== CMColor.NONE) {
			ctx.strokeStyle = this.xAxisStyle;

			this.drawLine(0, this.origin.y,
				this.width, this.origin.y);
		}

		// y axis
		if(this.yAxisStyle && this.yAxisStyle !== CMColor.NONE) {
			ctx.strokeStyle = this.yAxisStyle;
			
			this.drawLine(this.origin.x, 0,
				this.origin.x, this.height);	
		}

		// Draw tick marks
		let incrementer = this.tickDistance / this.graphScalar; // this.graphScalar / this.tickDistance;
		let tickFontSize = this.tickFontSize || Math.max(10, Math.min(
				Math.ceil(.55 * this.gridlineDistance),
				Math.ceil(.55 * this.tickDistance) ));

		ctx.font = tickFontSize + "px Arial, sans-serif";
		ctx.textBaseline = "middle";

		if(this.tickStyleOrigin && this.tickStyleOrigin !== CMColor.NONE) {
			let halfTickLength = Math.max(Math.min(5, .25 * this.tickDistance), 3);
			ctx.strokeStyle = this.tickStyleOrigin;

			this.drawLine(this.origin.x, this.origin.y - halfTickLength,
				this.origin.x, this.origin.y + halfTickLength);
		}

		if(this.tickLabelStyleOrigin && this.tickLabelStyleOrigin !== CMColor.NONE) {
			let halfTickLength = Math.max(Math.min(5, .25 * this.tickDistance), 3);

			ctx.fillStyle = this.tickLabelStyleOrigin;

			let oOffsetX = halfTickLength;

			// No y-axis; we can center the origin label
			if(!this.yAxisStyle || this.yAxisStyle === CMColor.NONE) {
				oOffsetX = 0;
			}

			let nLabel = this.tickLabelIfOrigin(0);
			if(typeof nLabel === "string")
				ctx.fillText(nLabel,
					this.origin.x + oOffsetX - .5 * ctx.measureText(nLabel).width,
					this.origin.y + halfTickLength + .75 * tickFontSize);
			else
			if(typeof nLabel === "number") // Note: this includes zero
				ctx.fillText("" + nLabel,
					this.origin.x + oOffsetX - .5 * ctx.measureText(nLabel + "").width,
					this.origin.y + halfTickLength + .75 * tickFontSize);
			else
			if(nLabel) // boolean, etc., so just write the expected #
				ctx.fillText("0",
					this.origin.x + oOffsetX - .5 * ctx.measureText("0").width,
					this.origin.y + halfTickLength + .75 * tickFontSize);
		}

		if(this.tickStyle && this.tickStyle !== CMColor.NONE) {
			let halfTickLength = Math.max(Math.min(5, .25 * this.tickDistance), 3);

			// vertical lines on x-axis, center to left
			ctx.strokeStyle = this.tickStyleX;
			ctx.fillStyle = this.tickLabelStyleX;
			for(let i = this.origin.x - this.tickDistance, n = -incrementer;
					i > 0;
					i -= this.tickDistance, n -= incrementer) {

				this.drawLine(i, this.origin.y - halfTickLength,
					i, this.origin.y + halfTickLength);

				let nLabel = this.tickLabelIfX(n);
				if(typeof nLabel === "string")
					ctx.fillText(nLabel,
						i - .5 * ctx.measureText(nLabel).width,
						this.origin.y + halfTickLength + .75 * tickFontSize);
				else
				if(typeof nLabel === "number") {
					if(nLabel < 0)
						ctx.fillText("" + nLabel,
						i - ctx.measureText("" + nLabel).width + ctx.measureText("-").width,
						this.origin.y + halfTickLength + .75 * tickFontSize);
					else
						ctx.fillText(nLabel,
							i - .5 * ctx.measureText("" + nLabel).width,
							this.origin.y + halfTickLength + .75 * tickFontSize);
				}
				else
				if(nLabel)
					ctx.fillText("" + n,
						i - ctx.measureText("" + n).width + ctx.measureText("-").width,
						this.origin.y + halfTickLength + .75 * tickFontSize);
			}

			// vertical lines on x-axis, center to right
			for(let i = this.origin.x + this.tickDistance, n = incrementer;
					i < this.width;
					i += this.tickDistance, n += incrementer) {

				this.drawLine(i, this.origin.y - halfTickLength,
					i, this.origin.y + halfTickLength);

				let nLabel = this.tickLabelIfX(n);
				if(typeof nLabel === "string")
					ctx.fillText(nLabel,
						i - .5 * ctx.measureText(nLabel).width,
						this.origin.y + halfTickLength + .75 * tickFontSize);
				else
				if(typeof nLabel === "number") {
					if(nLabel < 0)
						ctx.fillText("" + nLabel,
							i - ctx.measureText("" + nLabel).width + ctx.measureText("-").width,
							this.origin.y + halfTickLength + .75 * tickFontSize);
					else
						ctx.fillText(nLabel,
							i - .5 * ctx.measureText("" + nLabel).width,
							this.origin.y + halfTickLength + .75 * tickFontSize);
				}
				else // boolean, etc., so just write the expected #
				if(nLabel)
					ctx.fillText("" + n,
						i - .5 * ctx.measureText("" + n).width,
						this.origin.y + halfTickLength + .75 * tickFontSize);
			}

			// horizontal lines on y-axis, center to top
			ctx.strokeStyle = this.tickStyleY;
			ctx.fillStyle = this.tickLabelStyleY;
			for(let i = this.origin.y - this.tickDistance, n = incrementer;
					i > 0;
					i -= this.tickDistance, n += incrementer) {

				this.drawLine(this.origin.x - halfTickLength, i,
					this.origin.x + halfTickLength, i);

				let nLabel = this.tickLabelIfY(n);
				if(typeof nLabel === "string")
					ctx.fillText(nLabel,
						this.origin.x - halfTickLength - 1.25 * ctx.measureText(nLabel).width,
						i);
				else
				if(typeof nLabel === "number")
					ctx.fillText(nLabel,
						this.origin.x - halfTickLength - 1.25 * ctx.measureText("" + nLabel).width,
						i);
				else
				if(nLabel)
					ctx.fillText("" + n,
						this.origin.x - halfTickLength - 1.25 * ctx.measureText("" + n).width,
						i);
			}

			// horizontal lines on y-axis, center to bottom
			for(let i = this.origin.y + this.tickDistance, n = -incrementer;
					i < this.height;
					i += this.tickDistance, n -= incrementer) {

				this.drawLine(this.origin.x - halfTickLength, i,
					this.origin.x + halfTickLength, i);

				let nLabel = this.tickLabelIfY(n);
				if(typeof nLabel === "string")
					ctx.fillText(nLabel,
						this.origin.x - halfTickLength - 1.25 * ctx.measureText(nLabel).width,
						i);
				else
				if(typeof nLabel === "number")
					ctx.fillText(nLabel,
						this.origin.x - halfTickLength - 1.25 * ctx.measureText("" + nLabel).width,
						i);
				else
				if(nLabel)
					ctx.fillText("" + n,
						this.origin.x - halfTickLength - 1.25 * ctx.measureText("" + n).width,
						i);
			}
		}

		for(let func of this.functions) {
			func.onbeforedraw(ctx);
			func.draw(ctx);
			func.ondraw(ctx);
		}

		for(let sprite of this.sprites) {
			sprite.onbeforedraw(ctx);
			ctx.save();
			ctx.globalAlpha = sprite.opacity;
			sprite.draw(ctx);
			ctx.restore();
			sprite.ondraw(ctx);
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
	 * @param {object} [options=this.doodleOptions] - options to pass to CMDoodle
	 * @returns {object} The current CMGame instance
	 */
	startDoodle(point, options=this.doodleOptions) {
		this.doodleOptions.enabled = true;
		options.startPoint = new CMPoint(point.x, point.y);

		this.currentDoodle = new CMDoodle(this, options);
		this.doodles.push(this.currentDoodle);
		return this;
	}

	/**
	 * Ends current doodling session
	 * @returns {object} The current CMGame instance
	 */
	stopDoodle() {
		this.currentDoodle = null;
		return this;
	}

	/**
	 * Removes only the very last doodle drawn
	 * @returns {object} The current CMGame instance
	 */
	undoDoodle() {
		this.doodles.pop();

		// No animation cycle running, so redraw without doodles
		if(this.paused || !this.started) {
			this.draw();
		}

		return this;
	}

	/**
	 * Removes all current doodles from game instance, or
	 * a specific subcollection of them.
	 * Note: CMSprite instances created from spriteFromDoodle(s)
	 * will not be removed.
	 * @param [doodles] Specific doodles to remove
	 * @returns {object} The current CMGame instance
	 */
	clearDoodles(doodles) {
		if(typeof doodles === "undefined")
			CMGame.clearAll( this.doodles );
		else
			this.doodles = this.doodles.filter(doodle => !doodles.includes(doodle));

		this.currentDoodle = null;

		// No animation cycle running, so redraw without doodles
		if(this.paused || !this.started) {
			this.draw();
		}

		return this;
	}

	/**
	 * Converts a collection of CMDoodle objects to
	 * an in-game sprite.
	 * Note: this is for dynamic sprite creation and
	 * entry into the game. If you want to save the
	 * sprite image for later, you should just export
	 * it with game.takeScreenshot();
	 * @param {object[]} [doodlesArr] - A specific array of CMDoodle instances to
	 *   use. If not present, the current game's "doodles" array will be used.
	 * @param {boolean} [keepDoodles=false] Whether to clear old doodles once converted to a sprite
	 * @returns {object} The created CMSprite instance, or null of no doodles exist.
	 */
	spriteFromDoodles( doodlesArr, keepDoodles=false ) {
		let doodles = doodlesArr ? doodlesArr : this.doodles;

		if(doodles.length === 0) {
			return null;
		}

		let sprite;
		let minX = this.canvas.width;
		let minY = this.canvas.height;
		let maxX = 0;
		let maxY = 0;
		let width = 0;
		let height = 0;

		for(let i = 0; i < doodles.length; i++) {
			minX = Math.min(minX, Math.min.apply(Math, doodles[i].points.map(point=>point.x)));
			minY = Math.min(minY, Math.min.apply(Math, doodles[i].points.map(point=>point.y)));
			maxX = Math.max(maxX, Math.max.apply(Math, doodles[i].points.map(point=>point.x)));
			maxY = Math.max(maxY, Math.max.apply(Math, doodles[i].points.map(point=>point.y)));
		}

		width = maxX - minX;
		height = maxY - minY;

		// Without any length in the path, nothing will be drawn
		if(doodles[0].points.length === 1) {
			doodles[0].addPoint(doodles[0].startPoint.x + 0.5,
					doodles[0].startPoint.y + 0.5);
		}

		// Using a single path with .addPath does not allow us to use multiple styles
		let spritePaths = [doodles[0].path];
		let numPaths = 1;
		let spriteStroke = [doodles[0].strokeStyle];
		let spriteFill = [doodles[0].fillStyle];
		let spriteLineWidth = [doodles[0].lineWidth];

		for(let i = 1; i < doodles.length; i++) {

			// Without any length in the path, nothing will be drawn
			if(doodles[i].points.length === 1) {
				doodles[i].addPoint(doodles[i].startPoint.x + 0.5,
					doodles[i].startPoint.y + 0.5);
			}

			spritePaths.push(doodles[i].path);
			numPaths++;
			spriteStroke.push(doodles[i].strokeStyle);
			spriteFill.push(doodles[i].fillStyle);
			spriteLineWidth.push(doodles[i].lineWidth);
		}

		sprite = new CMSprite(
			this,
			minX,
			minY,
			width,
			height,
			function(ctx) {
				ctx.save();
				ctx.translate(this.x - minX, this.y - minY);
				for(let i = 0; i < numPaths; i++) {
					ctx.fillStyle = spriteFill[i];
					ctx.fill(spritePaths[i]);
					ctx.strokeStyle = spriteStroke[i];
					ctx.lineWidth = spriteLineWidth[i];
					ctx.stroke(spritePaths[i]);
				}

				ctx.restore();
			}
		);

		if(!keepDoodles) {
			this.clearDoodles(doodles);
		}

		return sprite;
	}

	/**
	 * A convenience method for easier naming.
	 * Performs same operations as spriteFromDoodles
	 * but for a single CMDoodle object (like a
	 * continous drawing).
	 * @param {object} [doodle] - A CMDoodle instance. If no
	 *   instance is provided (or, e.g., null is passed in), this uses
	 *   the latest in-game doodle curve. If game has no doodles,
	 *   this does nothing and returns null.
	 * @param {boolean} [keepDoodle=false] - If true, the CMDoodle object will not be removed
	 * @returns {object} A CMSprite instance, or null.
	 */
	spriteFromDoodle(doodle, keepDoodle=false) {
		let doodlesArr = [];
		if(doodle) {
			doodlesArr = [doodle];
		}
		else {
			if(game.doodles.length > 0) {
				doodlesArr = [CMGame.last(game.doodles)];
			}
			else {
				return null;
			}
		}

		let sprite = this.spriteFromDoodles(doodlesArr, true);
		if(!keepDoodle && this.doodles.indexOf(doodlesArr[0]) !== -1) {
			this.doodles.splice(this.doodles.indexOf(doodlesArr[0]), 1);
		}

		return sprite;
	}

	/**
	 * Similar to spriteFromDoodles, but rather
	 * than storing doodle paths to draw the sprite,
	 * draws to a canvas and saves that image.
	 * This may result in much faster drawing process
	 * for the created sprite, but the initial creation
	 * takes longer and so is done asynchronously.
	 * See spriteFromDoodles for parameters.
	 * @returns {Promise} A Promise resolving with
	 * the created CMSprite object
	 */
	spriteFromDoodlesAsync(doodle, keepDoodle=false) {
		let tempSprite = this.spriteFromDoodle(doodle, keepDoodle);
		let aCanvas = document.createElement("canvas");
		this.spriteWorkCanvas.style.width = (this.spriteWorkCanvas.width = tempSprite.width) + "px";

		this.spriteWorkCtx.save();
		this.spriteWorkCtx.translate(-tempSprite.x, -tempSprite.y);
		tempSprite.draw( this.spriteWorkCtx );
		this.spriteWorkCtx.restore();

		return new Promise(function(resolve, reject) {
			let img = new Image();

			img.onload = function() {
				let sprite = new CMSprite(game,
						0,
						0,
						tempSprite.width,
						tempSprite.height,
						img);

				resolve(sprite);
			};

			img.src = this.spriteWorkCanvas.toDataUrl();
		});
	}

	/**
	 * Similar to spriteFromDoodle, but rather
	 * than storing doodle paths to draw the sprite,
	 * draws to a canvas and saves that image.
	 * This may result in much faster drawing process
	 * for the created sprite, but the initial creation
	 * takes longer and so is done asynchronously.
	 * See spriteFromDoodle for parameters.
	 * @returns {Promise} A Promise resolving with
	 * the created CMSprite object
	 */
	spriteFromDoodleAsync(doodle, keepDoodle=false) {
		let tempSprite = this.spriteFromDoodle(doodle, keepDoodle);
		let aCanvas = document.createElement("canvas");
		this.spriteWorkCanvas.style.width = (this.spriteWorkCanvas.width = tempSprite.width) + "px";

		this.spriteWorkCtx.save();
		this.spriteWorkCtx.translate(-tempSprite.x, -tempSprite.y);
		tempSprite.draw( this.spriteWorkCtx );
		this.spriteWorkCtx.restore();

		return new Promise(function(resolve, reject) {
			let img = new Image();

			img.onload = function() {
				let sprite = new CMSprite(game,
						0,
						0,
						tempSprite.width,
						tempSprite.height,
						img);

				resolve(sprite);
			};

			img.src = this.spriteWorkCanvas.toDataUrl();
		});
	}

	/**
	 * Takes a CMFunction instance and converts it to a sprite that
	 * can be used in the game. Useful for creating odd terrains.
	 * @param {object} func - The CMFunction instance to convert
	 * @param {boolean} keepFunc=false] If CMFunction was added to game, set this to true to
	 *   keep it. Otherwise it will be removed.
	 * @returns {object} The created CMSprite instance
	 */
	spriteFromFunction(func, keepFunc=false) {

		let spritePath = new Path2D(func.path);
		let spriteStroke = func.strokeStyle;
		let spriteLineWidth = func.lineWidth;
		let spritePathBelow = null,
			spriteFillBelow = CMColor.NONE,
			spritePathAbove = null,
			spriteFillAbove = CMColor.NONE;

		if(func.pathBelow && func.fillStyleBelow &&
				func.fillStyleBelow !== CMColor.NONE) {
			spritePathBelow = func.pathBelow;
			spriteFillBelow = func.fillStyleBelow;
		}

		if(func.pathAbove && func.fillStyleAbove &&
				func.fillStyleAbove !== CMColor.NONE) {
			spritePathAbove = func.pathAbove;
			spriteFillAbove = func.fillStyleAbove;
		}

		let minX, minY, maxX, maxY;		
		switch(func.type) {
			case "cartesian":
				minX = Math.max(0, this.xToScreen(func.start.x));
				minY = Math.min.apply(null, func.screenValsArray);

				maxX = Math.min(this.width, this.xToScreen(func.end.x));
				maxY = Math.max.apply(null, func.screenValsArray);
				break;
			case "xofy":
				minY = Math.min(this.height, this.xToScreen(func.end.y));
				minX = Math.min.apply(null, func.screenValsArray);

				maxY = Math.max(0, this.yToScreen(func.start.y));
				maxX = Math.max.apply(null, func.screenValsArray);
				break;
			case "parametric":
				minX = func.screenValsArray.reduce((accumulator, currentValue) => Math.min(accumulator, currentValue.x), game.width);
				minY = func.screenValsArray.reduce((accumulator, currentValue) => Math.min(accumulator, currentValue.y), game.height);

				maxX = func.screenValsArray.reduce((accumulator, currentValue) => Math.max(accumulator, currentValue.x), 0);
				maxY = func.screenValsArray.reduce((accumulator, currentValue) => Math.max(accumulator, currentValue.y), 0);
				break;
			case "polar": // just a rough "box" estimate
				let maxR = Math.max(...func.screenValsArray);
				minX = func.origin.x - maxR;
				minY = func.origin.y - maxR;
				maxX = func.origin.x + maxR;
				maxY = func.origin.y + maxR;
				break;
		}

		let sprite = new CMSprite(
			this,
			minX,
			minY,
			maxX - minX,
			maxY - minY,
			function(ctx) {
				ctx.lineWidth = spriteLineWidth;

				if(spritePathBelow) {
					ctx.fillStyle = spriteFillBelow;
					ctx.fill(spritePathBelow);
				}

				if(spritePathAbove) {
					ctx.fillStyle = spriteFillAbove;
					ctx.fill(spritePathAbove);
				}

				// Draw actual function curve
				ctx.strokeStyle = spriteStroke;
				ctx.stroke(spritePath);
			}
		);

		sprite.containsPoint = function(xOrPoint, y) {
			let pointToCheck = {},
				game = this.game;

			if(typeof xOrPoint === "number") {
				pointToCheck = {
					x: xOrPoint,
					y: y
				};
			}
			else {
				pointToCheck = xOrPoint;
			}

			let isPointHere = false;
			game.ctx.save();
			game.ctx.lineWidth = this.lineWidth;
			if(game.ctx.isPointInStroke(spritePath, pointToCheck.x, pointToCheck.y))
				isPointHere = true;

			if(spritePathBelow) {
				if(game.ctx.isPointInPath(spritePathBelow, pointToCheck.x, pointToCheck.y))
					isPointHere = true;
			}

			if(spritePathAbove) {
				if(game.ctx.isPointInPath(spritePathAbove, pointToCheck.x, pointToCheck.y))
					isPointHere = true;
			}

			game.ctx.restore();
			return isPointHere;
		}

		if(!keepFunc) {
			if(game.has(func))
				game.removeFunction(func);
		}

		return sprite;
	}

	/**
	 * Add a new drawable function (CMFunction) to the game.
	 * Prefer this method to adding the function yourself,
	 * in case future operations are added here, or storage
	 * processes are modified (e.g., using Map instead of Array)
	 * To prevent errors, a falsy cmFunc argument does nothing.
	 * @param {object} cmFunc - The CMFunction instance	 
	 * @returns {object} The current CMGame instance
	 */
	addFunction(/* CMFunction */ cmFunc) {
		if(cmFunc instanceof CMFunction && !this.functions.includes(cmFunc)) {
			this.functions.push(cmFunc);
		}

		return this;
	}

	/**
	 * Similar to addFunction, but lets dev add
	 * multiple functions at once.
	 * @param {...object} funcs - A list of CMFunction instances
	 * @returns {object} The current CMGame instance
	 */
	addFunctions(...funcs) {
		let self = this,
			funcArr = funcs;

		if(arguments.length === 1 && Array.isArray(arguments[0])) {
			funcArr = arguments[0];
		}

		funcArr.forEach(func => self.addFunction(func));
		return this;
	}

	/**
	 * Removes one of our added drawable
	 * functions (CMFunction) from the
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
	 * To prevent errors, a falsy cmFunc argument does nothing.
	 *
	 * @param {object} cmFunc - The CMFunction instance to remove
	 * @returns {object} The current CMGame instance
	 */
	removeFunction(/* CMFunction */ cmFunc) {
		if(cmFunc && this.functions.includes(cmFunc)) {
			this.functions.splice(this.functions.indexOf(cmFunc), 1);
		}

		return this;
	}

	/**
	 * Similar to removeFunction, but lets dev remove
	 * multiple functions at once.
	 * @param {...object} funcs - A list of CMFunction instances
	 * @returns {object} The current CMGame instance
	 */
	removeFunctions(...funcs) {
		let funcArr = funcs;

		if(arguments.length === 1 && Array.isArray(arguments[0])) {
			funcArr = arguments[0];
		}

		let len = funcArr.length;
		while(len--) {
			this.removeFunction(funcArr[len]);
		}

		return this;
	}

	/**
	 * Adds a sprite to the game, and sorts the sprites
	 * based on preferences for drawing order. To prevent
	 * errors, a falsy "sprite" argument does nothing.
	 * @param {object} sprite - The sprite to add
	 * @returns {object} The current CMGame instance
	 */
	addSprite(/* CMSprite */ sprite) {
		if(sprite && !this.sprites.includes(sprite)) {
			this.sprites.push(sprite);
			this.sprites.sort((a, b) => a.layer - b.layer);
		}

		return this;
	}

	/**
	 * Similar to addSprite, but lets dev add
	 * multiple sprites at once.
	 * @param {...object} sprites - A list of CMSprite instances
	 * @returns {object} The current CMGame instance
	 */
	addSprites(...sprites) {
		let self = this,
			spriteArr = sprites;

		if(arguments.length === 1 && Array.isArray(arguments[0])) {
			spriteArr = arguments[0];
		}

		spriteArr.forEach(sprite => self.addSprite(sprite));
		return this;
	}

	/**
	 * Removes one of our added sprites
	 * (CMSprite) from the
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
	 * To prevent errors, a falsy "sprite" argument does nothing.
	 *
	 * @param {object} sprite - The CMSprite instance to remove
	 * @returns {object} The current CMGame instance
	 */
	removeSprite(/* CMSprite */ sprite) {
		if(sprite && this.sprites.includes(sprite)) {
			sprite.onscreen = false;
			this.sprites.splice(this.sprites.indexOf(sprite), 1);

			if(typeof sprite.ondestroy === "function") {
				sprite.ondestroy.call(sprite);
			}
		}

		return this;
	}

	/**
	 * Similar to removeSprite, but lets dev remove
	 * multiple sprites at once.
	 * @param {...object} sprites - A list of CMSprite instances
	 * @returns {object} The current CMGame instance
	 */
	removeSprites(...sprites) {
		let spriteArr = sprites;

		if(arguments.length === 1 && Array.isArray(arguments[0])) {
			spriteArr = arguments[0];
		}

		let len = spriteArr.length;
		while(len--) {
			this.removeSprite(spriteArr[len]);
		}

		return this;
	}

	/**
	 * Convenience function for adding multiple objects
	 * of varying types to the game.
	 * This is best used when performance is less of a
	 * concern, like before starting the game, or at the
	 * start of a new level. If performance is
	 * important, prefer to add objects by type, e.g.,
	 * with addSprite for a CMSprite object.
	 * @param {...*} args - List of objects to add
	 * @returns {object} The CMGame instance
	 */
	add(...args) {
		let self = this,
			objArr = args;

		if(arguments.length === 1 && Array.isArray(arguments[0])) {
			objArr = arguments[0];
		}

		this.addVertices(objArr.filter(obj => obj instanceof CMVertex))
			.addEdges(objArr.filter(obj => obj instanceof CMEdge))
			.addSprites(
				objArr.filter(obj => obj instanceof CMSprite)
					.filter(obj => !(obj instanceof CMVertex))
					.filter(obj => !(obj instanceof CMEdge))
			)
			.addFunctions(objArr.filter(obj => obj instanceof CMFunction));

		return this;
	}

	/**
	 * Determines if the current game has had the given
	 * item added (and it is not currently removed).
	 * @param {object} item - The item to check for. Must be an instance of CMSprite,
	 *   CMFunction, CMVertex, CMEdge, or CMDoodle (or will return false)
	 * @returns {boolean}
	 */
	has(item) {
		if(item instanceof CMSprite && this.sprites.includes(item) ||
			item instanceof CMFunction && this.functions.includes(item) ||
			item instanceof CMVertex && this.vertices.includes(item) ||
			item instanceof CMEdge && this.edges.includes(item) ||
			item instanceof CMDoodle && this.doodles.includes(item)) {
				return true;
			}

		return false;
	}

	/**
	 * Convenience function for removing multiple objects
	 * of varying types to the game.
	 * This is best used when performance is less of a
	 * concern, like after completing a level.
	 * If performance is important, prefer to remove
	 * objects by type, e.g., with addSprite for a
	 * CMSprite object.
	 * @param {...*} args - List of objects to remove
	 * @returns {object} The CMGame instance
	 */
	remove(...args) {
		let self = this,
			objArr = args;

		if(arguments.length === 1 && Array.isArray(arguments[0])) {
			objArr = arguments[0];
		}

		this.removeVertices(objArr.filter(obj => obj instanceof CMVertex))
			.removeEdges(objArr.filter(obj => obj instanceof CMEdge))
			.removeSprites(
				objArr.filter(obj => obj instanceof CMSprite)
					.filter(obj => !(obj instanceof CMVertex))
					.filter(obj => !(obj instanceof CMEdge))
			)
			.removeFunctions(objArr.filter(obj => obj instanceof CMFunction));

		return this;
	}

	/**
	 * Converts a real x value to its
	 * scaled onscreen position's
	 * x value (in pixels)
	 * @param {number} realX - The real x input
	 * @param {object} [relativeOrigin] - A canvas point to use as the real
	 *   point (0, 0). Defaults to the current game's origin.
	 * @returns {number}
	 */
	xToScreen(realX, relativeOrigin=this.origin) {
		let x = this.graphScalar * realX;

		return relativeOrigin.x + x;
	}

	/**
	 * Gets graph x value from screen's x value
	 * @param {number} screenX - The screen point's x value
	 * @param {object} [relativeOrigin] - A canvas point to use as the real
	 *   point (0, 0). Defaults to the current game's origin.
	 * @returns {number}
	 */
	xToReal(screenX, relativeOrigin=this.origin) {
		let x = screenX - relativeOrigin.x;

		return x / this.graphScalar;
	}

	/**
	 * Converts a real y value to its
	 * scaled onscreen position's
	 * y value (in pixels)
	 * @param {number} realY - The real y input
	 * @param {object} [relativeOrigin] - A canvas point to use as the real
	 *   point (0, 0). Defaults to the current game's origin.
	 * @returns {number}
	 */
	yToScreen(realY, relativeOrigin=this.origin) {
		let y = this.graphScalar * realY;

		// Reflect so graph sits above x axis
		return relativeOrigin.y - y;
	}

	/**
	 * Gets graph y value from screen's y value
	 * @param {number} screenY - The screen point's y value
	 * @param {object} [relativeOrigin] - A canvas point to use as the real
	 *   point (0, 0). Defaults to the current game's origin.
	 * @returns {number}
	 */
	yToReal(screenY, relativeOrigin=this.origin) {
		let y = -(screenY - relativeOrigin.y);

		return y / this.graphScalar;
	}

	/**
	 * A convenience method. Converts an x, y point
	 * of real numbers to current screen.
	 * @param {object} realPoint - A plain JS object with x and y number values
	 * @param {object} [relativeOrigin] - A canvas point to use as the real
	 *   point (0, 0). Defaults to the current game's origin.
	 * @returns {object} A point with x, y values
	 */
	toScreen(realPoint, relativeOrigin=this.origin) {
		return new CMPoint({
			x: this.xToScreen(realPoint.x, relativeOrigin),
			y: this.yToScreen(realPoint.y, relativeOrigin)
		});
	}

	/**
	 * A convenience method. Converts an x, y point
	 * from the current game's screen scale to real numbers.
	 * @param {object} screenPoint - A plain JS object with x and y number values
	 * @param {object} [relativeOrigin] - A canvas point to use as the real
	 *   point (0, 0). Defaults to the current game's origin.
	 * @returns {object} A point with x, y values
	 */
	toReal(screenPoint, relativeOrigin=this.origin) {
		return new CMPoint({
			x: this.xToReal(screenPoint.x, relativeOrigin),
			y: this.yToReal(screenPoint.y, relativeOrigin)
		});
	}

	/**
	 * Renders offscreenCanvas data onto
	 * visible screen. This is separated from
	 * updateAndDraw() method, so it can
	 * still be implemented when page is paused
	 * e.g., for using drawStrings or other
	 * built-in drawing methods
	 */
	drawOffscreenToScreen() {
		this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
		this.ctx.drawImage(this.offscreenCanvas,
			0, 0,
			this.canvas.width,
			this.canvas.height);
	}

	/**
	 * This is the core of the game animation cycle.
	 * It manages all single animation frame processes:
	 * state updates, component drawing and moving
	 * draw screen from offscreen to screen
	 * while accounting for devicePixelRatio,
	 * incrementing (and capping) frameCount,
	 * and starting next animation frame.
	 */
	updateAndDraw() {
		this.update(this.frameCount);

		this.offscreenCtx.save();
		this.offscreenCtx.scale(this.devicePixelRatio,
			this.devicePixelRatio);

		this.draw(this.offscreenCtx);
		this.offscreenCtx.restore();
		this.drawOffscreenToScreen();

		this.frameCount++;
		if(this.frameCount > this.frameCap) {
			this.frameCount = 0;
		}

		if(this.started && !this.paused) {
			// this.animFrameId =
			requestNextFrame(this.runCycle);
		}
	}

	/**
	 * Handle sizing of gamescreen based on browser width and height
	 */
	resizeCanvas() {
		let newWidth = this.canvasReferenceWidth;
		let newHeight = this.canvasReferenceHeight;
		let dimensionForReference = "width";
		let data = {
			screen: {
				width: 0,
				height: 0
			},
			wrapper: {
				x: 0, // left offset
				y: 0, // top offset
				width: 0,
				height: 0
			},
			screenScalar: 1
		};

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
				newWidth = Math.min.apply(Math, [document.documentElement.clientWidth, window.outerWidth, window.innerWidth, documentBody.clientWidth]);
				newHeight = (this.canvasReferenceHeight / this.canvasReferenceWidth) * newWidth;

				this.screenScalar = Math.min(newWidth / this.canvasReferenceWidth, newHeight / this.canvasReferenceHeight);
			}
			else {
				newHeight = Math.min.apply(Math, [document.documentElement.clientHeight, window.outerHeight, window.innerHeight, documentBody.clientHeight]);
				newWidth = (this.canvasReferenceWidth / this.canvasReferenceHeight) * newHeight;

				this.screenScalar = Math.min(newWidth / this.canvasReferenceWidth, newHeight / this.canvasReferenceHeight);
			}

			// scale to current screen and center the content
			this.wrapper.style.transform = "scale(" + this.screenScalar + ")";
			this.wrapper.style.left = `calc(100vw / 2 - ${0.5 * this.screenScalar} * ${this.width}px)`;

			this.wrapper.style.top = "0";

			data = {
				screen: {
					width: document.documentElement.clientWidth,
					height: document.documentElement.clientHeight
				},
				wrapper: {
					x: document.documentElement.clientWidth / 2 - .5 * this.screenScalar * this.width, // left offset
					y: 0, // top offset
					width: this.width * this.screenScalar,
					height: this.height * this.screenScalar
				},
				screenScalar: this.screenScalar,
				orientation: "landscape"
			};

			if(data.screen.width < data.screen.height)
				data.orientation = "portrait";
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

			data = {
				screen: {
					width: document.documentElement.clientWidth,
					height: document.documentElement.clientHeight
				},
				wrapper: {
					x: document.documentElement.clientWidth / 2 - .5 * this.screenScalar * this.width, // left offset
					y: 18, // top offset
					width: this.width,
					height: this.height
				},
				screenScalar: this.screenScalar,
				orientation: "landscape"
			};

			if(data.screen.width < data.screen.height)
				data.orientation = "portrait";
		}

		if(typeof this.onresize === "function")
			this.onresize(data);
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
			localStorage.setItem(nameToSave, JSON.stringify(stateToSave));
			console.log("Saving game data under name: %c" + nameToSave,
				"font-weight: bold; font-size: large; color: white; background-color: rgb(1, 97, 251); display: inline-block; border-radius: 4px; padding: 3px 5px;");	
		}
		catch(e) {
			console.error("Error thrown during localStorage save. Possible security issue, e.g., when testing save on local directory.");
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

			// Generated save name has index "0" only if no indexed files exist yet
			if(nameToRetrieve.replace(CMGame.SAVE_PREFIX, "") !== "0") { // Gasp! File DOES exist!
				nameToRetrieve = CMGame.SAVE_PREFIX +
					(parseInt( nameToRetrieve.replace(CMGame.SAVE_PREFIX, "") ) - 1);
			}
		}

		try {
			loadedStateString = localStorage.getItem(nameToRetrieve);
			console.log("Loading game data saved under name: %c" + nameToRetrieve,
				"font-weight: bold; font-size: large; color: white; background-color: rgb(1, 97, 251); display: inline-block; border-radius: 4px; padding: 3px 5px;");
		}
		catch(e) {
			console.error("Error thrown during localStorage load. Possible security issue, e.g., when testing save on local directory.");
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
		if(!this.paused &&
				e.target.nodeName !== "INPUT" &&
				e.target.nodeName !== "TEXTAREA" &&
				e.target.nodeName !== "BUTTON") // If game is paused, user may be typing into prompt input
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
		 if(e.target.nodeName !== "INPUT" &&
				e.target.nodeName !== "TEXTAREA" &&
				e.target.nodeName !== "BUTTON")
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
					(e.targetTouches[i].clientX - this.wrapper.offsetLeft + document.scrollingElement.scrollLeft) / this.screenScalar,
					(e.targetTouches[i].clientY - this.wrapper.offsetTop + document.scrollingElement.scrollTop) / this.screenScalar);
			}
		}
		else {
			this.pressStart(
				(e.targetTouches[0].clientX - this.wrapper.offsetLeft + document.scrollingElement.scrollLeft) / this.screenScalar,
				(e.targetTouches[0].clientY - this.wrapper.offsetTop + document.scrollingElement.scrollTop) / this.screenScalar);
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
		this.onmousedown(e);

		// Account CSS transform scaling
		this.pressStart(
			(e.clientX - this.wrapper.offsetLeft + document.scrollingElement.scrollLeft) / this.screenScalar,
			(e.clientY - this.wrapper.offsetTop + document.scrollingElement.scrollTop) / this.screenScalar);

		/**
		 * Avoid using onrightclick, but if you must, we give it x, y values
		 * as a convenience, so that it looks like a point
		 */
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
					(e.targetTouches[i].clientX - this.wrapper.offsetLeft + document.scrollingElement.scrollLeft) / this.screenScalar,
					(e.targetTouches[i].clientY - this.wrapper.offsetTop + document.scrollingElement.scrollTop) / this.screenScalar);
			}
		}
		else {
			this.pressMove(
				(e.targetTouches[0].clientX - this.wrapper.offsetLeft + document.scrollingElement.scrollLeft) / this.screenScalar,
				(e.targetTouches[0].clientY - this.wrapper.offsetTop + document.scrollingElement.scrollTop) / this.screenScalar);
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
				(e.clientX - this.wrapper.offsetLeft + document.scrollingElement.scrollLeft) / this.screenScalar,
				(e.clientY - this.wrapper.offsetTop + document.scrollingElement.scrollTop) / this.screenScalar);
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
		this.numPressPoints = e.touches.length;

		if(this.multiTouch) {
			for(let i = 0; i < e.changedTouches.length; i++) {
				this.pressEnd(
					(e.changedTouches[i].clientX - this.wrapper.offsetLeft + document.scrollingElement.scrollLeft) / this.screenScalar,
					(e.changedTouches[i].clientY - this.wrapper.offsetTop + document.scrollingElement.scrollTop) / this.screenScalar);
			}
		}
		else {
			this.pressEnd(
				(e.changedTouches[0].clientX - this.wrapper.offsetLeft + document.scrollingElement.scrollLeft) / this.screenScalar,
				(e.changedTouches[0].clientY - this.wrapper.offsetTop + document.scrollingElement.scrollTop) / this.screenScalar);
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
		this.onmouseup(e);

		this.pressEnd(
			(e.clientX - this.wrapper.offsetLeft + document.scrollingElement.scrollLeft) / this.screenScalar,
			(e.clientY - this.wrapper.offsetTop + document.scrollingElement.scrollTop) / this.screenScalar);
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

		if(this.currentDoodle) {
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

		// >=3 arguments => can assume all rectangular properties are given
		if(typeof w1 !== "undefined") {
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
		let obj1 = x1,
			obj1Shape = obj1.shape,
			obj2 = y1,
			obj2Shape = obj2.shape;

		if(!obj1Shape)
			obj1Shape = "rect";

		if(!obj2Shape)
			obj2Shape = "rect";

		if(obj1Shape === "circle") {
			if(obj2Shape === "circle") {
				return this.distance(obj1, obj2) <= obj1.radius + obj2.radius;
			}
			else
			if(obj2Shape === "rect") {
				return this.areColliding(
					obj1.x - obj1.radius, obj1.y - obj1.radius, obj1.radius * 2, obj1.radius * 2,
					obj2.x, obj2.y, obj2.width, obj2.height);
			}
			else
			if(obj2Shape === "line") {

				// vertical line - we can treat as a thin rectangle
				if(obj2.end.x === obj2.start.x) {
					let lineRect = {
						x: obj2.start.x,
						y: Math.min(obj2.start.y, obj2.end.y),
						width: 1,
						height: Math.abs(obj2.end.y - obj2.start.y),
						shape: "rect"
					};

					return this.areColliding(obj1, lineRect);
				}
				else
				if(obj2.end.y === obj2.start.y) { // horizontal line
					let lineRect = {
						x: Math.min(obj2.start.x, obj2.end.x),
						y: obj2.start.y,
						width: Math.abs(obj2.end.x - obj2.start.x),
						height: 1,
						shape: "rect"
					};

					return this.areColliding(obj1, lineRect);
				}
				else {

					let m = (obj2.end.y - obj2.start.y) / (obj2.end.x - obj2.start.x);
					let point = obj2.start;

					// after some algebra... we have formula y = m * x + b
					let b = point.y - m * point.x;

					let startX = Math.min(obj2.start.x, obj2.end.x);
					let endX = Math.max(obj2.start.x, obj2.end.x);

					for(let i = 0, len = endX - startX; i < len; i++) {
						if(this.distance(obj1, {
							x: i,
							y: m * i + b
						}) <= obj1.radius) {
							return true;
						}
					}

					return false;
				}
			}
		}

		if(obj2Shape === "circle" && obj1Shape === "rect") {
			return this.areColliding(
				obj1.x, obj1.y, obj1.width, obj1.height,
				obj2.x - obj2.radius, obj2.y - obj2.radius, obj2.radius * 2, obj2.radius * 2);
		}
		else
		if(obj2Shape === "circle" && obj1Shape === "line") {
			return this.areColliding(obj2, obj1);
		}

		if(obj1Shape === "line" && obj2Shape === "line") {

			// get slopes
			let m = (obj1.end.y - obj1.start.y) / (obj1.end.x - obj1.start.x);
			let n = (obj2.end.y - obj2.start.y) / (obj2.end.x - obj2.start.x);

			// if slopes are equal, lines are parallel, so just check any point on one line (say start) and see if the other contains it
			if(m === n) {
				return obj1.containsPoint(obj2.start);
			}

			let point1 = obj1.start;
			let point2 = obj2.start;

			// after some algebra... we have formula y = m * x + b
			let b = point1.y - m * point1.x;
			let c = point2.y - n * point2.x;

			// after more algebra...
			// Check if this x point (xToScreen) is between start and end x of BOTH lines. If so, return true. If not, return false.
			let goalX = (c - b) / (m - n);

			// This x lies within the x range of BOTH lines
			if((Math.min(obj1.start.x, obj1.end.x) <= goalX &&
				Math.max(obj1.start.x, obj1.end.x) >= goalX) &&
					(Math.min(obj2.start.x, obj2.end.x) <= goalX &&
					Math.max(obj2.start.x, obj2.end.x) >= goalX)) {
				return true;
			}
			else {
				return false;
			}
		}

		if(obj1Shape === "line" && obj2Shape === "rect") {

			// At least one of the endpoints is in the rectangle - so intersection
			if(obj2.containsPoint(obj1.start) || obj2.containsPoint(obj1.end)) {
				return true;
			}

			let lineBoundingRect = {
				x: Math.min(this.start.x, this.end.x),
				y: Math.min(this.start.y, this.end.y),
				width: Math.abs(this.end.x - this.start.x),
				height: Math.abs(this.end.y - this.start.y)
			};

			// Even the larger rectangle containing the line doesn't intersect the rect, so definitely no collision
			if(!this.areColliding(lineBoundingRect, obj2)) {
				return false;
			}

			// Note, since endpoints are not in rect, and neither is bounding rect, line cannot be horizontal or vertical
			if(obj1.end.x === obj1.start.x || obj1.end.y === obj1.start.y) {
				return false;
			}

			// Now for line to intersect the rectangle, it must intersect one of the four sides
			let m = (obj1.end.y - obj1.start.y) / (obj1.end.x - obj1.start.x);
			let point = obj1.start;
			let b = point.y - m * point.x;

			// Use these values with formulas y = mx + b and x = (y - b) / m

			// intersects left side of rect
			let yCheck = m * obj2.x + b;
			if(yCheck >= obj2.y && yCheck <= obj2.y + obj2.height) {
				return true;
			}

			// intersects right side of rect
			yCheck = m * (obj2.x + obj2.width) + b;
			if(yCheck >= obj2.y && yCheck <= obj2.y + obj2.height) {
				return true;
			}

			// intersects top side of rect
			let xCheck = (obj2.y - b) / m;
			if(xCheck >= obj2.x && xCheck <= obj2.x + obj2.width) {
				return true;
			}

			// intersects bottom side of rect
			xCheck = ((obj2.y + obj2.height) - b) / m;
			if(xCheck >= obj2.x && xCheck <= obj2.x + obj2.width) {
				return true;
			}

			return false;
		}

		if(obj1Shape === "rect" && obj2Shape === "line") {
			return this.areColliding(obj2, obj1);
		}

		// rect and rect
		if(obj1.x <= obj2.x + obj2.width && obj1.x + obj1.width >= obj2.x)	{
			if(obj1.y <= obj2.y + obj2.height && obj1.y + obj1.height >= obj2.y) {
				return true;
			}
		}

		return false;
	}

	/**
	 * Check distance between two points or point-like objects. Can also pass
	 * the point data in as 4 arguments (x1, y1, x2, y2) for points (x1, y1), (x2, y2).
	 * @param {object} p1 - First point (or any object with x and y values)
	 * @param {object} p2 - Second point (or any object with x and y values)
	 * @param {number} x2 - Second point's x-value (if using 4 numbers instead of 2 points)
	 * @param {number} y2 - Second point's y-value (if using 4 numbers instead of 2 points)
	 * @returns {number}
	 */
	distance(p1, p2, x2, y2) {
		if(arguments.length > 2) { // (x1, y1, x2, y2)
			p1 = new CMPoint(p1, p2);
			p2 = new CMPoint(x2, y2);
		}
		
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
	 * an oval (or circle) contained in a bounding rect.
	 * If a 4th parameter (height) is passed in, this will
	 * assume the bounding rect is being used, which
	 * affects the meaning of each parameter.
	 * @param {number} x - Circle center's x value (or bounding rect's top left corner x)
	 * @param {number} y - Circle center's y value (or bounding rect's top left corner y)
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
	 * an oval (or circle) contained in a bounding rect.
	 * If a 4th parameter (height) is passed in, this will
	 * assume the bounding rect is being used, which
	 * affects the meaning of each parameter.
	 * @param {number} x - Circle center's x value (or bounding rect's top left corner x)
	 * @param {number} y - Circle center's y value (or bounding rect's top left corner y)
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
		this.offscreenCtx.moveTo(x + r, y);
		this.offscreenCtx.arcTo(x + w, y, x + w, y + h, r);
		this.offscreenCtx.arcTo(x + w, y + h, x, y + h, r);
		this.offscreenCtx.arcTo(x, y + h, x, y, r);
		this.offscreenCtx.arcTo(x, y, x + w, y, r);
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

		// Radius is too big, reduce to half the width or height0
		if (w < 2 * r) {
			r = .5 * w;
		}

		if (h < 2 * r) {
			r = .5 * h;
		}

		this.offscreenCtx.beginPath();
		this.offscreenCtx.moveTo(x + r, y);
		this.offscreenCtx.arcTo(x + w, y, x + w, y + h, r);
		this.offscreenCtx.arcTo(x + w, y + h, x, y + h, r);
		this.offscreenCtx.arcTo(x, y+h, x, y, r);
		this.offscreenCtx.arcTo(x, y, x + w, y, r);
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
	 * and are followed by one options object.
	 * @param {object} image - The image (Image instance, <img> element, etc.) to be rotated
	 * @param {array} args - All arguments after the image are saved in a rest parameter.
	 *   Before the last argument (which represents the "options" argument) these represent
	 *   the usual drawImage parameters of a CanvasRenderingContext2D instance.
	 * @param {object|number} [options] - Drawing options. If just
	 *   a number is entered, this will be taken as the
	 *   angle and the rotation will rotate about the image center.
	 *   If this argument is not provided, this is same as ctx.drawImage()
	 * @param {number} [options.angle] - The angle in radians to rotate (clockwise, from viewer's perspective)
	 * @param {boolean} [options.clockwise=true] - Set to false to reverse angle direction
	 * @param {string} [options.origin] - The transform origin, as a string, relative to the output image rectangle.
	 *   The horizontal position words are "left", "center", and "right". The vertical position words
	 *   are "top", "center", and "bottom". Order is irrelevant. "center" can be omitted, and will be inferred
	 *   when other options aren't present. Examples:
	 *   "center" (this is the default), "bottom" (same as "center bottom"), "top",
	 *   "right" (same as "right center"), "left",
	 *   "left top", "left bottom", "right top", "right bottom"
	 * @returns {object} A CMPoint object representing the screen (x, y) point this image was rotated around
	 */
	drawRotatedImage(image, ...args) {
		let numArgs = args.length; // 4, 6, or 10, with options
		let options = args.pop();
		let angle = 0;
		let transformOrigin = "center";

		switch(typeof options) {
			case "number":
				angle = options;
				break;
			case "object":
				angle = options.angle;
				
				if(typeof options.clockwise === "undefined") {
					options.clockwise = true;
				}

				if(options.clockwise) {
					angle *= -1;
				}

				if(options.origin && options.origin !== "center") {
					transformOrigin = "";

					if(options.origin.includes("left")) {
						transformOrigin += "left";
					}
					else
					if(options.origin.includes("right")) {
						transformOrigin += "right";
					}

					if(options.origin.includes("top")) {
						transformOrigin += " top";
					}
					else
					if(options.origin.includes("bottom")) {
						transformOrigin += " bottom";
					}

					transformOrigin = transformOrigin.trim();
				}
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

		let origin = {
			x: null,
			y: null
		};

		if(transformOrigin.includes("left")) {
			origin.x = x;
		}
		else
		if(transformOrigin.includes("right")) {
			origin.x = x + imgWidth;
		}
		else { // "center"
			origin.x = x + .5 * imgWidth;
		}

		if(transformOrigin.includes("top")) {
			origin.y = y;
		}
		else
		if(transformOrigin.includes("bottom")) {
			origin.y = y + imgHeight;
		}
		else { // "center"
			origin.y = y + .5 * imgHeight;
		}

		this.offscreenCtx.save();
		this.offscreenCtx.translate(origin.x, origin.y);
		this.offscreenCtx.rotate(angle);
		this.offscreenCtx.translate(-origin.x, -origin.y);
		this.offscreenCtx.drawImage.apply(this.offscreenCtx, [image, ...args]);
		this.offscreenCtx.restore();

		return new CMPoint(origin.x, origin.y);
	}

	/**
	 * Draws a string that uses multiple fonts-
	 * primarily for embedding italic variables.
	 *
	 * Example usage:
	 *
	 * game.drawStrings(
	 *	  ["15px Arial", "italic 16px Times", "14pt monospace"],
	 *	  ["2", "pi", " - checked"],
	 *   200, 100);
	 *
	 * There is also a feature that lets us write multi-line
	 * strings, by passing in 2D arrays instead of normal arrays.
	 *
	 * game.drawStrings(
	 *	 [
	 *    ["15px Arial", "italic 16px Times", "14pt monospace"],
	 *    ["15px Arial", "italic 16px Times", "14pt Arial"]
	 *  ],
	 *	 [
	 *    ["2", "pi", " - checked"],
	 *    ["5", "e", " is larger"]
	 *  ],
	 *   200, 100,
	 *  { // in this case, fillStyle and strokeStyle options should be in 2D arrays as well
	 *	   fillStyles: [["green", "blue", "orange"], ["yellow", "red", "green"]]
	 *  });
	 *
	 * @param {string[]|string} fonts - The list of fonts to use in order
	 *   (cycles back to beginning of strings.length > fonts.length)
	 *   or a single font being used foor all strings. If a single font string
	 *   is provided, it is read as a single-element array. If a falsy value
	 *   or empty string or empty array is provided, game's current font is used.
	 * @param {string[]|string} strings - The strings to write in order
	 *   or a single string being drawn. If a single string is provided,
	 *   it is interpreted as a single-element array (ctx.fillText might
	 *   be more appropriate in this case).
	 * @param {number} x - The starting x position of the full string
	 * @param {number} y - The y position of the full string
	 * @param {object} [options={}] - An object of options
	 * @param {boolean} [options.fill=true] - Will use fillText if true
	 * @param {boolean} [options.stroke=false] - Will use strokeText if true
	 * @param {boolean} [options.fillStyles[]] - An array of colors to fill with
	 * @param {boolean} [options.strokeStyles[]] - An array of colors to stroke with
	 * @param {number} [options.lineHeight] - Pixels defining vertical spacing of multi-line text
	 * @param {number} [options.offsets[]] - An array of point-like objects defining offset for
	 *   each string. Note: this does not affect the returned x value, just as CSS translate does not
	 *   affect page flow
	 * @returns {object} - A CMPoint with x representing the ending x of the complete string, and y
	 *   representing the expected ending y point, based on # of lines and line height
	 */
	drawStrings(fonts, strings, x, y, options={}) {
		let defaults = {
			fill: true,
			stroke: false,
			fillStyles: [],
			strokeStyles: [],
			offsets: []
		};

		let opts = {};
		for(let key in defaults) {
			opts[key] = (typeof options[key] !== "undefined") ? options[key] : defaults[key];
		}

		// Allow dev to pass in multi-line strings
		if((Array.isArray(fonts) && Array.isArray(fonts[0])) ) { // ||
				// (Array.isArray(strings) && Array.isArray(strings[0]))) { // @todo Work this in
			let maxX = x;
			let maxY = y;

			// Assumes all arrays are of the same length
			for(let row = 0, numRows = Math.max(fonts.length, strings.length); row < numRows; row++) {
				let maxFont = 10;
				let lineHeight = 15;

				let optsFromArrays = {
					fill: Array.isArray(opts.fill) ? opts.fill[row] : opts.fill,
					stroke: Array.isArray(opts.stroke) ? opts.stroke[row] : opts.stroke,
					fillStyles: [[]],
					strokeStyles: [[]],
					offsets: [[]]
				};

				if(Array.isArray(options.fillStyles) && Array.isArray(options.fillStyles[0])) {
					optsFromArrays.fillStyles = options.fillStyles[row];
				}

				if(Array.isArray(options.strokeStyles) && Array.isArray(options.strokeStyles[0])) {
					optsFromArrays.strokeStyles = options.strokeStyles[row];
				}

				if(Array.isArray(options.offsets) && Array.isArray(options.offsets[0])) {
					optsFromArrays.offsets = options.offsets[row];
				}

				if(typeof options.lineHeight === "number") {
					lineHeight = options.lineHeight;
				}
				else {

					// Find biggest font (assume in pixels) in a given row, and use it to determine line height
					for(let col = 0, numCols = fonts[0].length; col < numCols; col++) {
						let fontSize;
						try {
							fontSize = fonts[row][col].match(/[0-9]+[A-Za-z]+/, "");
						}
						catch(e) {
							console.error(e);
						}

						if(fontSize) {
							maxFont = Math.max(maxFont, parseInt(fontSize[0]));
							lineHeight = 1.5 * maxFont;
						}
					}
				}

				maxX = Math.max(maxX,
					this.drawStrings(fonts[row], strings[row], x, y + row * lineHeight, optsFromArrays).x);
				maxY += lineHeight;
			}

			return new CMPoint(maxX, maxY);
		}

		if(typeof opts.fillStyles === "string") {
			opts.fillStyles = [opts.fillStyles];
		}
		else
		if(!opts.fillStyles || !opts.fillStyles.length) {
			opts.fillStyles = [this.offscreenCtx.fillStyle];
		}

		if(typeof opts.strokeStyles === "string") {
			opts.strokeStyles = [opts.strokeStyles];
		}
		else
		if(!opts.strokeStyles || !opts.strokeStyles.length) {
			opts.strokeStyles = [this.offscreenCtx.strokeStyle];
		}

		if(Array.isArray(opts.offsets) && opts.offsets.length) {
			for(let i = 0; i < opts.offsets.length; i++) {
				opts.offsets[i] = {
					x: opts.offsets[i] ? (opts.offsets[i].x || 0) : 0,
					y: opts.offsets[i] ? (opts.offsets[i].y || 0) : 0
				};
			}
		}
		else
		if(!opts.offsets) {
			opts.offsets = [{x: 0, y: 0}];
		}
		else { // offsets is defined, but is a single object, not an array
			opts.offsets = [{
				x: opts.offsets.x || 0,
				y: opts.offsets.y || 0
			}];
		}

		if(typeof opts.colors !== "undefined") {
			console.warn("\"colors\" is not a valid option for drawStrings(). Use \"fillStyles\" or \"strokeStyles\" instead.");
		}

		let numFonts;
		if(typeof fonts === "string") {
			fonts = [fonts];
		}

		if(typeof strings === "string") {
			strings = [strings];
		}

		if(!fonts || fonts.length === 0) {
			fonts = [this.offscreenCtx.font];
		}

		numFonts = fonts.length;
		let numStrings = strings.length;
		let offsetX = 0;
		let offsetY = 0;

		for(let i = 0; i < numStrings; i++) {
			this.offscreenCtx.save();
			this.offscreenCtx.font = fonts[i % numFonts];
			this.offscreenCtx.textAlign = "left"; // "center" will affect our positioning

			// Try to find the current font size (in pixels) to increase our offsetY
			let currentFontSize = fonts[i % numFonts].match(/[0-9]+px/, "");
			if(currentFontSize) {
				currentFontSize = parseFloat( currentFontSize[0] );
			}
			else {
				currentFontSize = 10;
			}

			if(opts.offsets) {
				let offset = opts.offsets[i % opts.offsets.length];
				this.offscreenCtx.translate(offset.x, offset.y);
			}

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
			offsetY = Math.max(offsetY, 1.5 * currentFontSize);
			this.offscreenCtx.restore();
		}

		return new CMPoint(x + offsetX, y + offsetY);
	}

	/**
	 * In preparation for using the drawStrings method, the
	 * dev may want the full string width before hand.
	 * This method calculates that measurement without
	 * drawing to the screen. No x or y required.
	 * @param {string[]|string} fonts - Array of the fonts to use in order (cycles if > strings.length);
	 *   or single string with font to use. If falsy value or empty array is
	 *   provided, this method will use the game's current font.
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

		this.offscreenCtx.save();
		this.offscreenCtx.textAlign = "left"; // "center" will affect our positioning
		for(let i = 0; i < numStrings; i++) {
			this.offscreenCtx.font = fonts[i % numFonts];

			// Add width of text in current font
			offsetX += this.offscreenCtx.measureText(strings[i]).width;
		}

		this.offscreenCtx.restore();
		return offsetX;
	}

	/**
	 * Similar to drawStrings method, but centers at (x, y)
	 * @param {string[]|string} fontsArg - font, or array of the fonts to use in order (cycles if > strings.length)
	 * @param {string[]|string} stringsArg - string, or array of the strings to write in order
	 * @param {number} [x=this.center.x] - The x position for the center of the full string. Defaults to
	 *   the x value of the center point of the screen
	 * @param {number} [y=this.center.y] - The y position for the center of the the full string. Defaults to
	 *   the y value of the center point of the screen
	 * @param {object} [options={}] - An object of options
	 * @param {boolean} [options.fill=true] Will use fillText if true
	 * @param {boolean} [options.stroke=false] Will use strokeText if true
	 * @param {boolean} [options.fillStyles[]] An array of colors, gradients, etc. to fill with
	 * @param {boolean} [options.strokeStyles[]] An array of colors, gradients, etc. to stroke with
	 * @param {number} [options.angle=0] An angle (radians) to rotate by (clockwise, from viewer's perspective)
	 * @param {number} [options.centerVertically=true] If true uses textBaseline="middle". Note: since this
	 *   is based on all alphabetic characters, it may not be exactly centered (e.g., when the string has no hanging
	 *   characters like lowercase "g")
	 * @param {number} [options.offsets[]] - An array of point-like objects defining offset for
	 *   each string. Note: this does not affect the returned x value, just as CSS translate does not
	 *   affect page flow
	 * @returns {object} A CMPoint instance representing the (x, y) screen point where
	 *   this text ends (even if rotated)
	 */
	drawStringsCentered(fontsArg, stringsArg, x=this.center.x, y=this.center.y, options={}) {
		let defaults = {
			fill: true,
			stroke: false,
			fillStyles: [],
			strokeStyles: [],
			offsets: [],
			angle: 0,
			centerVertically: true
		};

		let opts = {};
		for(let key in defaults) {
			opts[key] = typeof options[key] !== "undefined" ? options[key] : defaults[key];
		}

		let fonts = fontsArg;
		let numFonts = 0;

		if(typeof fontsArg === "string") { // pass in a single font string
			fonts = [fontsArg];
		}

		if(!fontsArg || fontsArg.length === 0) { // pass in falsy value or empty array
			fonts = [this.offscreenCtx.font];
		}

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

		if(Array.isArray(opts.offsets) && opts.offsets.length) {
			for(let i = 0; i < opts.offsets.length; i++) {
				opts.offsets[i] = {
					x: opts.offsets[i] ? (opts.offsets[i].x || 0) : 0,
					y: opts.offsets[i] ? (opts.offsets[i].y || 0) : 0
				};
			}
		}
		else
		if(!opts.offsets) {
			opts.offsets = [{x: 0, y: 0}];
		}
		else { // offsets is defined, but is a single object, not an array
			opts.offsets = [{
				x: opts.offsets.x || 0,
				y: opts.offsets.y || 0
			}];
		}

		numFonts = fonts.length;
		let numStrings = strings.length;
		let offsetX = 0;
		this.offscreenCtx.save();
		this.offscreenCtx.textAlign = "left"; // "center" will affect our positioning

		if(opts.centerVertically) {
			this.offscreenCtx.textBaseline = "middle";
		}

		// Pre-draw strings, shift left by half
		let stringLengthPx = this.measureStrings(fonts, strings);
		let newLeftX = x - .5 * stringLengthPx;

		if(opts.angle !== 0) {
			this.offscreenCtx.translate(x, y);
			this.offscreenCtx.rotate(opts.angle);
			this.offscreenCtx.translate(-x, -y);
		}

		for(let i = 0; i < numStrings; i++) {
			this.offscreenCtx.save();
			this.offscreenCtx.font = fonts[i % numFonts];

			if(opts.offsets) {
				let offset = opts.offsets[i % opts.offsets.length];
				this.offscreenCtx.translate(offset.x, offset.y);
			}

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
			this.offscreenCtx.restore();
		}

		this.offscreenCtx.restore();

		return new CMPoint(x + .5 * stringLengthPx * Math.cos(opts.angle),
			y + .5 * stringLengthPx * Math.sin(opts.angle));
	}

	/**
	 * Try to play sound effect
	 * @param {string} soundId - a registered string identifying the sound file
	 */
	playSound(soundId) {
		if(!this.soundOn) {
			return;
		}

		let self = this;
		CMSound.play( this.audioSources[soundId] ).then(CMGame.noop, function() {

			// CMSound not working (e.g., when testing locally), default to normal Audio()
			try {
				self.audioMap.get(soundId).play();
			}
			catch(e) {
				console.error(`Error playing sound ${soundId}.
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
		let self = this;
		CMSound.stop( this.audioSources[soundId] ).then(CMGame.noop, () => {
			try {
				self.audioMap.get(soundId).pause();
				self.audioMap.get(soundId).currentTime = 0;
			}
			catch(e) {
				console.error("Error pausing sound " + soundId);
			}
		});
	}

	/**
	 * Try to pause a sound effect (note: most effects are
	 * short, so this is rarely necessary). Maintains currentTime.
	 * @param {string} soundId - a registered string identifying the sound file
	 */
	pauseSound(soundId) {
		let self = this;
		CMSound.stop( this.audioSources[soundId] ).then(CMGame.noop, () => {
			try {
				self.audioMap.get(soundId).pause();
			}
			catch(e) {
				console.error("Error pausing sound " + soundId);
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

		let self = this;
		CMSound.loop( this.audioSources[soundId] ).then(CMGame.noop, () => {

			// CMSound not working (e.g., when testing locally), default to normal Audio()
			try {
				self.audioMap.get(soundId).loop = true;
				self.audioMap.get(soundId).play();
			}
			catch(e) {
				console.error(`Error playing sound ${soundId}.
					Check that all files are loaded.`);
			}
		});
	}

	/**
	 * Try to pause the background music
	 * @param {string} soundId - a registered string identifying the sound file
	 */
	pauseMusic(soundId) {
		let self = this;
		CMSound.pause( this.audioSources[soundId] ).then(CMGame.noop, () => {
			try {
				self.audioMap.get(soundId).pause();
			}
			catch(e) {
				console.error("Error pausing sound " + soundId);
			}
		});
	}

	/**
	 * Try to pause the background music, and
	 * reset its current time to 0.
	 * @param {string} soundId - a registered string identifying the sound file
	 */
	stopMusic(soundId) {
		let self = this;
		CMSound.stop( this.audioSources[soundId] ).then(CMGame.noop, () => {
			try {
				self.audioMap.get(soundId).pause();
				self.audioMap.get(soundId).currentTime = 0;
			}
			catch(e) {
				console.error("Error pausing sound " + soundId);
			}
		});
	}

	/**
	 * Zooms in on "graph" type game. This only affects
	 * graphs and origin. Sprite scaling will need to be
	 * handled separately, for instance in onzoom().
	 * @param {number} newScale - Positive number representing percentage of
	 *   unzoomed picture (e.g. 0.2 for 50%)
	 * @param {object} [centralPoint=this.unzoomedOrigin] - The unzoomed canvas point around
	 *   which the zoomed view is centered
	 * @returns {object} The current CMGame instance
	 */
	zoom(newScale, centralPoint=this.unzoomedOrigin) {

		if(typeof newScale !== "number" ||
				newScale <= 0 ||
				!Number.isFinite(newScale) ||
				Number.isNaN(newScale)) {

			console.error(`zoom() must take a positive integer
				or float value as its argument. Set to 1 for 100%.`);
			return this;
		}

		let oldScale = this.zoomLevel;

		// Account for any (non-unzoomed) values changed after initialization but before zooming
		if(oldScale === 1) {
			this.unzoomedTickDistance = this.tickDistance;
			this.unzoomedGridlineDistance = this.gridlineDistance;
			this.unzoomedOrigin.x = this.origin.x;
			this.unzoomedOrigin.y = this.origin.y;
			this.unzoomedGraphScalar = this.graphScalar;
		}

		this.onbeforezoom(newScale, oldScale);

		this.zoomLevel = newScale;

		// this.graphScalar = this.unzoomedGraphScalar / this.zoomLevel;
		this.tickDistance = this.unzoomedTickDistance / this.zoomLevel;
		this.gridlineDistance = this.unzoomedGridlineDistance / this.zoomLevel;

		// reset zoom to default of 100% before applying new scale
		this.origin.x =
			this.unzoomedOrigin.x;

		this.origin.y =
			this.unzoomedOrigin.y;

		for(let func of this.functions) {
			func.unzoomedStart = new CMPoint(func.start);
			func.unzoomedEnd = new CMPoint(func.end);

			func.origin.x = func.unzoomedOrigin.x = this.origin.x;
			func.origin.y = func.unzoomedOrigin.y = this.origin.y;
		}

		this.graphScalar = this.unzoomedGraphScalar;

		for(let func of this.functions) {
			func.start.x = func.unzoomedStart.x;
			func.start.y = func.unzoomedStart.y;
			func.end.x = func.unzoomedEnd.x;
			func.end.y = func.unzoomedEnd.y;	

			func.updateBounds(oldScale);
		}

		// Just returning to 100%. We're done.
		if(newScale === 1) {
			this.onzoom(newScale, oldScale);
			return this;
		}

		let alpha = (centralPoint.x - this.origin.x) / newScale;
		let beta = (centralPoint.y - this.origin.y) / newScale;

		// Re-center the new "origin"
		this.origin.x = this.origin.x - alpha;
		this.origin.y = this.origin.y - beta;

		for(let func of this.functions) {
			func.origin.x = func.unzoomedOrigin.x = this.origin.x;
			func.origin.y = func.unzoomedOrigin.y = this.origin.y;
		}

		this.graphScalar /= newScale;

		for(let func of this.functions) {
			func.start.x = func.unzoomedStart.x;
			func.start.y = func.unzoomedStart.y;
			func.end.x = func.unzoomedEnd.x;
			func.end.y = func.unzoomedEnd.y;

			func.updateBounds(oldScale);
		}

		this.onzoom(newScale, oldScale);
		
		if(this.paused)
			this.draw();

		return this;
	};

	/**
	 * This is a timeout method particular to the current game.
	 * It is similar to setTimeout, but set by number of frames,
	 * regardless of fps change. If you want a timer using exact
	 * time amounts, use setTimeout instead.
	 * @param {function} callback - The function to invoke after the number of
	 *   frames defined. The callback has current game instance as its `this`
	 *   object and takes the current frameCount value as its only parameter.
	 * @param {number} framesToWait - How many frames to wait before
	 *   the callback is invoked. If this is 0 the function will be invoked
	 *   immediately. Non-integer values will be rounded up.
	 *   Negative values do nothing unless the game's frameCap is a finite
	 *   number. If frameCap is finite, then the value is essentially
	 *   subtracted from current frameCount.
	 * @returns {object} The current CMGame instance
	 */
	setFrameout(callback, framesToWait) {
		framesToWait = Math.ceil(framesToWait);

		if(framesToWait === 0) {
			callback.call(this, this.frameCount);
			return this;
		}

		if(framesToWait < 0) {
			if(!Number.isFinite(this.frameCap)) {
				console.error(`setFrameout() must take non-negative integer as second argument
					if game's frameCap property is not finite`);
				return this;
			}

			return this.setFrameout(CMGame.mod(framesToWait, 0, this.frameCap));
		}

		let targetFrame = (this.frameCount + framesToWait) % this.frameCap;

		// A callback is already registered at this frame, so put these together
		if(this.frameoutFunctions.has(targetFrame)) {
			let oldCallback = this.frameoutFunctions.get(targetFrame);
			let combinedCallbacks = function(frameCount) {
				oldCallback(frameCount);
				callback(frameCount);
			};

			this.frameoutFunctions.set(targetFrame, combinedCallbacks);
		}
		else {
			this.frameoutFunctions.set(targetFrame, callback);
		}

		return this;
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
					r: -y,
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
				x: CMGame.roundSmall( pointOrR * Math.cos(theta) ),
				y: CMGame.roundSmall( pointOrR * Math.sin(theta) )
			};
		}

		return {
			x: CMGame.roundSmall( pointOrR.r * Math.cos(pointOrR.theta) ),
			y: CMGame.roundSmall( pointOrR.r * Math.sin(pointOrR.theta) )
		};
	}

	/**
	 * Converts a given slope, to the corresponding
	 * degrees it would represent on the unit circle,
	 * emanating from the origin.
	 *
	 * See notes in slopeToRadians about multiple
	 * outputs.
	 *
	 * @param {number} slope - The slope (allowing infinite values)
	 * @param {number|string} [direction=1] - Direction from origin that answers can be pulled
	 *    from. Choices are "right" (the default) or 1, and "left" or -1
	 * @returns {number|array}
	 */
	slopeToDegrees(slope, direction) {

		// Handle vertical slopes first
		if(!Number.isFinite(slope)) {
			switch(direction) {
				case "right":
				case 1:
					if(slope === Infinity)
						return 90;
					else
						return 270;
				case "left":
				case 2:
					if(slope === Infinity)
						return 270;
					else
						return 90;
				default:
					return [90, 270];
			}
		}

		let rads = this.slopeToRadians(slope, direction);

		if(Array.isArray(rads))
			return [this.toDegrees(rads[0]), this.toDegrees(rads[1])];

		return this.toDegrees(rads);
	}

	/**
	 * Converts a given slope, to the corresponding
	 * radians it would represent on the unit circle,
	 * emanating from the origin (0, 0).
	 *
	 * Note: As every slope will have exactly two points on
	 * the unit circle corresponding to it (on either side of
	 * the origin), we must define which quadrants we are
	 * allowed to pull our answer from.
	 * "right" or 1 (Math.sign of any positive x value) gives
	 *   the value to the right of the y-axis; "left" or -1 gives
	 *   the value to the left (any value ON the y-axis has
	 *   infinite slope, so will be returned immediately).
	 * Any other second argument (0, 3, or whatever is preferred)
	 *   will return a 2-element array with both values, in
	 *   increasing order.
	 *
	 * @param {number} slope - The slope (allowing infinite values)
	 * @param {number|string} [direction=1] - Direction from origin that answers can be pulled
	 *    from. Choices are 1 or "right" or right of the y-axis, -1 or "left" for left (0 for both).
	 * @returns {number|array}
	 */
	slopeToRadians(slope, direction=1) {

		// Handle vertical slopes first
		if(!Number.isFinite(slope)) {
			switch(direction) {
				case "right":
				case 1:
					if(slope === Infinity)
						return .5 * Math.PI;
					else
						return 1.5 * Math.PI;
				case "left":
				case 2:
					if(slope === Infinity)
						return 1.5 * Math.PI;
					else
						return .5 * Math.PI;
				default:
					return [.5 * Math.PI, 1.5 * Math.PI];
			}
		}

		// Convert a point with slope as "slope / 1" from the origin
		let theta = this.toPolar({
				x: 1,
				y: slope
			}).theta;

		switch(direction) {
			case "right":
			case 1:
				return theta;
			case "left":
			case -1:
				return CMGame.mod( theta + Math.PI, 0, Math.TAU );
			case 0:
			default:
				return [theta, CMGame.mod( theta + Math.PI, 0, Math.TAU )].sort();
		}
	}

	/**
	 * Converts the degrees on the unit circle, to
	 * the corresponding slope. Returns Infinity
	 * for 90deg, and -Infinity for 270.
	 * @param {number} deg - The degrees (from 0 inclusive to 360 exclusive)
	 * @returns {number}
	 */
	degreesToSlope(deg) {

		// move deg to appropriate bounds
		deg = CMGame.mod(deg, 0, 360);

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
	 * the corresponding slope (of points ordered
	 * from left to right along the x-axis). Returns Infinity
	 * for pi/2, and -Infinity for 3pi/2
	 * @param {number} rad - The radians (from 0 inclusive to 2pi exclusive)
	 * @returns {number}
	 */
	radiansToSlope(rad) {

		// move rad to appropriate bounds
		rad = CMGame.mod(rad, 0, Math.TAU);

		if(rad === Math.PI / 2) {
			return Infinity;
		}

		if(rad === 3 * Math.PI / 2) {
			return -Infinity;
		}

		return Math.tan( rad );
	}

	/**
	 * Gets the slope between two two-dimensional points.
	 * Note: JavaScript will return Infinity or -Infinity for a division by
	 * zero. The dev may want to check the answer with
	 * Number.isFinite() and set as "undefined" or undefined.
	 *
	 * Note: This defines slope of a generic real line. Since screen points
	 * are drawn with y values upside-down, you may need to
	 * change sign when working with screen points.
	 *
	 * @param {object} startPoint - The first point
	 * @param {object} endPoint - The second point
	 * @returns {number}
	 */
	getSlope(startPoint, endPoint) {
		return (endPoint.y - startPoint.y) / (endPoint.x - startPoint.x);
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
	 * diagram. Currently only relates to game type "venn".
	 * For best results, use a canvas in a 4:3 ratio (e.g.,
	 * width of 640 and height of 480).
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
		let radius = 0;

		/**
		 * Note: since sprites are drawn in order of creation,
		 * we need to be sure to draw regions before sets
		 */
		switch(numSets) {
			case 0:
			default:
				this.vennRegions.set("I", new CMVennRegion(
					this,
					"",
					0
				));
				break;
			case 1:
				this.vennRegions.set("I", new CMVennRegion(
					this,
					"0",
					0
				));

				this.vennRegions.set("II", new CMVennRegion(
					this,
					"1",
					0
				));

				radius = Math.min(this.width, this.height) * (7 / 20);

				this.vennSets.set("A", new CMVennSet(
					this,
					.5 * this.width,
					.5 * this.height,
					radius,
					{
						text: "A",
						x: .5 * this.width + .75 * radius,
						y: .5 * this.height + radius
					}
				));
				break;
			case 2:
				if(variation === 1) {
					this.vennRegions.set("I", new CMVennRegion(
						this,
						"0S0", // U \ B
						1
					));

					this.vennRegions.set("II", new CMVennRegion(
						this,
						"0S1", // B \ A
						1
					));

					this.vennRegions.set("III", new CMVennRegion(
						this,
						"1S1", // A = A && B
						1
					));

					radius = Math.round(this.height * (9 / 40));
					this.vennSets.set("A", new CMVennSet(
						this,
						Math.round(.5 * this.width),
						Math.round(.6 * this.height),
						radius,
						{
							text: "A",
							x: Math.round(.5 * this.width + .65 * radius),
							y: Math.round(.6 * this.height + .95 * radius)
						}
					));

					radius = .4 * this.height;
					this.vennSets.set("B", new CMVennSet(
						this,
						.5 * this.width,
						.5 * this.height,
						radius,
						{
							text: "B",
							x: .5 * this.width + .65 * radius,
							y: .5 * this.height + .9 * radius
						}
					));
				}
				else {
					this.vennRegions.set("I", new CMVennRegion(
						this,
						"00",
						0
					));

					this.vennRegions.set("II", new CMVennRegion(
						this,
						"10",
						0
					));

					this.vennRegions.set("III", new CMVennRegion(
						this,
						"01",
						0
					));

					this.vennRegions.set("IV", new CMVennRegion(
						this,
						"11",
						0
					));

					radius = Math.min(this.width, this.height) * (7 / 20);

					this.vennSets.set("A", new CMVennSet(
						this,
						.5 * this.width - (radius / 2.1),
						.5 * this.height,
						radius,
						{
							text: "A",
							x: .5 * this.width - (radius / 2.1) - .75 * radius - this.ctx.measureText("A").width,
							y: .5 * this.height + radius
						}
					));

					this.vennSets.set("B", new CMVennSet(
						this,
						.5 * this.width + (radius / 2.1),
						.5 * this.height,
						radius,
						{
							text: "B",
							x: .5 * this.width + (radius / 2.1) + .75 * radius,
							y: .5 * this.height + radius
						}
					));
				}
				break;
			case 3:
				if(variation === 1) { // 3 sets as subsets of each other
					this.vennRegions.set("I", new CMVennRegion(
						this,
						"0S0S0", // U \ C
						1
					));

					this.vennRegions.set("II", new CMVennRegion(
						this,
						"0S0S1", // C \ B
						1
					));

					this.vennRegions.set("III", new CMVennRegion(
						this,
						"0S1S1", // B \ A, necessarily is contained in C
						1
					));

					this.vennRegions.set("IV", new CMVennRegion(
						this,
						"1S1S1", // A, necessarily is contained in B and C
						1
					));
					
					radius = this.height / 6;
					this.vennSets.set("A", new CMVennSet(
						this,
						.5 * this.width,
						(73 / 120) * this.height,
						radius,
						{
							text: "A",
							x: .5 * this.width + .6 * radius,
							y: (73 / 120) * this.height + radius
						}
					));

					radius = 0.28125 * this.height;
					this.vennSets.set("B", new CMVennSet(
						this,
						.5 * this.width,
						(67 / 120) * this.height,
						radius,
						{
							text: "B",
							x: .5 * this.width + .8 * radius,
							y: (67 / 120) * this.height + .75 * radius
						}
					));

					radius = .4 * this.height;
					this.vennSets.set("C", new CMVennSet(
						this,
						.5 * this.width,
						.5 * this.height,
						radius,
						{
							text: "C",
							x: .5 * this.width + .9 * radius,
							y: .5 * this.height + .55 * radius
						}
					));

				}
				else
				if(variation === 2) { // 3 sets in a "T" shape
					this.vennRegions.set("I", new CMVennRegion(
						this,
						"000", // Complement of all sets
						2
					));

					this.vennRegions.set("II", new CMVennRegion(
						this,
						"100",
						2
					));

					this.vennRegions.set("III", new CMVennRegion(
						this,
						"010",
						2
					));
					
					this.vennRegions.set("IV", new CMVennRegion(
						this,
						"001",
						2
					));

					this.vennRegions.set("V", new CMVennRegion(
						this,
						"110",
						2
					));
					
					this.vennRegions.set("VI", new CMVennRegion(
						this,
						"101",
						2
					));
					
					this.vennRegions.set("VII", new CMVennRegion(
						this,
						"011",
						2
					));
					
					this.vennRegions.set("VIII", new CMVennRegion(
						this,
						"111", // Intersection of all sets A, B, C
						2
					));

					radius = .3 * Math.min(this.width, this.height);

					this.vennSets.set("A", new CMVennSet(
						this,
						.4 * this.width,
						.35 * this.height,
						radius,
						{
							text: "A",
							x: .4 * this.width - .775 * radius - this.ctx.measureText("A").width,
							y: .35 * this.height - .75 * radius
						}
					));

					this.vennSets.set("B", new CMVennSet(
						this,
						.8 * Math.min(this.width, this.height),
						.35 * this.height,
						radius,
						{
							text: "B",
							x: .6 * this.width + .775 * radius,
							y: .35 * this.height - .75 * radius
						}
					));	

					this.vennSets.set("C", new CMVennSet(
						this,
						.5 * this.width,
						0.625 * this.height,
						radius,
						{
							text: "C",
							x: .5 * this.width + .6 * radius,
							y: 0.625 * this.height + .9 * radius
						}
					));
				}
				else { // default - variation 0; C on top, A, B on bottom

					this.vennRegions.set("I", new CMVennRegion(
						this,
						"000", // Complement of all sets
						0
					));

					this.vennRegions.set("II", new CMVennRegion(
						this,
						"100",
						0
					));

					this.vennRegions.set("III", new CMVennRegion(
						this,
						"010",
						0
					));
					
					this.vennRegions.set("IV", new CMVennRegion(
						this,
						"001",
						0
					));

					this.vennRegions.set("V", new CMVennRegion(
						this,
						"110",
						0
					));
					
					this.vennRegions.set("VI", new CMVennRegion(
						this,
						"101",
						0
					));
					
					this.vennRegions.set("VII", new CMVennRegion(
						this,
						"011",
						0
					));
					
					this.vennRegions.set("VIII", new CMVennRegion(
						this,
						"111", // Intersection of all sets A, B, C
						0
					));

					radius = .3 * Math.min(this.width, this.height);

					this.vennSets.set("A", new CMVennSet(
						this,
						.4 * this.width,
						0.625 * this.height,
						radius,
						{
							text: "A",
							x: .4 * this.width - .75 * radius - this.ctx.measureText("A").width,
							y: 0.625 * this.height + radius
						}
					));

					this.vennSets.set("B", new CMVennSet(
						this,
						.6 * this.width,
						0.625 * this.height,
						radius,
						{
							text: "B",
							x: .6 * this.width + .75 * radius,
							y: 0.625 * this.height + radius
						}
					));

					this.vennSets.set("C", new CMVennSet(
						this,
						.5 * this.width,
						.35 * this.height,
						radius,
						{
							text: "C",
							x: .5 * this.width + .75 * radius,
							y: .35 * this.height - .75 * radius
						}
					));
				}
				break;
		}

		this.ctx.restore(); // return to previous font
	}

	/**
	 * Adds a new vertex to a "graphtheory" game
	 * @param {object} vertex - A CMVertex instance
	 * @returns {object} The current CMGame instance
	 */
	addVertex(vertex) {
		if(vertex && !this.vertices.includes(vertex)) {
			this.vertices.push(vertex);
		}

		return this;
	}

	/**
	 * Similar to addVertex, but lets dev add
	 * multiple vertices at once.
	 * @param {...object} vertices - A list of CMGame.Vertex instances
	 * @returns {object} The current CMGame instance
	 */
	addVertices(...vertices) {
		let self = this,
			vertexArr = vertices;

		if(arguments.length === 1 && Array.isArray(arguments[0])) {
			vertexArr = arguments[0];
		}

		vertexArr.forEach(vertex => self.addVertex(vertex));
		return this;
	}

	/**
	 * Removes an vertex from a "graphtheory" game
	 * @param {object} vertex - A CMVertex instance
	 * @returns {object} The current CMGame instance
	 */
	removeVertex(vertex) {
		if(vertex && this.vertices.includes(vertex)) {
			this.vertices.splice(this.vertices.indexOf(vertex), 1);
		}

		return this;
	}

	/**
	 * Similar to removeVertex, but lets dev remove
	 * multiple vertices at once.
	 * @param {...object} vertices - A list of CMGame.Vertex instances
	 * @returns {object} The current CMGame instance
	 */
	removeVertices(...vertices) {
		let vertexArr = vertices;

		if(arguments.length === 1 && Array.isArray(arguments[0])) {
			vertexArr = arguments[0];
		}

		let len = vertexArr.length;
		while(len--) {
			this.removeVertex(vertexArr[len]);
		}

		return this;
	}

	/**
	 * Adds a new edge to a "graphtheory" game
	 * @param {object} edge - A CMEdge instance
	 * @returns {object} The current CMGame instance
	 */
	addEdge(edge) {
		if(edge && !this.edges.includes(edge)) {
			this.edges.push(edge);
		}

		return this;
	}

	/**
	 * Similar to addEdge, but lets dev add
	 * multiple edges at once.
	 * @param {...object} edges - A list of CMGame.Edge instances
	 * @returns {object} The current CMGame instance
	 */
	addEdges(...edges) {
		let self = this,
			edgeArr = edges;

		if(arguments.length === 1 && Array.isArray(arguments[0])) {
			edgeArr = arguments[0];
		}

		edgeArr.forEach(edge => self.addEdge(edge));
		return this;
	}

	/**
	 * Removes an edge from a "graphtheory" game
	 * @param {object} edge - A CMEdge instance
	 * @returns {object} The current CMGame instance
	 */
	removeEdge(edge) {
		if(edge && this.edges.includes(edge)) {
			this.edges.splice(this.edges.indexOf(edge), 1);
		}

		return this;
	}

	/**
	 * Similar to removeEdge, but lets dev remove
	 * multiple edges at once.
	 * @param {...object} edges - A list of CMGame.Edge instances
	 * @returns {object} The current CMGame instance
	 */
	removeEdges(...edges) {
		let edgeArr = edges;

		if(arguments.length === 1 && Array.isArray(arguments[0])) {
			edgeArr = arguments[0];
		}

		let len = edgeArr.length;
		while(len--) {
			this.removeEdge(edgeArr[len]);
		}

		return this;
	}

	/**
	 * Checks if two items are close enough to be indistinguishable
	 * for the current game (e.g., numbers relative to current
	 * graphScalar). Compares two numbers or two CMPoint instances.
	 * @param {number|object} val - The first number, or point-like object
	 * @param {number|object} otherVal - The second number, or point-like object
	 * @returns {boolean}
	 */
	almostEqual(val, otherVal) {
		if(typeof val === "object") {
			return new CMPoint(val).isAlmost(new CMPoint(otherVal));
		}

		return Math.abs(val - otherVal) < 1 / this.graphScalar;
	}

	/**
	 * Gets an array of the sprites currently in the
	 * game. To keep code future-proof (considering
	 * that game.sprites may be stored in a Map
	 * rather than an array) this method should be used
	 * instead of accessing game.sprites directly
	 * @returns {array}
	 */
	getSprites() {
		return this.sprites;
	}

	/**
	 * Gets an array of the functions
	 * currently in the game.
	 * See notes in getSprites()
	 * @returns {array}
	 */
	getFunctions() {
		return this.functions;
	}

	/**
	 * Gets an array of the graph theory
	 * edges currently in the game.
	 * See notes in getSprites()
	 * @returns {array}
	 */
	getEdges() {
		return this.edges;
	}

	/**
	 * Gets an array of the graph theory
	 * vertices currently in the game.
	 * See notes in getSprites()
	 * @returns {array}
	 */
	getVertices() {
		return this.vertices;
	}

	/**
	 * Gets an array of the venn diagram
	 * regions currently in the game.
	 * See notes in getSprites()
	 * @returns {array}
	 */
	getVennRegions() {
		return Array.from( this.vennRegions.values() );
	}

	/**
	 * Gets an array of the venn diagram
	 *  sets currently in the game.
	 * See notes in getSprites()
	 * @returns {array}
	 */
	getVennSets() {
		return Array.from( this.vennSets.values() );
	}

	/**
	 * Gets an array of the CMDoodle
	 * objects currently in the game.
	 * See notes in getSprites()
	 * @returns {array}
	 */
	getDoodles() {
		return this.doodles;
	}

	/**
	 * Presents a pop-up message, which halts the
	 * game similar to window.alert, but without
	 * actually blocking the JS main thread.
	 * Rather than blocking and waiting for user to
	 * press OK, this returns a Promise that resolves
	 * when user presses OK.
	 * If the game is running, it pauses until just
	 * before the returned promise resolves.
	 * @param {string} [msg=""] - A message to display. This can be plain text or HTML.
	 * @param {object} [options={}] - A plain JS object of options.
	 * @param {string} [options.headerText] - String to write in the header. Defaults
	 *   to standard alert header.
	 * @param {string} [options.buttonText] - String to write in OK button. Default is "OK".
	 * @param {string} [options.button1Text] - Same as button1Text. Only provided for
	 *   naming option consistent with confirm() and prompt().
	 * @param {boolean} [options.draggable] - true to let player drag modal around. Default is false.
	 * @returns {Promise}
	 */
	alert(msg="", options={}) {
		let self = this;

		let pauseState = this.paused;
		if(!pauseState) {
			this.pause();
		}

		let doodleEnabledState = this.doodleOptions.enabled;
		if(doodleEnabledState) {
			this.doodleOptions.enabled = false;
		}

		this.alertMessage.innerHTML = msg;
		this.alertCancelButton.style.display = "none";
		this.alertInput.style.display = "none";
		this.alertInput.addEventListener("blur", function(e) {
			// Mitigate bug in some mobile browsers that shifts document when keyboard opens
			document.documentElement.scrollTop = CMGame.documentScrollTop;
		}, false);

		this.alertElement.querySelector("h3").innerText =
			options.headerText ||
			((document.title || "Game") + " says:");

		this.alertOKButton.innerHTML = options.buttonText || options.button1Text || "OK";

		// draggable is convenient, but adds multiple handlers
		if(options.draggable) {
			let oldX = this.alertElement.offsetLeft;
			let oldY = this.alertElement.offsetTop;
			let modalPressed = false;

			this.alertElement.onmousedown = this.alertElement.ontouchstart = function(e) {
				modalPressed = true;

				if(e.type === "touchstart") {
					oldX = e.targetTouches[0].clientX;
					oldY = e.targetTouches[0].clientY;
				}
				else {
					oldX = e.clientX;
					oldY = e.clientY;
				}
			};

			this.alertElement.onmouseup = this.alertElement.ontouchend = function(e) {
				modalPressed = false;
			};

			this.alertElement.onmousemove = this.alertElement.ontouchmove = function(e) {
				if(!modalPressed) // Must "drag" to move
					return;

				let x = 0;
				let y = 0;

				if(e.type === "touchmove") {
					x = e.targetTouches[0].clientX;
					y = e.targetTouches[0].clientY;
				}
				else {
					x = e.clientX;
					y = e.clientY;
				}

				let offsetX = x - oldX;
				let offsetY = y - oldY;

				oldX = x;
				oldY = y;

				self.alertElement.style.left = (

					parseInt(
						window.getComputedStyle( self.alertElement )
							.getPropertyValue("left")
							.replace("px", "")
					) +

					offsetX
				) + "px";

				self.alertElement.style.top = (

					parseInt(
						window.getComputedStyle( self.alertElement )
							.getPropertyValue("top")
							.replace("px", "")
					) +

					offsetY
				) + "px";
			};
		}
		else {
			this.alertElement.onmousedown = null;
			this.alertElement.onmouseup = null;
			this.alertElement.onmousemove = null;

			this.alertElement.ontouchstart = null;
			this.alertElement.ontouchend = null;
			this.alertElement.ontouchmove = null;
		}

		return new Promise(function(resolve, reject) {
			self.alertOKButton.onclick = function(e) {
				e.preventDefault();
				self.alertOverlay.style.display = "none";
				self.alertElement.style.left = "";
				self.alertElement.style.top = "";

				if(!pauseState) {
					self.unpause();
				}

				if(doodleEnabledState) {
					self.doodleOptions.enabled = true;
				}

				resolve();
			};

			self.alertOKButton.focus();
			self.alertOverlay.style.display = "block";			
		});
	}

	/**
	 * Creates a "confirm" dialog, similar to window.confirm,
	 * and halts current game processes without actually
	 * blocking the JS main thread.
	 * Rather than blocking and returning a boolean,
	 * this returns a promise, that resolves with the
	 * boolean (true if user pressed OK, false otherwise).
	 * If the game is running, it pauses until just
	 * before the returned promise resolves.
	 * @param {string} [msg=""] - A message to display. This can be plain text or HTML.
	 * @param {object} [options={}] - A plain JS object of options.
	 * @param {string} [options.headerText] - String to write in the header. Defaults
	 *   to standard alert header.
	 * @param {string} [options.button1Text] - String to write in OK button. Default is "OK".
	 * @param {string} [options.button2Text] - String to write in Cancel button. Default is "Cancel".
	 * @param {boolean} [options.draggable] - true to let player drag modal around. Default is false.
	 * @returns {Promise}
	 */
	confirm(msg="", options={}) {
		let self = this;

		let pauseState = this.paused;
		if(!pauseState) {
			this.pause();
		}

		let doodleEnabledState = this.doodleOptions.enabled;
		if(doodleEnabledState) {
			this.doodleOptions.enabled = false;
		}

		this.alertMessage.innerHTML = msg;
		this.alertCancelButton.style.display = "inline-block";
		this.alertInput.style.display = "none";

		this.alertElement.querySelector("h3").innerText =
			options.headerText ||
			((document.title || "Game") + " says:");

		this.alertOKButton.innerHTML = options.button1Text || "OK";
		this.alertCancelButton.innerHTML = options.button2Text || "Cancel";

		// draggable is convenient, but adds multiple handlers
		if(options.draggable) {
			let oldX = this.alertElement.offsetLeft;
			let oldY = this.alertElement.offsetTop;
			let modalPressed = false;

			this.alertElement.onmousedown = this.alertElement.ontouchstart = function(e) {
				modalPressed = true;

				if(e.type === "touchstart") {
					oldX = e.targetTouches[0].clientX;
					oldY = e.targetTouches[0].clientY;
				}
				else {
					oldX = e.clientX;
					oldY = e.clientY;
				}
			};

			this.alertElement.onmouseup = this.alertElement.ontouchend = function(e) {
				modalPressed = false;
			};

			this.alertElement.onmousemove = this.alertElement.ontouchmove = function(e) {
				if(!modalPressed) // Must "drag" to move
					return;

				let x = 0;
				let y = 0;

				if(e.type === "touchmove") {
					x = e.targetTouches[0].clientX;
					y = e.targetTouches[0].clientY;
				}
				else {
					x = e.clientX;
					y = e.clientY;
				}

				let offsetX = x - oldX;
				let offsetY = y - oldY;

				oldX = x;
				oldY = y;

				self.alertElement.style.left = (

					parseInt(
						window.getComputedStyle( self.alertElement )
							.getPropertyValue("left")
							.replace("px", "")
					) +

					offsetX
				) + "px";

				self.alertElement.style.top = (

					parseInt(
						window.getComputedStyle( self.alertElement )
							.getPropertyValue("top")
							.replace("px", "")
					) +

					offsetY
				) + "px";
			};
		}
		else {
			this.alertElement.onmousedown = null;
			this.alertElement.onmouseup = null;
			this.alertElement.onmousemove = null;

			this.alertElement.ontouchstart = null;
			this.alertElement.ontouchend = null;
			this.alertElement.ontouchmove = null;
		}

		return new Promise(function(resolve, reject) {
			self.alertOKButton.onclick = function(e) {
				e.preventDefault();
				self.alertOverlay.style.display = "none";
				self.alertElement.style.left = "";
				self.alertElement.style.top = "";

				if(!pauseState) {
					self.unpause();
				}

				if(doodleEnabledState) {
					self.doodleOptions.enabled = true;
				}

				resolve(true);
			};

			self.alertOKButton.focus();
			self.alertCancelButton.onclick = function(e) {
				e.preventDefault();
				self.alertOverlay.style.display = "none";
				self.alertElement.style.left = "";
				self.alertElement.style.top = "";

				if(!pauseState) {
					self.unpause();
				}

				if(doodleEnabledState) {
					self.doodleOptions.enabled = true;
				}

				resolve(false);
			};

			self.alertOverlay.style.display = "block";
		});
	}

	/**
	 * Creates a "prompt" dialog, similar to window.prompt,
	 * and halts current game processes without actually
	 * blocking the JS main thread.
	 * Rather than blocking and returning entered text,
	 * this returns a promise, that resolves with the
	 * entered text if the user press OK, and with null otherwise.
	 * If the game is running, it pauses until just
	 * before the returned promise resolves.
	 * @param {string} [msg=""] - A message to display. This can be plain text or HTML.
	 * @param {string} [defaultString=""] - A string to load in the textbox instead of leaving blank
	 * @param {object} [options={}] - A plain JS object of options.
	 * @param {string} [options.headerText] - String to write in the header. Defaults
	 *   to standard alert header.
	 * @param {string} [options.button1Text] - String to write in OK button. Default is "OK".
	 * @param {string} [options.button2Text] - String to write in Cancel button. Default is "Cancel".
	 * @param {string} [options.placeholder] - "placeholder" text for the input element
	 * @param {boolean} [options.draggable] - true to let player drag modal around. Default is false.
	 * @returns {Promise}
	 */
	prompt(msg="", defaultString="", options={}) {
		let self = this;

		let pauseState = this.paused;
		if(!pauseState) {
			this.pause();
		}

		let doodleEnabledState = this.doodleOptions.enabled;
		if(doodleEnabledState) {
			this.doodleOptions.enabled = false;
		}

		// Record document's fixed position before mobile keyboard moves it around
		CMGame.documentScrollTop = document.documentElement.scrollTop || 0;

		this.alertMessage.innerHTML = msg;
		this.alertInput.placeholder = options.placeholder || "";
		this.alertInput.value = defaultString;
		this.alertInput.style.display = "inline-block";
		this.alertCancelButton.style.display = "inline-block";

		this.alertElement.querySelector("h3").innerText =
			options.headerText ||
			((document.title || "Game") + " says:");

		this.alertOKButton.innerHTML = options.button1Text || "OK";
		this.alertCancelButton.innerHTML = options.button2Text || "Cancel";

		// draggable is convenient, but adds multiple handlers
		if(options.draggable) {
			let oldX = this.alertElement.offsetLeft;
			let oldY = this.alertElement.offsetTop;
			let modalPressed = false;

			this.alertElement.onmousedown = this.alertElement.ontouchstart = function(e) {
				modalPressed = true;

				if(e.type === "touchstart") {
					oldX = e.targetTouches[0].clientX;
					oldY = e.targetTouches[0].clientY;
				}
				else {
					oldX = e.clientX;
					oldY = e.clientY;
				}
			};

			this.alertElement.onmouseup = this.alertElement.ontouchend = function(e) {
				modalPressed = false;
			};

			this.alertElement.onmousemove = this.alertElement.ontouchmove = function(e) {
				if(!modalPressed) // Must "drag" to move
					return;

				let x = 0;
				let y = 0;

				if(e.type === "touchmove") {
					x = e.targetTouches[0].clientX;
					y = e.targetTouches[0].clientY;
				}
				else {
					x = e.clientX;
					y = e.clientY;
				}

				let offsetX = x - oldX;
				let offsetY = y - oldY;

				oldX = x;
				oldY = y;

				self.alertElement.style.left = (

					parseInt(
						window.getComputedStyle( self.alertElement )
							.getPropertyValue("left")
							.replace("px", "")
					) +

					offsetX
				) + "px";

				self.alertElement.style.top = (

					parseInt(
						window.getComputedStyle( self.alertElement )
							.getPropertyValue("top")
							.replace("px", "")
					) +

					offsetY
				) + "px";
			};
		}
		else {
			this.alertElement.onmousedown = null;
			this.alertElement.onmouseup = null;
			this.alertElement.onmousemove = null;

			this.alertElement.ontouchstart = null;
			this.alertElement.ontouchend = null;
			this.alertElement.ontouchmove = null;
		}

		return new Promise(function(resolve, reject) {
			self.alertOKButton.onclick = function(e) {
				e.preventDefault();
				self.alertOverlay.style.display = "none";
				self.alertElement.style.left = "";
				self.alertElement.style.top = "";

				if(!pauseState) {
					self.unpause();
				}

				if(doodleEnabledState) {
					self.doodleOptions.enabled = true;
				}

				resolve(self.alertInput.value);
			};

			self.alertCancelButton.style.display = "inline-block";
			self.alertCancelButton.onclick = function(e) {
				e.preventDefault();
				self.alertOverlay.style.display = "none";
				self.alertElement.style.left = "";
				self.alertElement.style.top = "";

				if(!pauseState) {
					self.unpause();
				}

				if(doodleEnabledState) {
					self.doodleOptions.enabled = true;
				}

				resolve(null);
			};

			self.alertOverlay.style.display = "block";
			self.alertInput.focus();
		});
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
			console.warn("Cannot lock orientation on this device");
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
 * and removes the item, or removes a specific
 * item 
 * @param {array|object} arr - Any array, Map instance, or plain JS object
 * @param {*} [item] - The specific item to remove
 * @returns {*}
 */
CMGame.pluckFrom = (arr, item) => {
	if(Array.isArray(arr)) {
		if(item)
			return arr.splice(arr.indexOf(item), 1)[0];

		return arr.splice(CMRandom.range(0, arr.length), 1)[0];
	}
	else
	if(arr instanceof Map) {
		let keyOfItem = -1;
		let tempArr = [];

		for(let [key, value] of arr) {
			tempArr.push(value);

			if(value === item) {
				keyOfItem = key;
			}
		}

		if(item) {
			arr.delete(keyOfItem);
			return item;
		}

		let itemKey = tempArr[CMRandom.range(0, tempArr.length)];
		arr.delete(itemKey); // Removes key-value association, without destroying object
		return arr.get(itemKey);
	}
	else { // Assume a normal JS object
		let entriesArr = Object.entries(arr);

		let chosenKey = item ? entriesArr.find(arr => arr[1] === item)[0] :
				entriesArr[CMRandom.range(0, entriesArr.length)][0];

		let val = arr[chosenKey];

		delete arr[chosenKey];
		return val;
	}
};

/**
 * Shuffles an array and returns shuffled version.
 * Note: the original array WILL be modified
 * @param {array} arr - Any array
 * @returns {array}
 */
CMGame.shuffle = (arr) => {

	// JSON.parse( JSON.stringify(arr) ); only works for primitive objects, so we need to rebuild

	// Create copy to pluck from
	let tempArray = [];
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
};

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
 * Further, this only detects if the items occur
 * in sequential, consecutive order. Mainly used
 * to detect sequences of swipes.
 * @param {array} subArray - The array to check is included
 * @param {array} bigArray - The array to check contains subArr
 * @returns {boolean}
 */
CMGame.isPrimitiveSubArray = (subArr, bigArr) => {
	const delimiter = "{(*&$(*(";
	return bigArr.join(delimiter).includes(subArr.join(delimiter));
};

// Empty function. Static so can be used as placeholder before page load
CMGame.noop = () => { /* noop */ };

/**
 * A convenience method, mostly used internally,
 * for getting a filename without file extension
 * or preceding path. Used, e.g., for assigning
 * a key string to a given resource.
 * @param {string} filename - The file path
 * @returns {string}
 */
CMGame.trimFilename = (filename) => {

	// Clip off ".gif", ".wav", etc.
	let extensionless = filename.substr(0,
		filename.lastIndexOf(".")
	);

	// Clip off entire path before filename (e.g., "http://mysite.com/media/img/")
	let trimmedString = extensionless.substr(
		extensionless.lastIndexOf("/") + 1
	);

	return trimmedString;
}

/**
 * We only use browser detection for features where it
 * is absolutely necessary, like working with haptic feedback
 * vs. contextmenu, or detecting screen size with/without
 * actual fullscreen support
 */
CMGame.running_Android = !!window.navigator.userAgent.match(/android/gi);

// iOS detection based on various answers found here:
// https://stackoverflow.com/questions/9038625/detect-if-device-is-ios
CMGame.running_iOS = !!(/ipad|iphone|ipod/gi.test(navigator.userAgent) ||
	(navigator.userAgent.includes("Mac") && "ontouchend" in document) || // iPad on iOS 13 detection
	(navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) ||
	window.navigator.platform.match(/ipad|iphone|ipod/gi)) &&
	!window.MSStream;

// For working with screen repositioning from mobile keyboards
CMGame.documentScrollTop = document.documentElement.scrollTop || 0;

// Do our best to get largest possible dimensions (fullscreen)
if(CMGame.running_iOS) { // No fullscreen for iPhone, so just get available dimensions
	CMGame.screenWidth = window.screen.availWidth;
	CMGame.screenHeight = window.screen.availHeight;

	// iOS acts up when trying to access document.body.clientWidth or .clientHeight
	if(!documentBody.clientWidth) {
		documentBody.clientWidth = CMGame.screenWidth;
		documentBody.clientHeight = CMGame.screenHeight;
	}
}
else {
	if(window.screen && window.screen.width) {
		CMGame.screenWidth = window.screen.width;
		CMGame.screenHeight = window.screen.height;
	} else if(window.outerWidth) {
		CMGame.screenWidth = window.outerWidth;
		CMGame.screenHeight = window.outerHeight;
	} else {
		CMGame.screenWidth = document.documentElement.clientWidth;
		CMGame.screenHeight = document.documentElement.clientHeight;
	}
}

// This method is static so user can set it before creating a CMGame instance
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

	// If HTML was written with no <body> tag, remove any extra generated tags
	if(document.querySelectorAll("body").length > 1) {
		let notBody = null;

		document.querySelectorAll("body").forEach(elm => {
			if(elm !== document.body) {
				elm.parentNode.removeChild(elm);
			}
		});
	}

	// Try to force a game page that allowed occasional scrolling to reload at the top left
	window.scrollTo(0, 0);
	document.documentElement.scrollTop = 0;
	document.documentElement.scrollLeft = 0;
	
	CMGame.pageLoaded = true;
	CMGame.onpageload.call(window, e);
	domLoaded = true;
	initializeIfReady();
};

// More tricks to force a scrolled page to reload at the top left
window.history.scrollRestoration = "manual";
document.documentElement.addEventListener("load", () => {
	window.scrollTo(0, 0);
	document.documentElement.scrollTop = 0;
	document.documentElement.scrollLeft = 0;
}, false);

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

(function() {
	Object.defineProperty(CMGame, "MAX_FPS", {
		value: 60,
		writable: false
	});

	Object.defineProperty(CMGame, "MIN_FRAME_DELAY", {
		value: 16.7,
		writable: false
	});
}());

(function() {
	/**
	 * game.fps is animation speed (roughly) in frames per second
	 * game.frameDelay is the milliseconds between frames
	 *
	 * These are the rough "fps" and delay between
	 * frames using requestNextFrame. This is
	 * the fastest expected animation rate, so these
	 * should only be changed if you purposely want
	 * to create a slower game or animation.
	 */

	Object.defineProperty(CMGame.prototype, "fps", {
		get() {
			return this.fps_Private;
		},

		set(newFPS) {
			this.fps_Private = Math.min(newFPS, CMGame.MAX_FPS);

			if(this.frameDelay_Private !== 1000 / this.fps_Private) {
				this.frameDelay_Private = 1000 / this.fps_Private;
			}
		}
	});

	Object.defineProperty(CMGame.prototype, "frameDelay", {
		get() {
			return this.frameDelay_Private;
		},

		set(newFrameDelay) {
			let self = this;
			this.frameDelay_Private = Math.max(newFrameDelay, CMGame.MIN_FRAME_DELAY);

			if(this.fps_Private !== Math.floor(1000 / this.frameDelay_Private)) {
				this.fps_Private = Math.floor(1000 / this.frameDelay_Private);
			}

			// Note: cancelNextFrame has same functionality regardless of fps
			window.requestNextFrame = function(callback) {
				self.awaitingAnimFrame = true;
				setTimeout(function() {
					if(!self.paused)
						self.animFrameId = requestAnimationFrame(callback);

					self.awaitingAnimFrame = false;
				}, newFrameDelay);
			};
		}
	});
}());

/**
 * The CMColor class is mainly used to
 * store static color values, though
 * individual instances can be created
 * for manipulations like changing
 * darkness or opacity.
 */
class CMColor {

	/**
	 * Creates a CMColor instance. If no arguments
	 * are passed in, this is defined as an opaque black.
	 * A CMColor instance is not a string, so in use, you
	 * access an instance's (say "myColor") color string
	 * with myColor.value
	 * The individual components of the color can be accessed
	 * via myColor.r, myColor.g, myColor.b, and myColor.a for alpha/opacity
	 * @param {number|string} [r=0] - A string defining the entire color, or another
	 *   CMColor instance (or similar object with r, g, b values), or the number
	 *   representing r value if the r, g, b components are being entered separately,
	 * @param {number} [g=0] - The g component
	 * @param {number} [b=0] - The b component
	 * @param {number} [a=1] - The alpha/opacity component
	 */
	constructor(r=0, g=0, b=0, a=1) {
		if(typeof r === "string") {

			// hex
			let colorCode = r;
			if(colorCode.startsWith("#")) {
				colorCode = colorCode.replace("#", "");

				if(colorCode.length === 8) { // colorCode with alpha
					colorCode = colorCode.substring(0, 6);
					this.a = parseInt(colorCode.substring(0, 2), 16);
				}

				if(colorCode.length === 3) { // shorthand colorCode color
					colorCode = colorCode[0] + colorCode[0] + colorCode[1] + colorCode[1] + colorCode[2] + colorCode[2];
					this.a = 1;
				}

				this.r = parseInt(colorCode.substring(0, 2), 16);
				this.g = parseInt(colorCode.substring(2, 4), 16);
				this.b = parseInt(colorCode.substring(4, 6), 16);

				if(typeof this.a === "undefined") {
					this.a = 1;
				}
			}
			else // rgb or rgba
			if(colorCode.startsWith("rgb")) {
				let pieces = colorCode.replace("rgba(", "")
						.replace("rgb(", "")
						.replace(")", "")
						.split(",");

				this.r = parseInt(pieces[0]);
				this.g = parseInt(pieces[1]);
				this.b = parseInt(pieces[2]);

				if(pieces.length === 4)
					this.a = parseFloat(pieces[3]);
				else
					this.a = 1;
			}
		}
		else
		if(typeof r === "object") { // cloning another CMColor or similar object
			this.r = r.r;
			this.g = r.g;
			this.b = r.b;
			this.a = typeof r.a === "undefined" ? 1 : r.a;
		}
		else { // not a string; we can assume numbers
			this.r = r;
			this.g = g;
			this.b = b;
			this.a = a;
		}
	}

	/**
	 * Makes this color slightly closer to white, by increasing
	 * each of the r, g, and b components
	 * @param {number} [amount=10] How many units in 255 to increase
	 * @returns {object} The current CMColor instance
	 */
	brighten(amount=10) {
		this.r = CMGame.clamp(this.r + amount, 0, 255);
		this.g = CMGame.clamp(this.g + amount, 0, 255);
		this.b = CMGame.clamp(this.b + amount, 0, 255);
		return this;
	}

	/**
	 * Makes this color slightly closer to black, by decreasing
	 * each of the r, g, and b components
	 * @param {number} [amount=10] How many units in 255 to increase
	 * @returns {object} The current CMColor instance
	 */
	darken(amount=10) {
		this.r = CMGame.clamp(this.r - amount, 0, 255);
		this.g = CMGame.clamp(this.g - amount, 0, 255);
		this.b = CMGame.clamp(this.b - amount, 0, 255);
		return this;
	}

	/**
	 * Makes this color slightly closer to opaque, by increasing
	 * the alpha component
	 * @param {number} [amount=0.1] How many units in 1.0 to increase
	 * @returns {object} The current CMColor instance
	 */
	increaseOpacity(amount=0.1) {
		this.a = CMGame.clamp(this.a + amount, 0, 1);
		return this;
	}

	/**
	 * Makes this color slightly closer to transparent, by decreasing
	 * the alpha component
	 * @param {number} [amount=0.1] How many units in 1.0 to decrease
	 * @returns {object} The current CMColor instance
	 */
	decreaseOpacity(amount=0.1) {
		this.a = CMGame.clamp(this.a - amount, 0, 1);
		return this;
	}
}

/**
 * Gets the rgba() string for the stored color
 */
Object.defineProperty(CMColor.prototype, "value", {
	get() {
		return `rgba(${this.r}, ${this.g}, ${this.b}, ${this.a})`;
	}
});

/**
 * Our palette colors are predefined here as
 * a convenience. These match
 * corresponding classes in cmgame.css
 */

// colorscale / non-grayscale colors
CMColor.FUSCHIA = "rgb(253, 13, 136)";
CMColor.MAGENTA = "rgb(228, 0, 228)";
CMColor.PINK = "rgb(254, 3, 133)";
CMColor.RED = "rgb(250, 0, 92)";
CMColor.DARK_RED = "rgb(133, 33, 33)";

CMColor.ORANGE = "rgb(254, 137, 39)";
CMColor.YELLOW = "rgb(255, 245, 10)";
CMColor.GOLD = "rgb(255, 193, 4)";

CMColor.LIGHT_GREEN = "rgb(0, 240, 0)";
CMColor.GREEN = "rgb(0, 185, 0)";
CMColor.DARK_GREEN = "rgb(0, 136, 0)";

CMColor.SKY_BLUE = "rgb(142, 227, 252)";

CMColor.LIGHT_BLUE = "rgb(0, 250, 235)";
CMColor.BLUE = "rgb(1, 97, 251)";
CMColor.DARK_BLUE = "rgb(2, 8, 66)";

CMColor.BLUE_GREEN = "rgb(0, 168, 153)";

CMColor.VIOLET = "rgb(185, 51, 158)";
CMColor.PURPLE = "rgb(128, 0, 128)";

CMColor.BROWN = "rgb(121, 74, 25)";
CMColor.SAND = "rgb(242, 245, 235)";
CMColor.TAN = "rgb(242, 228, 205)";
CMColor.PEACH = "rgb(242, 222, 212)";

// grayscale colors
CMColor.WHITE = "rgb(255, 255, 255)";
CMColor.ALMOST_WHITE = "rgb(250, 250, 250)";
CMColor.BLACK = "rgb(5, 8, 11)";
CMColor.ALMOST_BLACK = "rgb(15, 23, 33)";
CMColor.GRAY = "rgb(158, 158, 158)";
CMColor.LIGHT_GRAY = "rgb(205, 205, 205)";
CMColor.DARK_GRAY = "rgb(58, 58, 58)";

// translucent colors, e.g., for modal overlays
CMColor.TRANSLUCENT_WHITE = "rgba(255, 255, 255, 0.85)";
CMColor.TRANSLUCENT_BLACK = "rgba(0, 0, 0, 0.85)";

// clear: dev should use this constant to be consistent (rather than, say, "transparent")
CMColor.NONE = "rgba(0, 0, 0, 0)";

/**
 * A few standard fonts, as a convenience
 * This must be nonstatic in order to
 * use the context's current font size.
 *
 * Example usage:
 *
 * ctx.font = game.font.SANS_SERIF; // Sets font to the default sans-serif font in current font size
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

		/**
		 * game.font.rel can be used to create a font at an
		 * apparent pixel size regardless of scaling and zooming.
		 *
		 * Example: ctx.font = game.font.rel(12) + "px Arial";
		 */
		return {
			rel: (pxForScale1) => pxForScale1 / self.screenScalar,
			MONO: `${currentFontSize} monospace`,
			SANS_SERIF: `${currentFontSize} OpenSans, Arial, sans-serif`,
			SERIF: `${currentFontSize} Times New Roman, serif`,
			VARIABLE: `italic calc(${currentFontSize} * 1.1) Times New Roman, serif`
		};
	}
});

Object.defineProperty(CMGame.prototype, "graphScalar", {
	get() {
		return this.graphScalar_Private;
	},

	set(newVal) {
		let oldVal = this.graphScalar_Private || 120;
		this.graphScalar_Private = newVal;

		// this.tickDistance = this.tickDistance * newVal / oldVal;
		// this.gridlineDistance = this.gridlineDistance * newVal / oldVal;

		this.unzoomedGraphScalar = newVal * this.zoomLevel;

		// this.unzoomedTickDistance = this.tickDistance * this.zoomLevel;
		// this.unzoomedGridlineDistance = this.gridlineDistance * this.zoomLevel;

		for(let func of this.functions) {
			func.updateBounds(oldVal);
			func.buildGraphPath(this.offscreenCtx);
			func.drawGraphPath(this.offscreenCtx);
		}
	}
});

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
	documentBody.appendChild(CMGame.toastElement);

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
	documentBody.appendChild(CMGame.offscreenToastElement);
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

	let boundingRect = CMGame.offscreenToastElement.getBoundingClientRect();
	let widthStr = window.getComputedStyle(CMGame.offscreenToastElement).getPropertyValue("width").replace("px", "");
	let computedWidth = parseFloat(widthStr) || 0; // if "auto", "", etc., defaults to 0
	let assumedWidth = Math.max(boundingRect.right - boundingRect.left, computedWidth);

	CMGame.toastElement.style.opacity = "0";
	CMGame.toastElement.style.display = "none";
	CMGame.toastElement.style.left = `calc(50vw - ${.5 * assumedWidth}px)`;

	CMGame.toastElement.style.animationDuration =
		CMGame.toastElement.style.webkitAnimationDuration = `${toastDuration}s`;

	setTimeout(function() {
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
class CMSprite {
	/**
	 * Creates a CMSprite instance. These come in
	 * a few general shapes - the standard "rect" bounding
	 * box, or "circle" which is useful for many math-based
	 * games (e.g., drawing a point, a graph theory vertex,
	 * or Venn diagram circle), and "line" which represents a
	 * line segment (like a graph theory edge) and is bounded
	 * by the smallest rectangle containing it (with sides
	 * parallel to the x and y axes)
	 *
	 * @param {CMGame} game - The associated CMGame instance
	 * @param {number} x - The starting left value, or center x if circular
	 * @param {number} y - The starting top value, or center y if circular
	 * @param {number} widthOrRadius - The starting width value, radius if circular, or lineWidth if a line
	 * @param {number|string} heightOrCircle - The starting height value, or "circle" if circular, or "line"
	 * @param {object|string|function} [drawRule=null] - An image or default color string or
	 *   draw function (taking game's drawing context as its sole parameter). Default is null.
	 *   When extending the Sprite class, you can set this to null in the constructor's super() call
	 *   to use the extended classes draw() method.
	 * @param {string|function} [boundingRule="none"] - How to handle collision with screen edge.
	 *   This can be a function, which takes a single argument, the "rectangle" object used to bound
	 *   the sprite, which is the `this` object (the rectangle has x, y, width, and height number values),
	 *   or it can be one of the following strings, which define common types of bounding behavior:
	 *   "wrap": object appears on other side of screen once completely off screen
	 *   "bounce": object bounces away from wall with same momentum
	 *   "fence": object is pushed back so that it just rests on the wall
	 *   "destroy": object is removed from game (pulled from the game sprites, but you can add it again later)
	 *   "none": object just keeps moving offscreen in current direction. This is the default value.
	 * @param {object} [options={}] - A plain JS object of additional options,
	 *   mainly for defining helper functions on creation.
	 * @param {function} [options.onbeforeupdate] A function to be executed just before this sprite's update()
	 * @param {function} [options.onupdate] A function to be executed after this sprite's update()
	 * @param {function} [options.onbeforedraw]  A function to be executed just beore this sprite's draw(),
	 *   (e.g., to draw a shadow before drawing the sprite)
	 * @param {function} [options.ondraw] A function to be executed after this sprite's draw()
	 * @param {function} [options.onfadein] A function to be executed at the end of a "fade in" animation
	 * @param {function} [options.onfadeout] A function to be executed at the end of a "fade out" animation
	 * @param {function} [options.ondestroy] A callback to invoke when this sprite is removed from the game
	 * @param {number} [options.z] A third coordinate "z" value if dev wants to manage
	 *   some form of "depth". Defaults to 0.
	 * @param {number} [options.layer=0] - A number than can be used to define the
	 *   order to draw sprites in a frame. Sprites with the same layer number
	 *   will be drawn in the order they were created. By default, all sprites have
	 *   layer 0, so are drawn in the order they were created. Negative numbers
	 *   are permitted as well, e.g., for background sprites.
	 * @param {object} [options.boundingRect] - A rectangular object (i.e., an object with  numerical x, y,
	 *   width and height properties) that will be used instead of the entire canvas, when invoking
	 *   the bounding rules for this sprite. Defaults to this.game (i.e., the game's canvas dimensions)
	 */
	constructor(game, x, y, widthOrRadius, heightOrCircle, drawRule=null,
			boundingRule="none", options={}) {

		this.game = game;
		this.x = x;
		this.y = y;
		this.z = options.z || 0;

		// Do not override these - they are used with Object.defineProperty. Override boundingRule instead.
		this.boundingRule_Private = boundingRule;
		this.layer_Private = options.layer || 0;

		this.layer = this.layer_Private;
		this.boundingRuleTop = "none";
		this.boundingRuleRight = "none";
		this.boundingRuleBottom = "none";
		this.boundingRuleLeft = "none";
		this.boundingRule = boundingRule;
		this.boundingRect = null;

		if(options.boundingRect) {
			if(typeof options.boundingRect.x === "number" &&
					typeof options.boundingRect.y === "number" &&
					typeof options.boundingRect.width === "number" && 
					typeof options.boundingRect.height === "number") {
				this.boundingRect = options.boundingRect;
			}
			else {
				console.warn(`CMSprite option
					'boundingRect' requires numerical
					 x, y, width, and height properties`);
			}
		}
		else { // boundingRect defaults to entire game
			this.boundingRect = {
				x: 0,
				y: 0,
				width: game.width,
				height: game.height
			};
		}

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

		this.pathFunction = null;
		this.pathFunctionOffset = null;
		this.pathFunctionFollow = "end";
		this.image = null;
		this.fillStyle = CMColor.BLACK;
		this.strokeStyle = CMColor.NONE;

		if(typeof drawRule === "string" ||
			drawRule instanceof CanvasGradient ||
			drawRule instanceof CanvasPattern) {
			this.fillStyle = drawRule;
			this.strokeStyle = drawRule;
		}
		else
		if(drawRule instanceof CMImage ||
				drawRule instanceof HTMLImageElement) {
			this.image = drawRule;
		}
		else
		if(typeof drawRule === "function") {
			this.draw = function(ctx) {

				// We will often want to show the graph "trail"
				if(this.pathFunction instanceof CMFunction) {
					this.pathFunction.draw(ctx);
				}

				drawRule.call(this, ctx);
			};
		}

		this.velocity = new CMPoint();
		this.acceleration = new CMPoint();

		// This additional property will control fading animations
		this.opacity = 1.0;
		this.velocity.opacity = 0.0;

		if(typeof options.onbeforeupdate === "function")
			this.onbeforeupdate = options.onbeforeupdate;
		else
			this.onbeforeupdate = CMGame.noop;

		if(typeof options.onupdate === "function")
			this.onupdate = options.onupdate;
		else
			this.onupdate = CMGame.noop;

		if(typeof options.onbeforedraw === "function")
			this.onbeforedraw = options.onbeforedraw;
		else
			this.onbeforedraw = CMGame.noop;

		if(typeof options.ondraw === "function")
			this.ondraw = options.ondraw;
		else
			this.ondraw = CMGame.noop;

		if(typeof options.onfadein === "function")
			this.onfadein = options.onfadein;

		if(typeof options.onfadeout === "function")
			this.onfadeout = options.onfadeout;

		this.ondestroy = null;
		if(typeof options.ondestroy === "function")
			this.ondestroy = options.ondestroy;

		this.onscreen = false;
		this.hasEnteredScreen = false; // bounding rules will not apply until sprite has entered screen
		if(this.x > this.game.width ||
				this.y > this.game.height ||
				this.x + this.width < 0 ||
				this.y + this.height < 0) {
			this.onscreen = false;
		}
		else {
			this.onscreen = true;
			this.hasEnteredScreen = true;
		}

		this.hitbox = null;
		this.hurtbox = null;

		let self = this;

		/**
		 * Since a sprite's hitbox will be constantly changing,
		 * we will only update it when necessary, e.g., when
		 * performing collision checks.
		 */
		(function() {

			let hb = self; // Initialize
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
							return self;
					}
				}
			});
		} ());

		/**
		 * Since a sprite's hurtbox will be constantly changing,
		 * we will only update it when necessary, e.g., when
		 * performing collision checks.
		 */
		(function() {

			let hb = self; // Initialize
			Object.defineProperty(self, "hurtbox", {

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
							return self;
					}
				}
			});
		}());		
	}

	/**
	 * Removes this sprite from current game, and
	 * calls its ondestroy method. Essentially
	 * an alias for game.removeSprite( sprite ),
	 * except that this returns the current sprite
	 * rather than the current game.
	 * Note: this sprite's ondestroy method is
	 * invoked when this method is called.
	 * @returns {object} This sprite
	 */
	destroy() {
		this.game.removeSprite(this);
		return this;
	}

	/**
	 * Sets the sprite's current movement path.
	 * @param {function|array|object|null} newPath - If a CMFunction, this will be invoked
	 *   on each update to determine sprite's movement. If an object, this sprite's
	 *   velocity will be set to that object's x, y, z values (setting any undefined to 0).
	 *   If an array, sprite's velocity x, y, z values will be set to the array's first,
	 *   second, and third index, respectively.
	 *   If a falsy value, like null, sprite path will be destroyed and sprite movement
	 *   will revert to latest set velocity values.
	 * @param {object|string} [options] - A plain JS object of options to apply, mainly
	 *   for CMFunction paths, or a string simply declaring the `options.follow` value.
	 * @param {object} [options.follow="end"] - What detail of the CMFunction to follow ("end", "start")
	 * @param {object} [options.offset=null] - A point-like object giving details of how much the sprite's
	 *   x and y are offset from the path point. By default, this assumes the point is in the center
	 *   of the sprite and calculates that value.
	 */
	setPath(newPath, options) {
		if(!newPath && newPath !== 0) { // cancel current path, e.g. by passing in null
			this.pathFunction = null;
		}
		else
		if(newPath instanceof CMFunction) {
			let opts = {
				follow: "end",
				offset: null
			};

			if(typeof options === "string") {
				opts.follow = options;
			}
			else
			if(options) {
				opts.follow = options.follow || "end";

				if(options.offset) {
					opts.offset = {
						x: options.offset.x || 0,
						y: options.offset.y || 0
					};
				}
			}

			this.pathFunction = newPath;
			this.pathFunctionOffset = opts.offset;
			this.pathFunctionFollow = opts.follow;
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
		else
		if(typeof newPath === "object") { // object, just setting velocities, OR setting from a polar point
			if(typeof newPath.r === "number" || typeof newPath.theta === "number") {
				let cart = game.fromPolar(
				{
					r: newPath.r || 1,
					theta: newPath.theta || this.game.slopeToRadians(this.velocity.y / this.velocity.x, Math.sign(this.velocity.x))
				});

				this.velocity.x = cart.x;
				this.velocity.y = cart.y;
			}
			else {
				this.velocity.x = newPath.x || 0;
				this.velocity.y = newPath.y || 0;
			}
	
			this.velocity.z = newPath.z || 0;
			this.pathFunction = null;
		}
		else { // Final assumption is all entries are numbers, with no options, or are undefined
			this.velocity.x = arguments[0] || 0;
			this.velocity.y = arguments[1] || 0;
			this.velocity.z = arguments[2] || 0;
			this.pathFunction = null;
		}
	}

	/**
	 * Updates the sprite for one animation cycle,
	 * moving it and bounding if necessary
	 * @param {number} frameCount - The game's integer counter for frames
	 */
	update(frameCount) {
		if(this.pathFunction instanceof CMFunction) {

			// Avoid calling update() twice on this function
			if(!this.game.functions.includes(this.pathFunction))
				this.pathFunction.update(frameCount);

			switch(this.pathFunction.type) {
				case "xofy":
					this.y = this.game.yToScreen(this.pathFunction[this.pathFunctionFollow].y, this.pathFunction.origin);
					this.x = this.game.xToScreen(this.pathFunction.of(this.pathFunction[this.pathFunctionFollow].y), this.pathFunction.origin);
					break;
				case "polar":
					let cartPoint = this.game.fromPolar(
						this.pathFunction.of(this.pathFunction[this.pathFunctionFollow].theta), // r
						this.pathFunction[this.pathFunctionFollow].theta
					);
					this.x = this.game.xToScreen(cartPoint.x, this.pathFunction.origin);
					this.y = this.game.yToScreen(cartPoint.y, this.pathFunction.origin);
					break;
				case "parametric":
					let funcPoint = this.pathFunction.of( this.pathFunction[this.pathFunctionFollow].t );

					this.x = this.game.xToScreen( funcPoint.x, this.pathFunction.origin );
					this.y = this.game.yToScreen( funcPoint.y, this.pathFunction.origin );
					break;
				case "cartesian":
					default:
					this.x = this.game.xToScreen(this.pathFunction[this.pathFunctionFollow].x, this.pathFunction.origin);
					this.y = this.game.yToScreen(this.pathFunction.of(this.pathFunction[this.pathFunctionFollow].x), this.pathFunction.origin);
					break;
			}

			if(this.pathFunctionOffset) {
				this.x += this.pathFunctionOffset.x;
				this.y += this.pathFunctionOffset.y;
			}
			else // Sprite's "center" point is what usually follows the path
			if(this.shape !== "circle") {
				this.x -= .5 * this.width;
				this.y -= .5 * this.height;
			}
		}
		else {
			this.velocity.x += this.acceleration.x;
			this.velocity.y += this.acceleration.y;
		}

		/**
		 * Since this engine only truly supports 2D games,
		 * z can be handled separately from path
		 */
		if(this.acceleration.z) {
			this.velocity.z += this.acceleration.z;
		}

		this.x += this.velocity.x;
		this.y += this.velocity.y;

		if(this.velocity.z) {
			this.z += this.velocity.z;
		}

		if(this.velocity.opacity) {
			this.opacity += this.velocity.opacity;
			if(this.velocity.opacity > 0 && this.opacity >= 1.0) {
				this.opacity = 1.0;
				this.velocity.opacity = 0;
				this.onfadein(frameCount);
			}

			if(this.velocity.opacity < 0 && this.opacity <= 0.0) {
				this.opacity = 0.0;
				this.velocity.opacity = 0;
				this.onfadeout(frameCount);
			}
		}

		// If you create an arbitrary `shape` you can manage bounding in onupdate
		switch(this.shape) {
			case "line":
				this.boundAsLine();
				break;
			case "circle":
				this.boundAsCircle();
				break;
			case "rect":
				this.boundAsRect(this, this.boundingRect);
				break;
		}
	}

	/**
	 * Animates sprite to fade in for current scene. Returns a promise,
	 * resolving after the animation, which can be used for further
	 * actions
	 * Note: setting onfadein before calling this method will
	 * allow similar control, with more accuracy because it is based
	 * on the actual fader, rather than the expected time.
	 * For instance, if you change the fps while fading, onfadein
	 * will be called after the animation, but the Promise may resolve
	 * before or after that frame.
	 *
	 * Example usage:
	 * sprite.fadeIn().then(() => { sprite.moveToward(game.center) });
	 *
	 * @param {number} [duration=500] Number of milliseconds (or frames
	 *   if asFrames is true) of game cycles that fade animation should last
	 * @param {boolean} [asFrames=false] If true, will treat duration as "# of frames"
	 * @returns {Promise} A promise resolving after the given duration
	 */
	fadeIn(duration=500, asFrames=false) {
		let self = this;
		let totalFrames = asFrames ? duration : this.game.fps * (duration / 1000);

		this.velocity.opacity = 1 / totalFrames;
		return new Promise(function(resolve, reject) {
			self.game.setFrameout(resolve, totalFrames);
		});
	}

	/**
	 * Animates sprite to fade out from current scene.
	 * Note: the same concerns mentioned in fadeIn()
	 * about the returned Promise apply here.
	 *
	 * Example usage:
	 * sprite.fadeOut().then(() => sprite.destroy());
	 * 
	 * @param {number} [duration=500] Number of milliseconds (or frames
	 *   if asFrames is true) of game cycles that fade animation should last
	 * @param {boolean} [asFrames=false] If true, will treat duration as "# of frames"
	 * @returns {Promise} A promise resolving after the given duration
	 */
	fadeOut(duration=500, asFrames=false) {
		let self = this;
		let totalFrames = asFrames ? duration : this.game.fps * (duration / 1000);

		this.velocity.opacity = -1 / totalFrames;
		return new Promise(function(resolve, reject) {
			self.game.setFrameout(resolve, totalFrames);
		});
	}

	/**
	 * Sets the sprite's current course toward
	 * a specific onscreen point (note: these points
	 * are based on pixels, not real graph values).
	 * @param {object|string} newPoint - The point to move towards, as an object (must have x
	 *   and y number values), or the angle to move written as a string ending with "rad" or "deg"
	 *   (for radians or degrees, respectively)
	 * @param {number} [desiredSpeed=1] The velocity to move in the new direction.
	 *   Note: this is not necessarily velocity of x or y coordinates, but really a polar radius.
	 * @param {number} [startReferencePoint=this.center] - The starting point used to calculate this directional slope
	 */
	moveToward(newPoint, desiredSpeed=1, startReferencePoint=this.center) {
		let xVelocity = desiredSpeed,
			yVelocity = desiredSpeed;

		// on same vertical line
		if(typeof newPoint === "object" && newPoint.x === startReferencePoint.x) {
			if(newPoint.y === startReferencePoint.y) { // same point! (ignoring any z value)
				return this.setPath(0, 0);
			}
			else { // vertical slope, moving straight up or down
				yVelocity = desiredSpeed * Math.sign(newPoint.y - startReferencePoint.y);
				return this.setPath(0, yVelocity);
			}
		}

		let game = this.game;
		let theta = null;
		if(typeof newPoint === "string") {
			if(newPoint.endsWith("rad")) {
				theta = parseFloat(newPoint.replace(/(Math\.)?pi/ig, "" + Math.PI)
					.replace(/(Math\.)?tau/ig, "" + Math.TAU));
			}
			else
			if(newPoint.endsWith("deg")) {
				theta = game.toRadians( parseFloat(newPoint) );
			}
			else {
				theta = 0;
				console.error(`CMSprite moveToward() requires 'rad' or 'deg' at the end of first string argument`);
			}
		}
		else { // "object"
			// will be finite since vertical lines were handled previously
			let slope;
			if(startReferencePoint.x < newPoint.x)
				slope = game.getSlope(startReferencePoint, newPoint);
			else
				slope = game.getSlope(startReferencePoint, newPoint);

			// Handle moving vertically
			if(newPoint.x - startReferencePoint.x === 0) {
				if(newPoint.y > startReferencePoint.y) {
					theta = 1.5 * Math.PI;
				}
				else { // newPoint.y <= startReferencePoint.y since equality was handled above
					theta = .5 * Math.PI;
				}
			}
			else {
				theta = game.slopeToRadians(slope, Math.sign(newPoint.x - startReferencePoint.x));
			}
		}

		// Get the (normalized) horizontal and vertical Cartesian distances
		let point = game.fromPolar({
				r: 1,
				theta: theta
			});

		this.setPath(point.x * xVelocity, point.y * yVelocity);
	}

	/**
	 * Manages screen boundaries for "line" shape,
	 * in a simple form, by considering the rectangle
	 * enclosing the line, and bounding it as a rect.
	 * @param {object} [boundingRect=this.boundingRect] - The enclosing rectangle that is bounding
	 *   this figure. Generally the entire game, but some enemies, etc., may be restricted in space.
	 */
	boundAsLine(boundingRect=this.boundingRect) {

		let rectToBound = {
			x: Math.min(this.start.x, this.end.x),
			y: Math.min(this.start.y, this.end.y),
			width: Math.abs(this.end.x - this.start.x),
			height: Math.abs(this.end.y - this.start.y)
		};

		return this.boundAsRect(rectToBound, boundingRect);
	}

	/**
	 * Manages screen boundaries for "circle" shape
	 * @param {object} [boundingRect=this.boundingRect] - The enclosing rectangle that is bounding
	 *   this figure. Generally the entire game, but some enemies, etc., may be restricted in space.
	 */
	boundAsCircle(boundingRect=this.boundingRect) {
		if(this.hasEnteredScreen) {
			if(this.x - this.radius < this.boundingRect.x) { // left wall
				switch(this.boundingRuleLeft) {
					case "wrap":
						if(this.x + this.radius < boundingRect.x) {
							this.x = boundingRect.width + this.radius;

							// For path functions, sprites internal path value may be way off screen
							while(this.x + this.radius < boundingRect.x) {
								this.x += boundingRect.width;
							}
						}
						break;
					case "bounce":
						this.x = boundingRect.x + this.radius;
						this.velocity.x = Math.abs(this.velocity.x);
						break;
					case "fence":
						this.x = boundingRect.x + this.radius;
						break;
					case "destroy":
						if(this.x + this.radius < boundingRect.x)
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

			if(this.x + this.radius > boundingRect.x + boundingRect.width) { // right wall		
				switch(this.boundingRuleRight) {
					case "wrap":
						if(this.x - this.radius > boundingRect.x + boundingRect.width) {
							this.x = -this.radius + (this.x - this.radius - boundingRect.width);

							// For path functions, sprites internal path value may be way off screen
							while(this.x - this.radius > boundingRect.x + boundingRect.width) {
								this.x -= boundingRect.width;
							}
						}
						break;
					case "bounce":
						this.x = boundingRect.x + boundingRect.width - this.radius;
						this.velocity.x = -Math.abs(this.velocity.x);
						break;
					case "fence":
						this.x = boundingRect.x + boundingRect.width - this.radius;
						break;
					case "destroy":
						if(this.x - this.radius > boundingRect.x + boundingRect.width)
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

			if(this.y - this.radius < boundingRect.y) { // top wall
				switch(this.boundingRuleTop) {
					case "wrap":
						if(this.y + this.radius < boundingRect.y) {
							this.y = boundingRect.y + boundingRect.height + this.radius;

							// For path functions, sprites internal path value may be way off screen
							while(this.y + this.radius < boundingRect.y) {
								this.y += boundingRect.height;
							}
						}
						break;
					case "bounce":
						this.y = boundingRect.y + this.radius;
						this.velocity.y = Math.abs(this.velocity.y);
						break;
					case "fence":
						this.y = boundingRect.y + this.radius;
						break;
					case "destroy":
						if(this.y + this.radius < boundingRect.y)
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

			if(this.y + this.radius > boundingRect.y + boundingRect.height) { // bottom wall
				switch(this.boundingRuleBottom) {
					case "wrap":
						if(this.y - this.radius > boundingRect.y + boundingRect.height) {
							this.y = -this.radius + (this.y - this.radius - boundingRect.height);

							// For path functions, sprites internal path value may be way off screen
							while(this.y - this.radius > boundingRect.y + boundingRect.height) {
								this.y -= boundingRect.height;
							}
						}
						break;
					case "bounce":
						this.y = boundingRect.y + boundingRect.height - this.radius;
						this.velocity.y = -Math.abs(this.velocity.y);
						break;
					case "fence":
						this.y = boundingRect.y + boundingRect.height - this.radius;
						break;
					case "destroy":
						if(this.y - this.radius > boundingRect.y + boundingRect.height)
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
		}

		if(this.x - this.radius > this.game.width ||
				this.y - this.radius > this.game.height ||
				this.x + this.radius < 0 ||
				this.y + this.radius < 0) {
			this.onscreen = false;
		}
		else {
			this.hasEnteredScreen = true;
			this.onscreen = true;
		}
	}

	/**
	 * Manages screen boundaries for "rect" shape sprite.
	 * @param {object} [rectToBound=this] - A custom "rectangle" used as a "hit box"
	 * @param {object} [boundingRect=this.boundingRect] - The enclosing rectangle that is bounding
	 *   this figure. Generally the entire game, but some enemies, etc., may be restricted in space.
	 */
	boundAsRect(rectToBound=this, boundingRect=this.boundingRect) {
		if(this.hasEnteredScreen) {

			if(rectToBound.x < boundingRect.x) { // left wall
				switch(this.boundingRuleLeft) {
					case "wrap":
						if(rectToBound.x + rectToBound.width < boundingRect.x) {
							this.x = boundingRect.width + (rectToBound.x + rectToBound.width);

							// For path functions, sprites internal path value may be way off screen
							while(this.x + this.width < boundingRect.x) {
								this.x += boundingRect.width;
							}
						}
						break;
					case "bounce":
						this.x = boundingRect.x;
						this.velocity.x = Math.abs(this.velocity.x);
						break;
					case "fence":
						this.x = boundingRect.x;
						break;
					case "destroy":
						if(rectToBound.x + rectToBound.width < boundingRect.x)
							this.destroy();
						break;
					case "none":
						break;
					default:
						if(typeof this.boundingRuleLeft === "function") {
							this.boundingRuleLeft.call(this, rectToBound);
						}
						break;
				}
			}

			if(rectToBound.x + rectToBound.width > boundingRect.x + boundingRect.width) { // right wall
				switch(this.boundingRuleRight) {
					case "wrap":
						if(rectToBound.x > boundingRect.x + boundingRect.width) {
							this.x = rectToBound.x - boundingRect.width;

							// For path functions, sprites internal path value may be way off screen
							while(this.x > boundingRect.x + boundingRect.width) {
								this.x -= boundingRect.width;
							}
						}
						break;
					case "bounce":
						this.x = boundingRect.x + boundingRect.width - rectToBound.width;
						this.velocity.x = -Math.abs(this.velocity.x);
						break;
					case "fence":
						this.x = boundingRect.x + boundingRect.width - rectToBound.width;
						break;
					case "destroy":
						if(rectToBound.x > boundingRect.x + boundingRect.width)
							this.destroy();
						break;
					case "none":
						break;
					default:
						if(typeof this.boundingRuleRight === "function") {
							this.boundingRuleRight.call(this, rectToBound);
						}
						break;
				}
			}

			if(rectToBound.y < boundingRect.y) { // top wall
				switch(this.boundingRuleTop) {
					case "wrap":
						if(rectToBound.y + rectToBound.height < boundingRect.y) {
							this.y = boundingRect.height + (rectToBound.y + rectToBound.height); // boundingRect.height;

							// For path functions, sprites internal path value may be way off screen
							while(this.y + this.height < boundingRect.y) {
								this.y += boundingRect.height;
							}
						}
						break;
					case "bounce":
						this.y = boundingRect.y;
						this.velocity.y = Math.abs(this.velocity.y);
						break;
					case "fence":
						this.y = boundingRect.y;
						break;
					case "destroy":
						if(rectToBound.y + rectToBound.height < boundingRect.y)
							this.destroy();
						break;
					case "none":
						break;
					default:
						if(typeof this.boundingRuleTop === "function") {
							this.boundingRuleTop.call(this, rectToBound);
						}
						break;
				}
			}

			if(rectToBound.y + rectToBound.height > boundingRect.y + boundingRect.height) { // bottom wall
				switch(this.boundingRuleBottom) {
					case "wrap":
						if(rectToBound.y > boundingRect.y + boundingRect.height) {
							this.y = rectToBound.y - boundingRect.height;

							// For path functions, sprites internal path value may be way off screen
							while(this.y > boundingRect.y + boundingRect.height) {
								this.y -= boundingRect.height;
							}
						}
						break;
					case "bounce":
						this.y = boundingRect.y + boundingRect.height - rectToBound.height;
						this.velocity.y = -Math.abs(this.velocity.y);
						break;
					case "fence":
						this.y = boundingRect.y + boundingRect.height - rectToBound.height;
						break;
					case "destroy":
						if(rectToBound.y > boundingRect.y + boundingRect.height)
							this.destroy();
						break;
					case "none":
						break;
					default:
						if(typeof this.boundingRuleBottom === "function") {
							this.boundingRuleBottom.call(this, rectToBound);
						}
						break;
				}
			}
		}

		if(this.x > this.game.width ||
				this.y > this.game.height ||
				this.x + this.width < 0 ||
				this.y + this.height < 0) {
			this.onscreen = false;
		}
		else {
			this.hasEnteredScreen = true;
			this.onscreen = true;
		}
	}

	/**
	 * Manages screen boundaries for "polygon" shape sprite.
	 * @param {object} [rectToBound=this] - A custom "rectangle" used as a "hit box"
	 * @param {object} [boundingRect=this.boundingRect]
	 */
	boundAsPolygon(rectToBound=this, boundingRect=this.boundingRect) {

		if(this.hasEnteredScreen) {
			if(rectToBound.x <= 0) { // left wall
				switch(this.boundingRuleLeft) {
					case "wrap":
						if(rectToBound.x + rectToBound.width <= 0) {
							this.x += this.game.width;

							for(let i = 0, len = this.points.length; i < len; i++) {
								this.points[i].x += this.game.width;
							}

							// For path functions, sprites internal path value may be way off screen
							while(this.x + this.width < 0) {
								this.x += this.game.width;

								for(let i = 0, len = this.points.length; i < len; i++) {
									this.points[i].x += this.game.width;
								}
							}
						}
						break;
					case "bounce":
						this.x = 0;
						this.velocity.x = Math.abs(this.velocity.x);
						break;
					case "fence":
						this.x = 0;
						break;
					case "destroy":
						if(rectToBound.x + rectToBound.width < 0)
							this.destroy();
						break;
					case "none":
						break;
					default:
						if(typeof this.boundingRuleLeft === "function") {
							this.boundingRuleLeft.call(this, rectToBound);
						}
						break;
				}
			}
			else
			if(rectToBound.x + rectToBound.width >= this.game.width) { // right wall
				switch(this.boundingRuleRight) {
					case "wrap":
						if(rectToBound.x >= this.game.width) {
							this.x -= this.game.width;
							
							for(let i = 0, len = this.points.length; i < len; i++) {
								this.points[i].x -= this.game.width;
							}

							// For path functions, sprites internal path value may be way off screen
							while(this.x > this.game.width) {
								this.x -= this.game.width;

								for(let i = 0, len = this.points.length; i < len; i++) {
									this.points[i].x -= this.game.width;
								}
							}
						}
						break;
					case "bounce":
						this.x = this.game.width - rectToBound.width;
						this.velocity.x = -Math.abs(this.velocity.x);
						break;
					case "fence":
						this.x = this.game.width - rectToBound.width;
						break;
					case "destroy":
						if(rectToBound.x > this.game.width)
							this.destroy();
						break;
					case "none":
						break;
					default:
						if(typeof this.boundingRuleRight === "function") {
							this.boundingRuleRight.call(this, rectToBound);
						}
						break;
				}
			}
			else
			if(rectToBound.y <= 0) { // top wall
				switch(this.boundingRuleTop) {
					case "wrap":
						if(rectToBound.y + rectToBound.height <= 0) {
							this.y += this.game.height;

							for(let i = 0, len = this.points.length; i < len; i++) {
								this.points[i].y += this.game.height;
							}

							// For path functions, sprites internal path value may be way off screen
							while(this.y + this.height < 0) {
								this.y += this.game.height;

								for(let i = 0, len = this.points.length; i < len; i++) {
									this.points[i].y += this.game.height;
								}
							}
						}
						break;
					case "bounce":
						this.y = 0;
						this.velocity.y = Math.abs(this.velocity.y);
						break;
					case "fence":
						this.y = 0;
						break;
					case "destroy":
						if(rectToBound.y + rectToBound.height < 0)
							this.destroy();
						break;
					case "none":
						break;
					default:
						if(typeof this.boundingRuleTop === "function") {
							this.boundingRuleTop.call(this, rectToBound);
						}
						break;
				}
			}
			else
			if(rectToBound.y + rectToBound.height >= this.game.height) { // bottom wall
				switch(this.boundingRuleBottom) {
					case "wrap":
						if(rectToBound.y >= this.game.height) {
							this.y -= this.game.height;
							for(let i = 0, len = this.points.length; i < len; i++) {
								this.points[i].y -= this.game.height;
							}

							// For path functions, sprites internal path value may be way off screen
							while(this.y > this.game.height) {
								this.y -= this.game.height;

								for(let i = 0, len = this.points.length; i < len; i++) {
									this.points[i].y -= this.game.height;
								}
							}
						}
						break;
					case "bounce":
						this.y = this.game.height - rectToBound.height;
						this.velocity.y = -Math.abs(this.velocity.y);
						break;
					case "fence":
						this.y = this.game.height - rectToBound.height;
						break;
					case "destroy":
						if(rectToBound.y > this.game.height)
							this.destroy();
						break;
					case "none":
						break;
					default:
						if(typeof this.boundingRuleBottom === "function") {
							this.boundingRuleBottom.call(this, rectToBound);
						}
						break;
				}
			}
		}

		if(this.x > this.game.width ||
				this.y > this.game.height ||
				this.x + this.width < 0 ||
				this.y + this.height < 0) {
			this.onscreen = false;
		}
		else {
			this.hasEnteredScreen = true;
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
		if(this.pathFunction instanceof CMFunction &&
			!this.game.functions.includes(this.pathFunction)) {
				this.pathFunction.draw(ctx);
		}

		if(this.image) {
			if(this.shape === "circle")
				ctx.drawImage(this.image, this.x - this.radius, this.y - this.radius, this.width, this.height);
			else
				ctx.drawImage(this.image, this.x, this.y, this.width, this.height);
		}
		else
		switch(this.shape) {
			case "circle": {
				ctx.fillStyle = this.fillStyle;
				ctx.strokeStyle = this.strokeStyle;
				ctx.beginPath();
				ctx.arc(this.x, this.y, this.radius, 0, Math.TAU, false);
				ctx.fill();
				ctx.stroke();
				break;
			}
			case "line": {
				ctx.lineWidth = this.width;
				ctx.strokeStyle = this.strokeStyle;
				this.game.drawLine(this.start, this.end);
				break;
			}
			default: { // "rect"
				ctx.fillStyle = this.fillStyle;
				ctx.strokeStyle = this.strokeStyle;
				ctx.fillRect(this.x, this.y, this.width, this.height);
				ctx.strokeRect(this.x, this.y, this.width, this.height);
				break;
			}
		}
	}

	/**
	 * Determines if a given point is on this
	 * sprite object. Useful for player interaction
	 * via mouse clicks or touch points.
	 * @param {object|number} pointOrX - The point, or point's x value
	 * @param {number} [y] - The point's y value
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

		switch(this.shape) {
			case "circle":
				return this.game.distance(this, pointToCheck) <= this.radius;
			case "line": // e.g., for CMEdge
				this.game.ctx.lineWidth = this.width;
				return this.game.ctx.isPointInStroke(this.path, pointToCheck.x, pointToCheck.y);
			case "rect": // "rect"
				return this.game.areColliding(this,
					{x: pointToCheck.x, y: pointToCheck.y, width: 1, height: 1});
			default: { // "path2d", etc. Anything defined with a path, that isn't just a line
				this.game.ctx.lineWidth = this.width;
				return (this.game.ctx.isPointInPath(this.path, pointToCheck.x, pointToCheck.y) ||
						this.game.ctx.isPointInStroke(this.path, pointToCheck.x, pointToCheck.y));
			}
		}
	}

	// These can be overridden by dev
	onupdate(frameCount) {}
	onbeforedraw(ctx) {}
	ondraw(ctx) {}
	onfadein(frameCount) {}
	onfadeout(frameCount) {}
}

Object.defineProperties(CMSprite.prototype, {

	/**
	 * Define the sprite's center as an accessor
	 * so it does not need to update until needed.
	 * Especially useful if sprite's size is animated.
	 */
	center: {

		/**
		 * Gets sprite's center point.
		 * Obvious when sprite is "circle", so
		 * primarily used for "rect"
		 * @returns {Point}
		 */
		get() {
			switch(this.shape) {
				case "rect":
					return new CMPoint(
						this.x + .5 * this.width,
						this.y + .5 * this.height
					);
				case "line":
					return CMGame.midpoint(this.start, this.end);
				case "circle":
					return new CMPoint(
						this.x,
						this.y
					);
				default: {
					return new CMPoint(
						this.left + .5 * this.width,
						this.top + .5 * this.height
					);
				}
			}
		},

		set(newPoint) {
			switch(this.shape) {
				case "rect":
					this.x = newPoint.x - .5 * this.width;
					this.y = newPoint.y - .5 * this.height;
					break;
				case "line":
					let slope = this.game.getSlope(this.start, this.end);

					if(Number.isFinite(slope)) {
						let halfLength = (this.end.x - this.start.x) / 2;

						this.end.x = newPoint.x + halfLength;
						this.end.y = newPoint.y + slope * halfLength;

						this.start.x = newPoint.x - halfLength;
						this.start.y = newPoint.y - slope * halfLength;
					}
					else { // vertical slope, start.x and end.x are equal

						let halfLength = (this.end.y - this.start.y) / 2;

						this.end.x = newPoint.y + slope * halfLength;
						this.end.y = newPoint.y + halfLength;

						this.start.x = newPoint.x - slope * halfLength;
						this.start.y = newPoint.y - halfLength;						
					}
					break;
				case "circle":
					this.x = newPoint.x;
					this.y = newPoint.y;
					break;
				default: {
					this.left = newPoint.x - .5 * this.width;
					this.top = newPoint.y - .5 * this.height;
					break;
				}
			}
		}
	},

	/**
	 * We define values like "bottom" to assist with
	 * collision detection, especially for platformers
	 * landing on surfaces
	 */
	bottom: {

		/**
		 * Setting sprite's bottom value essentially just redefines y
		 * @param {number} newVal - The new "bottom" y value
		 */
		set(newVal) {
			if(this.shape === "circle")
				this.y = newVal - this.radius;
			else
				this.y = newVal - this.height;
		},

		/**
		 * Gets sprite's bottom edge's y pixel value.
		 * @returns {number}
		 */
		get() {
			if(this.shape === "circle")
				return this.y + this.radius;
			else
				return this.y + this.height;
		}
	},
	
	right: {

		/**
		 * Setting sprite's right value essentially just redefines x
		 * @param {number} newVal - The new "right" x value
		 */
		set(newVal) {
			if(this.shape === "circle")
				this.x = newVal - this.radius;
			else
				this.x = newVal - this.width;
		},

		/**
		 * Gets sprite's right edge's x pixel value.
		 * @returns {number}
		 */
		get() {
			if(this.shape === "circle")
				return this.x + this.radius;
			else
				return this.x + this.width;
		}
	},

	left: {

		/**
		 * Setting sprite's left value redefines x
		 * @param {number} newVal - The new "left" x value
		 */
		set(newVal) {
			if(this.shape === "circle")
				this.x = newVal + this.radius;
			else
				this.x = newVal;
		},

		/**
		 * Gets sprite's "left" (i.e., "x") value
		 * @returns {number}
		 */
		get() {
			if(this.shape === "circle")
				return this.x - this.radius;
			else
				return this.x;
		}
	},

	top: {

		/**
		 * Setting sprite's top value redefines y
		 * @param {number} newVal - The new "top" y value
		 */
		set(newVal) {
			if(this.shape === "circle")
				this.y = newVal - this.radius;
			else
				this.y = newVal;
		},

		/**
		 * Gets sprite's "top" (i.e., "y") value
		 * @returns {number}
		 */
		get() {
			if(this.shape === "circle")
				return this.y - this.radius;
			else
				return this.y;
		}
	}
});

/**
 * Because the bounding rules on the 4 sides of
 * the screen can be decided by a single value,
 * we must set them each any time that one
 * value is set.
 */
Object.defineProperty(CMSprite.prototype, "boundingRule", {

	get() {
		return this.boundingRule_Private;
	},

	set(newRule="none") {
		this.boundingRule_Private = newRule;

		if(Array.isArray(newRule)) {
			switch(newRule.length) {
				case 1:
					[this.boundingRuleTop, this.boundingRuleRight,
						this.boundingRuleBottom, this.boundingRuleLeft] = Array(4).fill(newRule[0]);
					break;
				case 2: // Similar to CSS shorthand, 2 values imply vertical then horizontal
					this.boundingRuleTop = newRule[0];
					this.boundingRuleBottom = newRule[0];
					this.boundingRuleLeft = newRule[1];
					this.boundingRuleRight = newRule[1];
					break;
				case 4:
					[this.boundingRuleTop, this.boundingRuleRight,
						this.boundingRuleBottom, this.boundingRuleLeft] = newRule;
					break;
				default: {
					console.error("Invalid array length of " + newRule.length +
						" for CMSprite bounding rule");
				}
			}
		}
		else { // Single rule is defined, so apply to all sides
			[this.boundingRuleTop, this.boundingRuleRight,
				this.boundingRuleBottom, this.boundingRuleLeft] = Array(4).fill(newRule);
		}
	}
});

/**
 * If a sprite's layer is changed dynamically, we need
 * to update sprite drawing accordingly. This also allows
 * dev to simply set sprite.layer = "top" (or "bottom")
 * without keeping track of every layer.
 */
Object.defineProperty(CMSprite.prototype, "layer", {
	get() {
		return this.layer_Private;
	},

	set(newLayer) {
		if(newLayer === "top") {
			let highestLayer = game.sprites.reduce((accumulator, currentValue) => Math.max(accumulator, currentValue.layer), 0);
			newLayer = highestLayer + 1;
		}
		else
		if(newLayer === "bottom") {
			let lowestLayer = game.sprites.reduce((accumulator, currentValue) => Math.min(accumulator, currentValue.layer), Infinity);
			newLayer = lowestLayer - 1;
		}

		this.layer_Private = newLayer;
		this.game.sprites.sort((a, b) => a.layer - b.layer);
	}
});

/**
 * Trims away very minor rounding errors,
 * mainly by converting insignificantly small
 * values to zero. Returns the number input,
 * or 0 if the input was sufficiently small.
 * @param {number} val - A number to check
 * @returns {number}
 */
CMGame.roundSmall = (val) => {

	let tempVal = val;

	// If preferred, dev can adjust these for different sensitivity
	let tooCloseToZero = 0.00000001;
	let tooManyZeroes = "00000000000000";
	let tooManyNines = "99999999999999";

	// Work with long repeated decimals (not large integers)
	if((val + "").includes(".")) {
		tempVal = val + "";
		let vSplit = tempVal.split("."); 
		let ints = vSplit[0];
		let dec = vSplit[1];

		// round tiny errors
		if(dec.includes(tooManyZeroes)) {

			// we cut off all decimal tempValues starting here
			dec = "" + parseFloat( dec.substring(0, dec.indexOf(tooManyZeroes)) );
		}

		// sign will matter here
		if(dec.includes(tooManyNines)) {
			let ninesLocation = dec.indexOf(tooManyNines);

			if(ninesLocation === 0) { // started after decimal, round up to next integer
				ints = parseInt(ints) + Math.sign(val);
				dec = 0;
			}
			else {
				// strip away all the nines (and anything after) and round up
				dec = parseFloat( "." + dec.substring(0, ninesLocation) );
				dec += 1 / (10**ninesLocation);
				dec = parseFloat( (dec + "").replace(".", "") );
			}
		}

		tempVal = parseFloat(ints + "." + dec);
	}

	if( Math.abs(tempVal) < tooCloseToZero )
		return 0;
	else
		return tempVal;
};

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
 * Get P(n, r) ("n permute r") value for a given n.
 * Sometimes written nPr (with n and r as subscripts).
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
 * Sometimes written nCr (with n and r as subscripts).
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
	let sumNumbers = function(...args) {
		return args.reduce((previous, current) => {
			return previous + current;
		});
	};

	// How small the difference in partial sums must be for us to assume convergence
	const CONVERGENCE_THRESHOLD = 0.000000000001;

	// Maximum # of loop iterations we will run before assuming divergence
	const DIVERGENCE_THRESHOLD = 10000000;

	/**
	 * Sum up a list of numbers, provided as all
	 * the arguments, or add up a sigma sum
	 * between the given indices.
	 * @param {function|number} func - The sigma sum formula to use
	 * @param {number} [k=0] - The starting index integer, generally 0 or 1.
	 * @param {number} [n=0] - The ending index integer, or Infinity.
	 * @returns {number|string} The sum (possibly infinite), or undefined if cannot find a clear sum
	 */
	CMGame.sum = function(func, k=0, n=0) {
		if(typeof func !== "function") {
			// Assume all arguments are numbers if first one is
			return sumNumbers(...arguments);
		}

		let partialSum = 0;
		let nextSummand = func(k);
		let nextPartial = partialSum + nextSummand;
		let nextDiff = Math.abs(nextPartial - partialSum);

		if(Number.isFinite(n)) {
			for(let i = k; i <= n; i++) {
				partialSum += func(i);
			}
		}
		else {
			/**
			 * If n is Infinity, we assume this is a series. Continue while additions
			 * are still significant, say, greater than 1 trillionth (this is a game
			 * engine, not Python - greater precision should not be attempted here)
			 */
			try {
				for(let i = k, j = 0; i <= n; i++, j++) {
					partialSum += nextSummand; // Add amount calculated from previous iteration
					nextSummand = func(i + 1);
					nextPartial = partialSum + nextSummand;
					nextDiff = Math.abs(nextPartial - partialSum);

					if(nextDiff < CONVERGENCE_THRESHOLD) {
						return nextPartial;
					}

					// Still hasn't converged after 2 million loops? Let's give up
					if(j > DIVERGENCE_THRESHOLD) {
						return;
					}
				}
			}
			catch(/* Maximum call stack size exceeded error */ e) {
				/**
				 * Current browser can't handler 2000000 iterations.
				 * Return undefined.
				 */
				return;
			}
		}

		return partialSum;
	};
}());

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
 * connecting two points, or center of the triangle
 * created by connecting 3 points
 * @param {object[]} args - A collection of points (any objects with numeric x, y values)
 * @returns {object}
 */
CMGame.midpoint = (...args) => {
	let x = args.reduce((xSum, currentPoint) =>
		xSum + currentPoint.x, 0) / args.length;

	let y = args.reduce((ySum, currentPoint) =>
		ySum + currentPoint.y, 0) / args.length;

	return new CMPoint(x, y);
};

/**
 * A convenience function for ensuring a value
 * stays between two finite values, or less than
 * a fixed positive finite value.
 * Useful, e.g., when defining variable colors
 * that need rgb values between 0 and 255.
 * @param {number} entry - The value to bound
 * @param {number} bound - The lower bound (inclusive), or upper bound if
 *   a third parameter is not passed in (in this case, we assume lower bound is 0).
 * @param {number} [upperBound] - The upper bound (inclusive)
 * @returns {number}
 */
CMGame.clamp = (entry, bound, upperBound) => {
	if(typeof upperBound === "number")
		return Math.min(Math.max( bound, entry ), upperBound);
	else
		return Math.min(Math.max( 0, entry ), bound);
};

/**
 * Shifts a value to an appropriate value
 * between two others. Unlike clamp, this
 * process does not force an entry outside bounds to
 * take the value of the bounds, but rather
 * adds/subtracts the length of the interval
 * until the value is within the bounds.
 * For integer values and a lower bound of 0,
 * this is just usual % operation in JavaScript.
 * If `entry` is negative, this returns the
 * value expected in number theory (but not in JS).
 * CMGame.mod(-2, 0, 10); // returns 8, whereas (-2) % 10 returns -2 
 *
 * This can take non-integer values, making it especially
 * useful in keeping radian values between 0 and Math.TAU.
 *
 * Similar to modular arithmetic, the "lower bound" is
 * inclusive, and the "upper bound" is exclusive. So for
 * instance, and angel can map to 0, but not to Math.TAU.
 *
 * @param {number} entry - The number being mapped into this interval
 * @param {number} bound - The lower bound. If upperBound is not provided,
 *   this becomes the upper bound, and the lower bound is assumed to be 0.
 * @param {number} [upperBound] - The upper bound if provided
 * @returns {number}
 */
CMGame.mod = (entry, bound, upperBound) => {
	let lowerBound = 0;
	if(typeof upperBound === "number")
		lowerBound = bound;

	let intervalLength = (upperBound - lowerBound);

	// Since JS supports non-integer modding, this reduces to normal process
	if(entry >= 0 && lowerBound >= 0 && upperBound >= 0) {
		return lowerBound + entry % intervalLength;
	}

	// Take care of negatives
	while(entry < lowerBound) {
		entry += intervalLength;
	}

	// Redundant?
	while(entry >= upperBound) {
		entry -= intervalLength;
	}

	return entry;
};

/** Class to manage drawable functions */
class CMFunction {

	/**
	 * Creates a CMFunction instance.
	 *
	 * @param {CMGame} game - The associated CMGame instance
	 * @param {function} func - A single input function defining the graph.
	 *   The default assumption is a standard Cartesian "return y as a function
	 *   of x" function, but other options can be set in options.type.
	 * @param {object} [opts] - An object of options. All values are optional, including opts itself.
	 * @param {string} [opts.type="cartesian"] - "cartesian" (default), "polar", "parametric", "xofy" (sideways)
	 *   "cartesian" is standard. func should take a single input (x) and return single output (y)
	 *   "yofox" is essentially Cartesian along y-axis, instead of x. func should take a single
	 *      input (y) and return single output (x)
	 *   "polar" is polar coordinates. func should take a single input (theta) and return single output (r)
	 *   "parametric" is based on an extra parameter (t). func should take a single input (t) and
	 *      return a point with an x value and a y value, e.g., func = (t) => {x: t**2, y: Math.cos(t)}
	 * @param {string} [opts.strokeStyle] - color for the graph curve
	 * @param {string} [opts.fillStyleBelow] - color for area below graph curve
	 * @param {string} [opts.fillStyleAbove] - color for area above graph curve
	 * @param {string} [opts.lineWidth] - line width for the graph curve
	 * @param {string} [opts.name] - Convenience, e.g., for drawing name to screen
	 * @param {boolean} [opts.fixed] - true if you know the graph will not change. Useful for optimizations.
	 * @param {object} [opts.start] - Object defining real number start values for x, t, etc.
	 * @param {object} [opts.end] - Object defining real number end values for x, t, etc.
	 * @param {object} [opts.velocity] - Object defining quantity to change values per frame
	 * @param {number} [opts.tStep] - For "parametric" type, defines how much t increments to next screen value
	 * @param {number} [opts.thetaStep] - For "polar" type, defines how much theta increments to next screen value
	 * @param {object|array} [opts.origin] - A point-like object or array with 2 values (x and y)
	 *   representing the pixel coordinates this function should treat as the origin. If
	 *   not provided, defaults to the current game's origin (as expected).
	 * @param {function} [opts.onupdate] - A callback called after
	 *   update(). Take game's frameCount as only parameter
	 * @param {function} [opts.onbeforedraw] - A callback called before this function is
	 *   drawn to the screen. Can be used e.g., to draw small background relative to this
	 *   graph's origin.
	 * @param {function} [opts.ondraw] - A callback called after
	 *   draw(). Takes game's drawing context as only parameter
	 * @param {function|array} [opts.discontinuousAt] - A boolean function, taking in real values, that
	 *   is true when strokes should break (i.e., at points of discontinuity), or an array of specific real
	 *   values where these breaks should occur. If this function is not present, constructor will assume
	 *   where breaks occur for functions with floor or ceil functions in them. Note: asymptotes are
	 *   determined during drawing and are not drawn, so do not need to be included here.
	 */
	constructor(game, func, opts={}) {
		let self = this;

		this.game = game;
		this.type = opts.type || "cartesian";
		this.lineWidth = opts.lineWidth || 1;

		// Information stored for checking point positions later
		this.continuous = opts.continuous || true;
		if(!opts.discontinuousAt) {
			let funcString = func.toString();
			if(funcString.includes("Math.floor") || funcString.includes("Math.ceil")) {
				this.continuous = false;

				this.discontinuousAt = function(x, nextX) {
					return !self.game.almostEqual(self.realToScreenOf(x), self.realToScreenOf(nextX));
				};
			}
		}
		else
		if(Array.isArray(opts.discontinuousAt)) {
			this.discontinuousAt = function(x, nextX) {
				return opts.discontinuousAt.includes(x);
			};
		}
		else
		if(typeof opts.discontinuousAt === "function") {
			this.discontinuousAt = opts.discontinuousAt;
		}

		/**
		 * We'll allow different "origin" so that multiple different
		 * functions can occur onscreen simultaneously. This will
		 * be especially useful when defining multiple sprite
		 * paths.
		 */
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
		else {
			this.origin = new CMPoint(game.origin);
		}

		this.of = func; // e.g., if you name this function f, then f.of(2) is similar to f(2)

		// A function shifting and scaling given function's output (with real input) to the screen
		this.realToScreenOf = null;

		this.tStep = typeof opts.tStep === "number" ? opts.tStep : 0.1;
		this.thetaStep = typeof opts.thetaStep === "number" ? opts.thetaStep : (Math.TAU / 360);

		this.strokeStyle = opts.strokeStyle || CMColor.DARK_GRAY;
		this.fillStyleBelow = opts.fillStyleBelow;
		this.fillStyleAbove = opts.fillStyleAbove;
		this.name = opts.name || "";

		if(typeof opts.color !== "undefined") {
			console.warn("\"color\" is not a valid option for CMFunction. Use \"strokeStyle\" instead.");
		}

		this.animationTime = 0;
		this.start = {
			t: 0,
			x: -(this.origin.x / this.game.graphScalar),
			y: -((this.game.height - this.origin.y) / this.game.graphScalar),
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
			t: Math.max(this.game.width, this.game.height) / this.tStep,
			x: ((this.game.width - this.origin.x) / this.game.graphScalar),
			y: (this.origin.y / this.game.graphScalar),
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
			animationTime: 0, // If not animated, no need to build this variable

			start: {t: 0, x: 0, y: 0, r: 0, theta: 0},
			end: {t: 0, x: 0, y: 0, r: 0, theta: 0}
		};

		if(!opts.velocity) {
			opts.velocity = {};
		}

		for(let key in opts.velocity) {
			if(key === "start" || key === "end") {
				for(let keyInEndpoint in opts.velocity[key]) {
					this.velocity[key][keyInEndpoint] = opts.velocity[key][keyInEndpoint];
				}
			}
			else
				this.velocity[key] = opts.velocity[key];
		}

		if(typeof opts.onupdate === "function")
			this.onupdate = opts.onupdate;

		if(typeof opts.onbeforedraw === "function")
			this.onbeforedraw = opts.onbeforedraw;

		if(typeof opts.ondraw === "function")
			this.ondraw = opts.ondraw;

		this.path = new Path2D();

		// Path2D instances stored for "filling in" colors above/below graph
		this.pathAbove = null;
		this.pathBelow = null;

		this.valsArray = null;
		this.screenValsArray = null;
		this.fixed = !!opts.fixed;

		if(this.fixed) {

			// For a function without values changing, we can store the values once
			switch(self.type) {
				case "xofy":
					self.valsArray = Array((self.game.height - 0) / 1)
						.fill(0)
						.map((element, idx, fullArr) => idx)
						.map(y => self.of( self.game.xToReal( y, self.origin ) ) );

					self.of = function(y) {
						return self.valsArray[Math.floor(self.game.yToScreen(y))];
					};

					self.realToScreenOf = function(y) { return self.game.xToScreen(self.of(y), self.origin); };

					self.screenValsArray = Array((self.game.height - 0) / 1)
						.fill(0)
						.map((element, idx, fullArr) => idx)
						.map(y => self.realToScreenOf( self.game.xToReal( y, self.origin ) ) );

					self.realToScreenOf = function(y) {
						return self.screenValsArray[Math.floor(self.game.yToScreen(y))];
					};
					break;
				case "polar":
					self.valsArray = Array(Math.floor((Math.TAU - 0) / self.thetaStep)) // Create array with 3600 slots
						.fill(0)
						.map((element, idx, fullArr) => idx)
						.map(i => self.of( i * self.thetaStep ) );

					self.of = function(theta) {
						while(theta < 0) {
							theta += Math.TAU;
						}

						while(theta > Math.TAU) {
							theta -= Math.TAU;
						}

						return self.valsArray[Math.floor(theta / self.thetaStep)];
					};

					self.realToScreenOf = function(theta) {
						return (self.of(theta) * self.game.graphScalar);
					};

					self.screenValsArray = Array(Math.floor((Math.TAU - 0) / self.thetaStep)) // Create array with 3600 slots
						.fill(0)
						.map((element, idx, fullArr) => idx)
						.map(i => self.realToScreenOf( i * self.thetaStep ) );

					self.realToScreenOf = function(theta) {
						return self.screenValsArray[Math.floor(theta / self.thetaStep)];
					};
					break;
				case "parametric":
					self.valsArray = Array(Math.floor((self.end.t - self.start.t ) / self.tStep))
						.fill(0)
						.map((element, idx, fullArr) => idx)
						.map(i => self.of( i * self.tStep ) );

					self.of = function(t) {
						return self.valsArray[Math.floor(t)];
					};

					self.realToScreenOf = function(t) {
						let xyFromParam = self.of( t );
						return self.game.toScreen(xyFromParam, self.origin);
					};

					self.screenValsArray = Array(Math.floor((self.end.t - self.start.t ) / self.tStep))
						.fill(0)
						.map((element, idx, fullArr) => idx)
						.map(t => self.realToScreenOf( t * self.tStep ) );

					self.realToScreenOf = function(t) {
						return self.screenValsArray[Math.floor(t)];
					};
					break;
				case "cartesian":
				default:
					self.valsArray = Array((self.game.width - 0) / 1)
						.fill(0)
						.map((element, idx, fullArr) => idx)
						.map(i => self.of( self.game.xToReal( i, self.origin ) ) );

					self.of = function(x) {
						return self.valsArray[Math.floor(self.game.xToScreen(x))];
					};

					self.realToScreenOf = function(x) { return self.game.yToScreen(self.of(x), self.origin); };

					self.screenValsArray = Array((self.game.width - 0) / 1)
						.fill(0)
						.map((element, idx, fullArr) => idx)
						.map(i => self.realToScreenOf( self.game.xToReal( i, self.origin ) ) );

					self.realToScreenOf = function(x) {
						return self.screenValsArray[Math.floor(self.game.xToScreen(x))];
					};
					break;
			}
		}
		else
		// Define the onscreen "realToScreenOf" function for functions that are not "fixed" on the screen
		{
			switch(this.type) {
				case "xofy":
					self.realToScreenOf = function(y) { return self.game.xToScreen(self.of(y), self.origin); };
					break;
				case "polar":
					self.realToScreenOf = function(theta) {
						return (self.of(theta) * self.game.graphScalar);
					};
					break;
				case "parametric":
					self.realToScreenOf = function(t) {
						let xyFromParam = self.of( t );
						return self.game.toScreen(xyFromParam, self.origin);
					};
					break;
				case "cartesian":
				default:
					self.realToScreenOf = function(x) {
							return self.game.yToScreen(self.of(x), self.origin);
						};
					break;
			}
		}

		this.unzoomedOrigin = new CMPoint(
			this.origin.x,
			this.origin.y
		);

		// Note: for zoom in/out we only need to track x and y values
		this.unzoomedStart = new CMPoint(this.start);
		this.unzoomedEnd = new CMPoint(this.end);

		// Define pathAbove and pathBelow
		this.buildGraphPath(this.game.offscreenCtx);
		if(this.fixed) {
			this.draw = this.drawGraphPath;
		}
	}

	/**
	 * Redefines graph bounds to current screen,
	 * in particular when graphScalar is changed
	 * dynamically - only really affects Cartesian
	 * graphs, as they tend to the screen
	 * boundaries. For simplicity, this is only
	 * invoked on "zoom out".
	 * Mostly used internally.
	 * @param {number} [oldScalar=1] - graphScalar before the change
	 */
	updateBounds(oldScalar=1) {

		this.origin.x = this.origin.x + (this.unzoomedOrigin.x - this.origin.x) / this.game.zoomLevel;
		this.origin.y = this.origin.y + (this.unzoomedOrigin.y - this.origin.y) / this.game.zoomLevel;

		if(this.origin.x - (oldScalar * this.start.x) === 0) {
			this.start.x = -(this.origin.x / this.game.graphScalar);
		}

		if(this.origin.x + (oldScalar * this.end.x) === this.game.canvas.width) {
			this.end.x = ((this.game.width - this.origin.x) / this.game.graphScalar);
		}

		if(this.origin.y - oldScalar * this.start.y === 0) {
			this.start.y = -((this.game.height - this.origin.y) / this.game.graphScalar);
		}

		if(this.origin.y - oldScalar * this.end.y === this.game.canvas.height) {
			this.end.y = (this.origin.y / this.game.graphScalar);
		}
	}

	/**
	 * For optimization, prebuilds the drawing path
	 * when dev knows it will not change. (options.fixed=true)
	 * @param {CanvasRenderingContext2D} [ctx=this.game.offscreenCtx] - The game's drawing context
	 */
	buildGraphPath(ctx=this.game.offscreenCtx) {
		let game = this.game;
		let canvas = game.canvas;
		let initialI;
		let finalI;
		let initialScreenRealX;
		let initialScreenRealY;
		let initialPoint;

		this.path = new Path2D();

		switch(this.type) {
			case "cartesian":
				// Set up endpoints, bounding horizontally within visible canvas (to optimize)
				initialI = Math.max(0, this.game.xToScreen(this.start.x, this.origin) );
				initialScreenRealX = (initialI - this.origin.x) / game.graphScalar;
				finalI = Math.min(canvas.width, this.game.xToScreen(this.end.x, this.origin) );

				this.path.moveTo(initialI, this.realToScreenOf( initialScreenRealX ) );

				for(let i = initialI + 1; i <= finalI; i++) {

					let screenGraphX = (i - this.origin.x) / game.graphScalar;
					let screenGraphXMinus1 = (i - 1 - this.origin.x) / game.graphScalar;

					// Don't connect over vertical asymptotes
					if(
						(this.realToScreenOf(screenGraphX) < 0 && this.realToScreenOf(screenGraphXMinus1) > canvas.height) ||
						(this.realToScreenOf(screenGraphXMinus1) < 0 && this.realToScreenOf(screenGraphX) > canvas.height) ||
						 this.discontinuousAt(screenGraphXMinus1, screenGraphX)) {

						this.continuous = false;
						this.path.moveTo(i, this.realToScreenOf(screenGraphX) );
					}
					else {
						this.path.lineTo(i, this.realToScreenOf(screenGraphX) );
					}
				}

				this.pathBelow = new Path2D(this.path);
				this.pathBelow.lineTo(finalI, canvas.height + ctx.lineWidth);
				this.pathBelow.lineTo(canvas.width, canvas.height + ctx.lineWidth);
				this.pathBelow.lineTo(initialI, canvas.height + ctx.lineWidth);
				this.pathBelow.closePath();

				this.pathAbove = new Path2D(this.path);
				this.pathAbove.lineTo(finalI, 0 - ctx.lineWidth);
				this.pathAbove.lineTo(initialI, 0 - ctx.lineWidth);
				this.pathAbove.closePath();
				break;
			case "xofy":
				/**
				 * Graph path moves up y-axis, starting at game.height,
				 * but we allow our index to move from 0 to game.height
				 * and subtract from game.height when drawing the path
				 */
				initialI = Math.max(0, game.height - this.game.yToScreen( this.start.y, this.origin ) );
				initialScreenRealY = (initialI - this.origin.y) / game.graphScalar;
				finalI = Math.min(game.height, game.height - this.game.yToScreen( this.end.y, this.origin) );

				this.path.moveTo(this.realToScreenOf( initialScreenRealY ), game.height - initialI);

				for(let i = initialI + 1; i <= finalI; i++) {

					let screenGraphY = -((game.height - i) - this.origin.y) / game.graphScalar;
					let screenGraphYMinus1 = -(this.origin.y - (i - 1)) / game.graphScalar;

					// Don't connect over horizontal asymptotes
					if(
						(this.realToScreenOf(screenGraphY) < 0 && this.realToScreenOf(screenGraphYMinus1) > canvas.width) ||
						(this.realToScreenOf(screenGraphYMinus1) < 0 && this.realToScreenOf(screenGraphY) > canvas.width)) {

						this.continuous = false;
						this.path.moveTo(this.realToScreenOf(screenGraphY), game.height - i );
					}
					else {
						this.path.lineTo(this.realToScreenOf(screenGraphY), game.height - i);
					}
				}

				this.pathBelow = new Path2D(this.path);
				this.pathBelow.lineTo(-ctx.lineWidth, game.height - finalI);
				this.pathBelow.lineTo(-ctx.lineWidth, game.height - initialI);
				this.pathBelow.closePath();

				this.pathAbove = new Path2D(this.path);
				this.pathAbove.lineTo(canvas.width + ctx.lineWidth, game.height - finalI);
				this.pathAbove.lineTo(canvas.width + ctx.lineWidth, game.height - initialI);
				this.pathAbove.closePath();
				break;
			case "polar":
				initialPoint = game.fromPolar({
						r: this.realToScreenOf(0),
						theta: 0
					});

				this.path.moveTo(this.origin.x + initialPoint.x, this.origin.y - initialPoint.y);
				for(let th = this.thetaStep; th <= Math.TAU; th += this.thetaStep) {

					let point = game.fromPolar(
						{
							r: this.realToScreenOf(th),
							theta: th
						});

					this.path.lineTo( this.origin.x + point.x, this.origin.y - point.y);
				}

				this.pathBelow = new Path2D(this.path);
				this.pathBelow.closePath(); // if necessary

				// Attempt to fill area outside the path. Note: may not work as expected if polar path is not closed
				this.pathAbove = new Path2D(this.path);

				this.pathAbove.moveTo(game.width + ctx.lineWidth, this.origin.y - initialPoint.y); // right wall
				this.pathAbove.lineTo(game.width + ctx.lineWidth, game.height + ctx.lineWidth); // bottom right corner
				this.pathAbove.lineTo(0 - ctx.lineWidth, game.height + ctx.lineWidth);
				this.pathAbove.lineTo(0 - ctx.lineWidth, 0 - ctx.lineWidth);
				this.pathAbove.lineTo(game.width + ctx.lineWidth, 0 - ctx.lineWidth);
				this.pathAbove.lineTo(game.width + ctx.lineWidth, this.origin.y - initialPoint.y);
				break;
			case "parametric":
				initialPoint = this.realToScreenOf(0);
				this.path.moveTo(initialPoint.x, initialPoint.y);

				// If no end has been provided, there is nothing to draw (no time elapses)
				for(let tIndex = this.tStep; tIndex < this.end.t; tIndex += this.tStep) {
					let point = this.realToScreenOf(tIndex);
					this.path.lineTo( point.x, point.y);
				}

				this.pathAbove = new Path2D(this.path);
				this.pathBelow = new Path2D(this.path);
				break;
		}		
	}

	/**
	 * Draws static/fixed graph in current frame, using a
	 * stored Path2D. If this CMFunction instance
	 * is fixed, this function replaces the draw() method
	 * as an optimization.
	 * @param {CanvasRenderingContext2D} [ctx=this.game.offscreenCtx] - The game's drawing context
	 */
	drawGraphPath(ctx=this.game.offscreenCtx) {
		ctx.lineWidth = this.lineWidth;

		if(this.pathBelow && this.fillStyleBelow && this.fillStyleBelow !== CMColor.NONE) {
			ctx.fillStyle = this.fillStyleBelow;
			ctx.fill(this.pathBelow);
		}

		if(this.pathAbove && this.fillStyleAbove && this.fillStyleAbove !== CMColor.NONE) {
			ctx.fillStyle = this.fillStyleAbove;
			ctx.fill(this.pathAbove);
		}

		if(this.strokeStyle !== CMColor.NONE) {
			ctx.strokeStyle = this.strokeStyle;
			ctx.stroke(this.path);
		}
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
	}

	/**
	 * Draws as a polar function
	 * @param {object} ctx - The drawing context
	 */
	drawPolar(ctx) {
		let game = this.game;
		let canvas = game.canvas;
		ctx.lineWidth = this.lineWidth;
		ctx.strokeStyle = this.strokeStyle;

		let initialPoint = game.fromPolar({
				r: this.realToScreenOf(0),
				theta: 0
			});

		this.path = new Path2D();
		this.path.moveTo(this.origin.x + initialPoint.x, this.origin.y - initialPoint.y);
		for(let th = this.thetaStep; th <= this.end.theta; th += this.thetaStep) {

			let point = game.fromPolar(
				{
					r: this.realToScreenOf(th),
					theta: th
				});

			this.path.lineTo( this.origin.x + point.x, this.origin.y - point.y);
		}

		if(this.fillStyleBelow && this.fillStyleBelow !== CMColor.NONE) {
			this.pathBelow = new Path2D(this.path);
			this.pathBelow.closePath(); // if necessary
			ctx.fillStyle = this.fillStyleBelow;
			ctx.fill(this.pathBelow);
		}

		// Attempt to fill area outside the path. Note: may not work as expected if polar path is not closed
		if(this.fillStyleAbove && this.fillStyleAbove !== CMColor.NONE) {
			this.pathAbove = new Path2D(this.path);

			this.pathAbove.moveTo(game.width + ctx.lineWidth, this.origin.y - initialPoint.y); // right wall
			this.pathAbove.lineTo(game.width + ctx.lineWidth, game.height + ctx.lineWidth); // bottom right corner
			this.pathAbove.lineTo(0 - ctx.lineWidth, game.height + ctx.lineWidth);
			this.pathAbove.lineTo(0 - ctx.lineWidth, 0 - ctx.lineWidth);
			this.pathAbove.lineTo(game.width + ctx.lineWidth, 0 - ctx.lineWidth);
			this.pathAbove.lineTo(game.width + ctx.lineWidth, this.origin.y - initialPoint.y);

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

		let initialPoint = this.realToScreenOf(0);
		this.path = new Path2D();
		this.path.moveTo(initialPoint.x, initialPoint.y);

		// If no end has been provided, there is nothing to draw (no time elapses)
		for(let tIndex = this.tStep; tIndex < this.end.t; tIndex += this.tStep) {
			let point = this.realToScreenOf(tIndex);
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

		/**
		 * Graph path moves up y-axis, starting at game.height,
		 * but we allow our index to move from 0 to game.height
		 * and subtract from game.height when drawing the path
		 */
		let initialI = Math.max(0, game.height - this.game.yToScreen( this.start.y, this.origin) );
		let initialScreenRealY = (initialI - this.origin.y) / game.graphScalar;
		let finalI = Math.min(game.height, game.height - this.game.yToScreen( this.end.y, this.origin) );

		// Draw the current graph
		ctx.lineWidth = this.lineWidth;
		ctx.strokeStyle = this.strokeStyle;
		this.path = new Path2D();
		this.path.moveTo(this.realToScreenOf( initialScreenRealY ), game.height - initialI);

		for(let i = initialI + 1; i <= finalI; i++) {

			let screenGraphY = -((game.height - i) - this.origin.y) / game.graphScalar;
			let screenGraphYMinus1 = -(this.origin.y - (i - 1)) / game.graphScalar;

			// Don't connect over horizontal asymptotes
			if(
				(this.realToScreenOf(screenGraphY) < 0 && this.realToScreenOf(screenGraphYMinus1) > canvas.width) ||
				(this.realToScreenOf(screenGraphYMinus1) < 0 && this.realToScreenOf(screenGraphY) > canvas.width)) {

				ctx.stroke(this.path);
				this.continuous = false;
				this.path.moveTo(this.realToScreenOf(screenGraphY), game.height - i );
			}
			else {
				this.path.lineTo(this.realToScreenOf(screenGraphY), game.height - i);
			}
		}

		if(this.fillStyleBelow && this.fillStyleBelow !== CMColor.NONE) {
			this.pathBelow = new Path2D(this.path);
			this.pathBelow.lineTo(-ctx.lineWidth, game.height - finalI);
			this.pathBelow.lineTo(-ctx.lineWidth, game.height - initialI);
			this.pathBelow.closePath();
			ctx.fillStyle = this.fillStyleBelow;
			ctx.fill(this.pathBelow);
		}

		if(this.fillStyleAbove && this.fillStyleAbove !== CMColor.NONE) {
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
	}

	/**
	 * Draws graph in current frame
	 * @param {CanvasRenderingContext2D} ctx - The game's drawing context
	 */
	drawCartesian(ctx) {
		let game = this.game;
		let canvas = game.canvas;

		// Set up endpoints, bounding horizontally within visible canvas (to optimize)
		let initialI = Math.max(0, this.game.xToScreen( this.start.x, this.origin ) );
		let initialScreenRealX = (initialI - this.origin.x) / game.graphScalar;
		let finalI = Math.min(canvas.width, this.game.xToScreen( this.end.x, this.origin) );

		// Draw the current graph
		ctx.lineWidth = this.lineWidth;
		ctx.strokeStyle = this.strokeStyle;
		this.path = new Path2D();
		this.path.moveTo(initialI, this.realToScreenOf( initialScreenRealX ) );

		for(let i = initialI + 1; i <= finalI; i++) {

			let screenGraphX = (i - this.origin.x) / game.graphScalar;
			let screenGraphXMinus1 = (i - 1 - this.origin.x) / game.graphScalar;

			// Don't connect over vertical asymptotes
			if(
				(this.realToScreenOf(screenGraphX) < 0 && this.realToScreenOf(screenGraphXMinus1) > canvas.height) ||
				(this.realToScreenOf(screenGraphXMinus1) < 0 && this.realToScreenOf(screenGraphX) > canvas.height) ||
				this.discontinuousAt(screenGraphXMinus1, screenGraphX)) {

				ctx.stroke(this.path);
				this.continuous = false;
				this.path.moveTo(i, this.realToScreenOf(screenGraphX) );
			}
			else {
				this.path.lineTo(i, this.realToScreenOf(screenGraphX) );
			}
		}

		if(this.fillStyleBelow && this.fillStyleBelow !== CMColor.NONE) {
			this.pathBelow = new Path2D(this.path);
			this.pathBelow.lineTo(finalI, canvas.height + ctx.lineWidth);
			this.pathBelow.lineTo(initialI, canvas.height + ctx.lineWidth);
			this.pathBelow.closePath();
			ctx.fillStyle = this.fillStyleBelow;
			ctx.fill(this.pathBelow);
		}

		if(this.fillStyleAbove && this.fillStyleAbove !== CMColor.NONE) {
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
				let pointXStyle = "color: rgb(225, 225, 0)";
				let pointYStyle = "color: rgb(225, 225, 0)";

				if(point.x < 0 || point.x > this.game.width) {
					pointXStyle = "color: rgb(255, 95, 95)";
				}

				if(point.y < 0 || point.y > this.game.height) {
					pointYStyle = "color: rgb(255, 95, 95)";
				}

				if(this.debug) {
					console.log(`Point (%c${point.x}%c, %c${point.y}%c) is outside canvas`,
						pointXStyle, "color: default", pointYStyle, "color: default");
				}

				return "unknown";
			}
		}
		else {
			// Cannot assume only 3 paths exist; must calculate specific point

			let funcRealY = this.of( this.game.xToReal( point.x, this.origin ));
			let pointRealY = this.game.yToReal( point.y, this.origin );

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

	/**
	 * A boolean function to keep track of where to draw
	 * discontinuities on the visible graph.
	 * This is meant to be overridden when function is created.
	 * @param {number} input - A domain point to check
	 * @param {number} [nextInput] - The real domain point drawn next on the graph
	 *   e.g., for type "cartesian", this is x + 1/self.game.graphScalar
	 * @returns {boolean}
	 */
	discontinuousAt(input, nextInput) {
		return false;
	}

	/**
	 * Each CMFunction instance, f, has 4
	 * types of mathematical functions:
	 *
	 * - f.of() maps a real number to a real number (or point)
	 * - f.screenOf() maps the onscreen pixel point to where the function's
	 *   output would be (as an onscreen pixel point)
	 * - f.realToScreenOf() takes the real input, returns the value (in
	 *    pixels) where that input's real output would show on the screen
	 * - f.screenToRealOf() take an onscreen pixel point as an input,
	 *   determines what the real-valued equivalent input is, and
	 *   returns the function's real output for that real input
	 */

	/**
	 * Takes screen pixel input value, and returns
	 * screen pixel output value associated with
	 * this function and function type.
	 * @param {number} screenInput - A pixel value (x or y) or angle or time
	 * @returns {number|object} object for "parametric", otherwise a number
	 */
	screenOf( screenInput ) { // i.e., screenToScreenOf() 

		let realInput;
		switch(this.type) {
			case "cartesian":
				realInput = this.game.xToReal( screenInput, this.origin );
				break;
			case "xofy":
				realInput = this.game.yToReal( screenInput, this.origin );
				break;
			case "polar": // angle and "time" do not change
			case "parametric":
				realInput = screenInput;
				break;
		}

		return this.realToScreenOf( realInput );
	}

	/**
	 * Takes screen pixel input value, uses its real equivalent,
	 * and returns real (not screen pixel) output value
	 * associated with this function and function type.
	 * @param {number} screenInput - A pixel value (x or y) or angle or time
	 * @returns {number|object} object for "parametric", otherwise a number
	 */
	screenToRealOf( screenInput ) {

		let realInput;
		switch(this.type) {
			case "cartesian":
				realInput = this.game.xToReal( screenInput, this.origin );
				break;
			case "xofy":
				realInput = this.game.yToReal( screenInput, this.origin );
				break;
			case "polar": // angle and "time" do not change
			case "parametric":
				realInput = screenInput;
				break;
		}

		return this.of( realInput );
	}

	/**
	 * Creates a copy of this function with similar options.
	 * These options can be overridden in the passed in
	 * newOpts argument.
	 * @param {object} [newOpts={}] - A plain JS object of options, which should
	 *   contain any CMFunction constructor options that you want to be
	 *   different from the current instance.
	 * @returns {object} The newly created CMFunction instance
	 */
	clone(newOpts={}) {
		newOpts.operation = "clone";
		return this.operation("self", newOpts);
	}

	/**
	 * Returns a new CMFunction instance representing
	 * this one plus another one.
	 * @param {object} otherFunc - The other function to act on
	 * @param {object} [newOpts={}] - A plain JS object of options, which should
	 *   contain any CMFunction constructor options that you want to be
	 *   different from the current instance.
	 * @returns {object} The newly created CMFunction instance
	 */
	plus(otherFunc, newOpts={}) {
		newOpts.operation = "plus";
		return this.operation(otherFunc,  newOpts);
	}

	/**
	 * Returns a new CMFunction instance representing
	 * this one minus another one.
	 * @param {object} otherFunc - The other function to act on
	 * @param {object} [newOpts={}] - A plain JS object of options, which should
	 *   contain any CMFunction constructor options that you want to be
	 *   different from the current instance.
	 * @returns {object} The newly created CMFunction instance
	 */
	minus(otherFunc, newOpts={}) {
		newOpts.operation = "minus";
		return this.operation(otherFunc,  newOpts);
	}

	/**
	 * Returns a new CMFunction instance representing
	 * this one times another one.
	 * @param {object} otherFunc - The other function to act on
	 * @param {object} [newOpts={}] - A plain JS object of options, which should
	 *   contain any CMFunction constructor options that you want to be
	 *   different from the current instance.
	 * @returns {object} The newly created CMFunction instance
	 */
	times(otherFunc, newOpts={}) {
		newOpts.operation = "times";
		return this.operation(otherFunc,  newOpts);
	}

	/**
	 * Returns a new CMFunction instance representing
	 * this one divided by another one.
	 * @param {object} otherFunc - The other function to act on
	 * @param {object} [newOpts={}] - A plain JS object of options, which should
	 *   contain any CMFunction constructor options that you want to be
	 *   different from the current instance.
	 * @returns {object} The newly created CMFunction instance
	 */
	dividedBy(otherFunc, newOpts={}) {
		newOpts.operation = "dividedBy";
		return this.operation(otherFunc,  newOpts);
	}

	/**
	 * Returns a new CMFunction instance representing
	 * this one composed with another one.
	 * @param {object} otherFunc - The other function to act on
	 * @param {object} [newOpts={}] - A plain JS object of options, which should
	 *   contain any CMFunction constructor options that you want to be
	 *   different from the current instance.
	 * @returns {object} The newly created CMFunction instance
	 */
	composedWith(otherFunc, newOpts={}) {
		newOpts.operation = "composedWith";
		return this.operation(otherFunc,  newOpts);
	}

	/**
	 * This is a convenience function provided for
	 * DRY methods, as code is similar for various
	 * operations.
	 * @param {object} otherFunc - The other CMFunction instance to operate on
	 * @param {object} [newOpts={}] - A plain JS object of options, which should
	 *   contain any CMFunction constructor options that you want to be
	 *   different from the current instances.
	 */
	operation(otherFunc, newOpts={}) {
		let self = this,
			opts = {};

		let keys = ["type",
			"strokeStyle",
			"fillStyleBelow",
			"fillStyleAbove",
			"lineWidth",
			"name",
			"fixed",
			"start",
			"end",
			"velocity",
			"tStep",
			"thetaStep",
			"origin",
			"onupdate",
			"onbeforedraw",
			"ondraw",
			"discontinuousAt"];

		for(let i = 0; i < keys.length; i++) {
			opts[keys[i]] = newOpts[keys[i]] || this[keys[i]];
		}

		let ofFunc = null;
		switch(newOpts.operation) {
			case "plus":
				ofFunc = function(input) { return self.of(input) + otherFunc.of(input); }
				break;
			case "minus":
				ofFunc = function(input) { return self.of(input) - otherFunc.of(input); }
				break;
			case "times":
				ofFunc = function(input) { return self.of(input) * otherFunc.of(input); }
				break;
			case "dividedBy":
				ofFunc = function(input) { return self.of(input) / otherFunc.of(input); }
				break;
			case "composedWith":
				ofFunc = function(input) { return self.of( otherFunc.of(input) ); }
				break;
			default: // Default is just a clone of starting function
				ofFunc = function(input) { return self.of(input); };
				break;
		}

		return new CMFunction(this.game,
			ofFunc,
			opts);
	}

	// These can be overridden by dev
	onupdate(frameCount) {}
	onbeforedraw(ctx) {}
	ondraw(ctx) {}
}

/**
 * Bonus! Manage game based on Venn Diagrams
 */

/** Manages individual regions within a Venn diagram */
class CMVennRegion extends CMSprite {

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
		super(game, 0, 0, 0, "circle", null, "none", true);
		this.regionCode = regionCode;
		this.variation = variation;
		this.filled = false;
		this.fillStyle = "red"; // Since regions are created when diagram is, dev can/should set fill color later
		this.path = new Path2D();

		this.label = {
			text: "",
			x: 0,
			y: 0,
			active: false,
			fillStyle: CMColor.BLACK
		};

		// Use expected font for reference in measuring/centering labels below
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
	 * @param {object|number} pointOrX - The point, or point's x value
	 * @param {number} [y] - The point's y value
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

			ctx.restore(); // Exit "fence" region
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
class CMVennSet extends CMSprite {

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
		super(game, x, y, radius, "circle", null, "none", {layer: 1});

		this.path = null;
		this.complementPath = null;
		this.strokeStyle = CMColor.BLACK;
		this.lineWidth = 2;

		this.label = {
			text: "",
			x: x + .75 * radius,
			y: y + radius,
			active: false,
			fillStyle: CMColor.BLACK
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

	draw(ctx) {
		ctx.save();
		ctx.strokeStyle = this.strokeStyle;

		if(this.lineWidth > 0) {
			ctx.lineWidth = this.lineWidth;
			this.game.strokeOval(this.x, this.y, this.radius);
		}

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
class CMVertex extends CMSprite {
	/**
	 * Creates a CMVertex instance. Although x, y, and radius
	 * arguments are expected, we allow these to be optional
	 * for such instances where the vertex is not going to
	 * be visible, e.g., when it is just representing a "coloring" or
	 * an adjacency matrix.
	 * @param {CMGame} game - The current CMGame instance
	 * @param {number} [x=0] - The screen x for this vertex's center
	 * @param {number} [y=0] - The screen y for this vertex's center
	 * @param {number} [radius=10] - The radius for this vertex, drawn as a circle
	 * @param {string} fillStyle - The color to draw this vertex with
	 * @param {object} [label] - A plain JS object of options for a label; any values here will override defaults
	 * @param {string} [label.text] - A string label for this vertex
	 * @param {number} [label.x] - The x position for this label
	 * @param {number} [label.y] - The y position for this label
	 * @param {boolean} [label.active=true] - Whether to draw the label. Defaults
	 *   to true if not set but label.text has been set.
	 * @param {string} [label.fillStyle=CMColor.BLACK] - Color to draw the label with
	 */
	constructor(game, x=0, y=0, radius=10, fillStyle=CMColor.BLACK, label) {
		super(game, x, y, radius, "circle", fillStyle, "none", {layer: 1});

		this.degree = 0;
		this.adjacentVertices  = [];
		this.incidentEdges = [];

		this.label = {
			text: "",
			x: x + 20,
			y: y + 20,
			active: false,
			fillStyle: this.fillStyle,
			font: Math.max(12, (.5 * radius)) + "px Times New Roman, serif"
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
	 * Updates this vertex for current frame
	 * @param {number} frameCount - The game's integer counter for frames
	 */
	update(frameCount) {
		super.update(frameCount);
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
class CMEdge extends CMSprite {

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
	 * @param {string} [fillStyle=CMColor.BLACK] - The color to draw this vertex with
	 * @param {object} [label] - A plain JS object of options for a label
	 * @param {string} [label.text] - A string label for this vertex
	 * @param {number} [label.x] - The x position for this label
	 * @param {number} [label.y] - The y position for this label
	 * @param {boolean} [label.active=true] - Whether to draw the label. Defaults
	 *   to true if not set but label.text has been set.
	 * @param {string} [label.fillStyle=CMColor.BLACK] - Color to draw the label with
	 */
	constructor(game, vertex1=null, vertex2=null, lineWidth=1,
			fillStyle=CMColor.BLACK, label={}, directed=false, weight) {

		super(game, 0, 0, lineWidth, "line", fillStyle, "none");

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

			angle = this.game.slopeToRadians( this.game.getSlope(this.start, this.end), Math.sign(this.end.x - this.start.x) );

			if(Array.isArray(angle)) {
				angle = angle[0];
			}

			while(angle >= Math.TAU) {
				angle -= Math.TAU;
			}

			oppositeAngle = angle + Math.PI;
			while(oppositeAngle >= Math.TAU) {
				oppositeAngle -= Math.TAU;
			}

			arrowSide = Math.max(1.5 * this.width, 8); // For small widths, almost disappears
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

			if(this.vertex2 && this.vertex2.radius) {
				// Return to point outside circle
				this.arrowPath.lineTo( vBorder.x, vBorder.y );
			}
			else {
				this.arrowPath.lineTo(this.end.x, this.end.y); // return to tip of triangle
			}
		}
	}

	/**
	 * Updates edge in current frame, and rebuilds path in case of animation
	 * @param {number} frameCount - The game's integer counter for frames
	 */
	update(frameCount) {
		super.update(frameCount);
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
	}
}

/**
 * But wait! There's more...
 */

/**
 * A class to quickly create regular n-gons for 2D space.
 * This is still a sprite, without any special properties,
 * so add it with game.addSprite() or game.add()
 */
class CMnGon extends CMSprite {
	/**
	 * Creates a CMnGon instance
	 * As this is a game sprite without any special extra definition,
	 * this can be added to the game with game.addSprite(), or game.add()
	 * @param {CMGame} game - The current CMGame instance
	 * @param {number} n - The number of sides for this n-gon
	 * @param {object} [options={}] - A plain JS object of options
	 * @param {number} [options.x] - The screen x for this shape's center. Defaults to game's center x.
	 * @param {number} [options.y] - The screen y for this shape's center. Defaults to game's center y.
	 * @param {number} [options.radius] - The radius from center to each corner vertex. Defaults
	 *   to game's graphScalar (i.e., so vertices lie on unit circle).
	 * @param {number} [options.rotation] - Number in radians to rotate by (clockwise, from viewer's
	 *   perspective). Defaults to 0 (first point on positive x axis).
	 * @param {string} [options.fillStyle] - The color to fill this shape with. Defaults to CMColor.BLACK.
	 * @param {string} [options.strokeStyle] - The color to draw this outline with. Defaults to CMColor.NONE.
	 * @param {number} [options.lineWidth] How thick the outline should be. Defaults to 1.
	 */
	constructor(game, n=3, options={}) {

		let opts = {
			x: null,
			y: null,
			radius: null,
			rotation: 0,
			fillStyle: CMColor.BLACK,
			strokeStyle: CMColor.NONE,
			lineWidth: 1
		};

		for(let key in opts) {
			if(options[key] === 0)
				opts[key] = options[key];
			else
				opts[key] = options[key] || opts[key];
		}

		if(opts.x === null)
			opts.x = game.center.x;

		if(opts.y === null)
			opts.y = game.center.y;

		if(opts.radius === null)
			opts.radius = game.graphScalar;

		super(game, opts.x, opts.y, opts.radius, "circle", function(ctx) {
			ctx.lineWidth = this.lineWidth;

			if(this.fillStyle !== CMColor.NONE) {
				ctx.fillStyle = this.fillStyle;
				ctx.fill(this.path);
			}

			if(this.strokeStyle !== CMColor.NONE) {
				ctx.strokeStyle = this.strokeStyle;
				ctx.stroke(this.path);
			}
		});

		this.fillStyle = opts.fillStyle;
		this.strokeStyle = opts.strokeStyle;
		this.lineWidth = opts.lineWidth;

		this.n = n;
		this.rotation = opts.rotation;
		this.points = [];
		this.rebuildPath();

		this.previousState = [this.n, this.x, this.y, this.radius, this.rotation].join(";");
	}

	/**
	 * Sets up the drawing path, based on shape's
	 * center, radius, rotation, and number of corners
	 */
	rebuildPath() {
		this.path = new Path2D();
		this.points = [];

		let arc = Math.TAU / this.n;

		let nextX = this.x + this.radius * Math.cos( this.rotation );
		let nextY = this.y + this.radius * Math.sin( this.rotation );

		this.path.moveTo(nextX, nextY);
		this.points.push(new CMPoint(nextX, nextY));

		for(let theta = this.rotation + arc; theta <= this.rotation + Math.TAU; theta += arc) {

			nextX = this.x + this.radius * Math.cos(theta);
			nextY = this.y + this.radius * Math.sin(theta);

			this.path.lineTo(nextX, nextY);

			if(theta < this.rotation + Math.TAU - arc) // don't double up
				this.points.push(new CMPoint(nextX, nextY));
		}

		this.path.closePath();
	}

	/**
	 * Updates this in a single frame. Mainly used for changing # of points, etc.
	 * @param {number} frameCount - The game's integer counter for frames
	 */
	update(frameCount) {
		super.update(frameCount);

		// A defining property has changed, so we need to recreate the path
		if([this.n, this.x, this.y, this.radius, this.rotation].join(";") !== this.previousState) {
			this.rebuildPath();
			this.previousState = [this.n, this.x, this.y, this.radius, this.rotation].join(";");
		}

		this.boundAsCircle();
		this.rebuildPath(); // In case this has been moved by bounding
	}

	/**
	 * Determines if a given point is in this
	 * object, or on its stroked line. Useful for player
	 * interaction via mouse clicks or touch points.
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

		return this.game.ctx.isPointInStroke(
			this.path, pointToCheck.x, pointToCheck.y) || this.game.ctx.isPointInPath(
			this.path, pointToCheck.x, pointToCheck.y);
	}
}

/**
 * A class for creating and managing arbitrary 2D polygons,
 * e.g., for vector-graphics retro games.
 */
class CMPolygon extends CMSprite {
	/**
	 * Creates a CMPolygon instance
	 * As this is a game sprite without any special extra definition,
	 * this can be added to the game with game.addSprite(), or game.add()
	 * @param {object} game - The current CMGame instance
	 * @param {array} points - An array of point-like objects (with x and y number values)
	 * @param {object} [options] - A plain JS object of options
	 * @param {string} [options.strokeStyle] - A color to draw point-connecting lines with
	 * @param {string} [options.fillStyle] - A color to fill the created shapes with
	 * @param {number} [options.lineWidth] - The pixel width of the point-connecting lines
	 * @param {boolean} [options.closed=true] - Whether the last point should connect back to the first
	 */
	constructor(game, points, options={}) {
		let x = points.reduce((accumulator, currentValue) => Math.min(accumulator, currentValue.x), game.width);
		let y = points.reduce((accumulator, currentValue) => Math.min(accumulator, currentValue.y), game.height);
		let right = points.reduce((accumulator, currentValue) => Math.max(accumulator, currentValue.x), 0);
		let bottom = points.reduce((accumulator, currentValue) => Math.max(accumulator, currentValue.y), 0);
		let width = right - x;
		let height = bottom - y;

		super(game, x, y, width, height, function(ctx) {
			ctx.lineWidth = this.lineWidth;

			if(this.fillStyle !== CMColor.NONE) {
				ctx.fillStyle = this.fillStyle;
				ctx.fill(this.path);
			}

			if(this.strokeStyle !== CMColor.NONE) {
				ctx.strokeStyle = this.strokeStyle;
				ctx.stroke(this.path);
			}
		});

		let self = this;

		this.x = this.left = x;
		this.y = this.top = y;

		this.oldX = this.newX = this.x;
		this.oldY = this.newY = this.y;

		this.right = right;
		this.bottom = bottom;
		this.width = width;
		this.height = height;

		if(typeof options.closed === "boolean") {
			this.closed = options.closed;
		}
		else {
			this.closed = true;
		}

		let opts = {
			fillStyle: CMColor.NONE,
			strokeStyle: CMColor.GREEN,
			lineWidth: 1
		};

		for(let opt in opts) {
			opts[opt] = options[opt] || opts[opt];
		}

		this.game = game;
		this.points = points;
		this.numPoints = points.length;

		//  Stores information about (x, y) values of points as offsets from center
		this.pointsRelativeToCenter = this.points.map(point => {
			return {
				x: point.x - self.center.x,
				y: point.y - self.center.y
			};
		});

		// Similar to pointsRelativeToCenter, but in polar form for convenience in rotating
		this.polarPointsRelativeToCenter = this.pointsRelativeToCenter.map(
			point => self.game.toPolar(point));

		let rotn = 0;
		Object.defineProperty(this, "rotation", {
			get() {
				return rotn;
			},

			set(newValue) {
				let diff = newValue - rotn;

				rotn = CMGame.mod(newValue, 0, Math.TAU);

				// Take the current polar points, and add the different of the new rotation with the current
				this.polarPointsRelativeToCenter = this.polarPointsRelativeToCenter.map(
					point => {
						return {
							r: point.r,
							theta: CMGame.mod(point.theta + diff, 0, Math.TAU)
						};
					}
				);

				this.pointsRelativeToCenter = this.polarPointsRelativeToCenter.map(
					point => self.game.fromPolar(point));

				this.points = this.pointsRelativeToCenter.map(point => {

					return {
						x: self.center.x + point.x,
						y: self.center.y + point.y
					};
				});

				this.rebuildPath();
			}
		});

		this.fillStyle = opts.fillStyle;
		this.strokeStyle = opts.strokeStyle;
		this.lineWidth = opts.lineWidth;

		this.shape = "polygon";
		this.path = new Path2D();
		this.rebuildPath();
	}

	/**
	 * Update in a single animation frame
	 * @param {number} frameCount - The current animation frame index
	 */
	update(frameCount) {
		super.update(frameCount);

		if(this.velocity.x !== 0 || this.velocity.y !== 0) {

			for(let i = 0, len = this.points.length; i < len; i++) {
				this.points[i].x += this.velocity.x;
				this.points[i].y += this.velocity.y;
			}

			this.left = this.points.reduce((accumulator, currentValue) => Math.min(accumulator, currentValue.x), game.width);
			this.top = this.points.reduce((accumulator, currentValue) => Math.min(accumulator, currentValue.y), game.height);
			this.right = this.points.reduce((accumulator, currentValue) => Math.max(accumulator, currentValue.x), 0);
			this.bottom = this.points.reduce((accumulator, currentValue) => Math.max(accumulator, currentValue.y), 0);
			this.rebuildPath(); // Redefine points before bounding
		}

		this.boundAsPolygon();
		this.rebuildPath(); // In case this has been moved by bounding
	}

	/**
	 * Sets up the drawing path, based on shape's
	 * center, radius, rotation, and number of corners
	 */
	rebuildPath() {
		this.path = new Path2D();
		this.path.moveTo(
				this.points[0].x,
				this.points[0].y
			);

		for(let i = 1, len = this.points.length; i < len; i++) {
			this.path.lineTo(
				this.points[i].x,
				this.points[i].y
			);
		}

		if(this.closed)
			this.path.closePath();
	}

	/**
	 * Determines if a given point is in this polygon's fill path. Note:
	 * this may not be verty reliable on complex shapes.
	 * @param {number|object} xOrPoint - The x value, or point object
	 * @param {number} [y] - The y value (if xOrPoint is not a point)
	 * @returns {boolean}
	 */
	containsPoint(xOrPoint, y) {
		let pointToCheck = {};
		if(typeof xOrPoint === "number") {
			pointToCheck = {
				x: xOrPoint,
				y: y
			};
		}
		else {
			pointToCheck = xOrPoint;
		}

		this.game.ctx.lineWidth = this.lineWidth;
		if(this.closed) {
			return (this.game.ctx.isPointInPath(this.path, pointToCheck.x, pointToCheck.y) ||
				this.game.ctx.isPointInStroke(this.path, pointToCheck.x, pointToCheck.y));
		}
		else {
			return (this.game.ctx.isPointInStroke(this.path, pointToCheck.x, pointToCheck.y));
		}
	}
}

// Override the "center" to return the "centroid" - the mean of all point x and y values
Object.defineProperty(CMPolygon.prototype, "center", {
	get() {
		if(!this.points.length) {
			// no points - center is undefined
			return;
		}

		return CMGame.midpoint(...this.points);
	}
});

Object.defineProperty(window, "cmboilerplate", {
	set() {
		console.log(
`You cannot define cmboilerplate yourself. It is used internally to provide starting HTML code. If you are trying to get the cmboilerplate code, just type

	cmboilerplate
		
and press Enter`);
	},
	get() {
		let boilerplate =
`<!doctype html>
<html lang="en-US">
<head>
  <meta charset="utf-8" />
  <meta name='viewport' content='width=device-width, initial-scale=1.0,
    maximum-scale=1.0, user-scalable=0, minimal-ui' />
  <title>
    <!-- Replace this line with your title -->
  </title>
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <link type="text/css" rel="stylesheet" href="css/cmgame.css" />
</head>
<body class="cm-dark_gray">
<div id="cmLoading" class="cm-almost_black">
  <h1 class="cm-text-white">Loading...</h1>
  <progress id="cmLoadingProgress" title="Loaded resources"
     value="0" max="0" class="cm-small-shadow-almost_white">
  </progress>
    <p>
      <span class="cm-text-white">Powered by CMGame Engine</span>
      <br/>
      <a href="https://github.com/tlong314/cmgame" class="cm-text-white">
	    github.com/tlong314/cmgame
	  </a>
    </p>
  </div>

  <article id="cmTitle" class="cm-white">
    <h1>
      <!-- Replace this line with your game's title -->
    </h1>
    <p>
      <!-- Replace this line with a description of your game. -->
    </p>
    <p class="cm-center-text">
      <label for="playBtn">
        <button id="playBtn" title="Click to play" class="cm-play-button">
          <div class="cm-play"></div>
        </button>
        <br/>
        Play now
      </label>
    </p>
  </article>
  <div id="cmWrapper" class="cm-none">
    <canvas id="cmCanvas" width="360" height="480" class="cm-sky_blue">
      Nothing to see here...
    </canvas>
  </div>
<script src="js/cmgame.js"></script>
<script>

// Your own JavaScript code will go here

</script>
</body>
</html>`;

		document.write(`OK. Copy all of the text in the box below. Then paste it into a text file
			and save it with the extension .html (for instance, name it <strong>myfile.html</strong> ).
			Then double-click on that file (myfile.html) in that folder to open the page in your browser.
			<textarea style='width: 100%; height: 100%'>${boilerplate}</textarea>`);
	}
});