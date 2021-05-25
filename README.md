# CMGame Engine

A user-friendly web-based math game engine. The target audience for this game engine is math enthusiasts with little to no web programming experience, who want to easily build math-based games, web apps, displays, etc.

This engine was initially built for my site https://collegemathgames.com, but is available free for use, under the MIT License.

## What Does It Do?

Among other things, this engine handles:

- Automatically scaling canvas to current page size via CSS transforms, while maintaining aspect ratio
- Preloading, processing, and playing audio (even in iOS).
- Managing splash screen, including loading meter
- Automatic double-buffering with an offscreen canvas.
- Advanced canvas text drawing, such as drawing a sentence with multiple fonts.
- Standard engine features, such as managing FPS, sprite velocity and position, collision detection, and asset preloading
- Extra engine features for 2D games, such as determining sprite's response to reaching a screen boundary, or using a math function to define a sprite's path
- Randomized variables: integers, floats, colors
- Game screenshots (if backgrounds are not drawn to screen, background is "guessed")
- Game videos (e.g., for promotion)
- Overcoming various iOS/Android annoyances (playing audio, preventing double-click zoom, preventing haptic feedback on long press), managing contextmenu handling
- Providing a predefined modern color palette
- Allowing dynamic drawing from the user
- Condensing of touch and mouse events into one handler system (similar to Pointer events)

## Getting Started

Add a reference to the CMGame CSS file (in your HTML page's head) and the CMGame JS file (preferably at the end of your HTML's body block).

```html
<!doctype html>
<html>
<head>
<link rel="stylesheet" href="css/cmgame.css" />
</head>
<body>

<script src="js/cmgame.js"></script>
<script>

// ... your custom script code will go here

</script>
</body>
</html>
```

For best performance, you can add your `<canvas>` element to the HTML body, and a wrapper `<div>` element containing it. Give `<canvas>` the id CMCanvas and the div the id CMWrapper. If you do not do this, the game will dynamically create those elements for you.

In your custom script, you can initialize the game with one line of code:

```javascript
var game = new CMGame();
```

The game will start and show once you click the screen. Or if you want to initialize and start immediately:

```javascript
var game = new CMGame().start();
```

You can also pass in a plain JavaScript object of options, defined further below.

```javascript

var options = {
  fullscreen: true, // will attempt to jump into fullscreen at first user interaction
  graphScalar: 20, // graph values are scaled by this many pixels for display
  tickDistance: 40, // number of pixels between each tick mark on the graph
  gridStyle: "pink",
  tickStyle: "red"
};

var game = new CMGame(options);

```

## Options

As discussed above, we can pass in various options when creating our game. These are described below.

startBtn - An HTML element (or CSS selector for that element) that will be used to start the game. Defaults to null, and game starts on first user interaction.

fullscreen - {boolean} If true, the game will attempt to enter fullscreen browser mode on first user interaction (this does not necessarily change the canvas size itself; it only performs browser-specific actions like removing the address bar). Results vary by browser. Default is false.

enterFullscreenBtn - An HTML element (or CSS selector for that element) to be used to enter fullscreen when user clicks. Default is null.

exitFullscreenBtn: An HTML element (or CSS selector for that element) to be used to exit fullscreen when user clicks. Default is null.

screenshotBtn: An HTML element (or CSS selector for that element) to be used to capture an in-game screenshot when user clicks.

toggleSoundBtn: null

toggleMusicBtn: null

type - A string describing the type of math game. Available options are "graph" (standard 2D Cartesian graph system), "venn" (Venn Diagrams), "graphtheory" (A system of vertices and edges, as presented in Graph Theory), or "none" (no math-specific resources, in case you just want to use this to make a basic game or animation)

images - A plain JS object of images that may need preloading. Define these with the key being how you want to access the image later, and the value being the image's source path. E.g.,

```
var options = {
  images: {
    hero: "img/smiley.png",
    villain: "img/frowny.png"
  }
};

// access later:
game.images["hero"];
```

audios - A plain JS object of audio files that may need preloading. You can define these similar to images, but they will be accessed later, using game.playSound(soundPath)

```

var soundPath = "audio/jump.wav";
var options = {
  audios: {
    sound1: soundPath,
    sound2: "audio/buzz.wav" // can save the path as above, or define it directly
  }
};

// access later:
game.playSound(soundPath);

// or
game.playSound( audios.sound1 );

```

onload - A function to call when the game's constructor has completed setup. Thus this only occurs as a constructor option, and is never used again in game's lifecycle.

hideOnStart - An array of HTML elements (or CSS selectors defining each) to be hidden from the screen when the game starts (e.g., when user presses Start button)

tickDistance - How many pixels apart x-axis (and y-axis) tick marks are from each other. Default is 20.

graphScalar - How much real numbers are scaled into the number of pixels on screen. For instance, if this is 30, then there will be 30 pixels between the point (0, 0) and the point (1, 0).

soundOn - A boolean: true to allow sound effects to play, false to mute them. Defaults to false.

musicOn - A boolean: true to allow music (generally longer sound files) to play, false to mute them. Defaults to false.

frameCap - During each animation cycle, the game stores an internal `frameCount` variable tracking how many animation frames have passed. The dev may find this useful for certain cases like animations. If the game is long, you may want to prevent this value from becoming unbounded, by setting this `frameCap` to some positive integer, because the default is Infinity.

originByRatio - An array allowing you to define the Cartesian "origin" on screen based on game dimensions. This array has 2 elements: the first is a scalar to multiply by the canvas width to get the origin's x position on screen. The second element does the same with y using the game's height. Defaults to \[0.5, 0.5\] (i.e., the center point on the screen, or \[half the width, half the height\].

origin - An array, similar to originByRatio, but takes in actual x and y position, rather than scalars. Defaults to game's center point.

wrapper - An HTML element (or CSS selector for that element) to be used as the canvas "host" or "wrapper" element, used for CSS scaling. If this option is not present, the game looks for an element with id "cmWrapper". If none is found, the game creates and adds a new div to take the role. Default is null.

canvas - An HTML element (or CSS selector for that element) to be used as the visible output canvas element for all game drawing. If this option is not present, the game looks for an element with id "cmCanvas". If none is found, the game creates and adds a new div to take the role. Default is null.

backgroundCanvas - An HTML element (or CSS selector for that element) to be used as the output canvas element for the game's background. If this option is not present, we assume there is no background canvas. Default is null.

pressElement: An HTML element (or CSS selector for that element) defining the element to be used for mouse/touch events. Defaults to the game's canvas (as expected). This option should only be used if you need touch/mouse events handled outside the actual game.

orientation - A string, desired orientation when entering fullscreen. Only makes sense when fullscreen features are being used. Examples: "portrait", "landscape"

// colors
tickStyle - A color string for the Cartesian grid tick marks on the axes. Defaults to CMGame.Color.DARK_GRAY.
xAxisStyle - A color string for the line defining the x-axis. Defaults to CMGame.Color.GRAY.
yAxisStyle - A color string for the line defining the y-axis. Defaults to CMGame.Color.GRAY.
gridStyle - A color string for the Cartesian grid graph lines. Defaults to CMGame.Color.LIGHT_GRAY.

ignoreNumLock - A boolean, for keyboard-based games. true if you want numpad arrows to always register as direction (even when NumLock is on); false if you want NumLock to force those keys to register as numbers. Default is false.

multiTouch - A boolean; true if you want every touch to register a new event even if touches are simultaneous. false to allow one touch/mouse press event at a time. Default is false, as this allows desktop and mobile experiences to be similar.

doodleOptions - A plain JS object defining whether the user can draw in the current game.

  enabled - Whether or not user can current "doodle" on the game screen. Defaults to false.
	lineWidth - Number of pixels wide these drawing lines should be.
	strokeStyle - Color string used to draw the new doodle. Default is CMGame.Color.BLACK.
	fillStyleAbove - Color to (try and) fill above the drawn line. May be buggy. Defaults to CMGame.Color.TRANSPARENT.
	fillStyleBelow - Color to (try and) fill below the drawn line. May be buggy. Defaults to CMGame.Color.TRANSPARENT.
	fillStyleLeft - Color to (try and) fill to the left of the drawn line. May be buggy. Defaults to CMGame.Color.TRANSPARENT.
	fillStyleRight - Color to (try and) fill to the right of the drawn line. May be buggy. Defaults to CMGame.Color.TRANSPARENT.


Numerous callbacks can be applied to the game, as discussed below. You can define these in the constructor, or (perhaps for cleaner code) define them after initialization, but before calling start():

onbeforestart
onstart
onbeforeupdate
onupdate
onbeforedraw
ondraw
oncleardraw

ontouchstart
ontouchmove
ontouchend
onmousedown
onmousemup

onkeydown(e)
onkeyup(e)
onpressstart(point)
onpressmove(info)
onpressend(point)
onkeydown(e)
onkeyup(e)

## Callbacks

Multiple callbacks can be added to the game. Two of the most useful are `onupdate`, `ondraw`. While the engine handles the "update and draw" cycle internally, you can add logic on top of what happens in these instances. `onupdate` occurs immediately after game's update() method, and `ondraw` is called immediately after the game's `draw` method.

```javascript

game.onupdate = function(frameCount) {
  if(frameCount === 100) {
    console.log("Congratulations! You have reached one hundred frames!");
  }
};

game.ondraw = function(ctx) {
  ctx.fillStyle = "red";
  ctx.fillText("Counting: " + this.frameCount, 100, 50);
};

```

You can also use arrow functions, but remember that these do not have a `this` defined, so you must refer to the game itself. Thus it is safer to just refer to the game in general.

```javascript

game.ondraw = (ctx) => {
  ctx.fillStyle = "red";
  ctx.fillText("Counting: " + game.frameCount, 100, 50); // this.frameCount will throw an error
};

```

If you need these events to occur at a more precise time, you can use:

`onbeforeupdate(frameCount)` - Occurs just before game's update()
`onbeforedraw(ctx)` - Occurs just before game's draw()
`oncleardraw(ctx)` - Occurs after previous screen clear but before current draw()

For user interaction, you should use these callbacks:

`onkeydown` - Similar to a usual onkeydown handler, with the same Key Event parameter. However, preventDefault() has already been called, and the event parameter has the added property "direction" which is set to "left"/"down"/"right"/"up" if the key was an arrow key, a numpad key (and game has ignoreNumLock set to true) or the usual ASDW keys. If none of these, direction is set to "".

```javascript
game.onkeydown = (e) => {
  if(e.direction === "up")
    console.log("Jump or something");
};
```

`onkeyup` - Similar description as onkeydown (but for keyup event). Also includes the "direction" property.

`onpressstart` - A combined callback for touchstart and mousedown. Instead of the event, the only parameter is a plain JS object representing the pressed point on the canvas (or pressElement) rather than the window. If you wish to determine if more than one finger is pressing down (on screen or on the mouse buttons) you can use game.numPressPoints

`onpressend` - A combined callback for touchend and mouseend IF mouse is currently pressed. Instead of the event, the only parameter is a plain JS object representing the released point on the canvas (or pressElement) rather than the window.

`onpressmove` - A combined callback for touchmove and mousemove IF mouse is currently pressed. Instead of the event, the only parameter is a plain JS object representing the point on the canvas (or pressElement) rather than the window, with some extra information:

x: The end point's x value
y: The end point's y value
oldX: The start point's x value
oldY: The start point's y value
offset: {
  x: End point's x minus start's x
  y: End point's y minus start's y
}

`onswipe` - Handles a swipe action either from a finger swipe, or from moving mouse while it is pressed. This handler takes a single argument, an instance of the CMSwipe class, from which you can access this information:

  newX - The end point's x value
  newY - The end point's y value
  oldX- The start point's x value
  oldY - The start point's y value
  direction - A string indicating one of 4 general directions the swipe moved: "up", "down", "left" or "right"
  direction8 - A string indicating one of 8 general directions the swipe moved: "right", "downright", "down", "downleft", "left", "upleft", "up", "upright"


If you require more control, you can also use the callbacks below. Each of these methods takes a single input- the event that triggered it.

  ontouchstart
  ontouchmove
  ontouchend
  onmousedown
  onmousemove
  onmouseup
  onclick
  ondblclick
  onrightclick

## Adding Functions

For a "graph" type game, you can add functions to the Cartesian grid screen. The most basic function takes 2 arguments: the game that will use the function, and a function defining the well... function.

```javascript
var func = new CMGame.Function(
		game,
		function(x) {
			return Math.sin(x);
		}
	);

game.addFunction(func);
```


## License

CMGame is available free for use under the MIT License.
