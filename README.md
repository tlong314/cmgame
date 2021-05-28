# CMGame Engine

A user-friendly web-based math game engine. The target audience for this game engine is math enthusiasts with little to no web programming experience, who want to easily build math-based games, web apps, displays, etc.

This engine was initially built for the site https://collegemathgames.com, but is available free for use, under the MIT License.

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

After downloading this library from github, add a reference to the CMGame CSS file (in your HTML page's head) and the CMGame JS file (preferably at the end of your HTML's body block).

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

For best performance, you can add your `<canvas>` element to the HTML body, and a wrapper `<div>` element containing it. Give `<canvas>` the id "cmCanvas" and the `<div>` the id "cmWrapper". If you do not do this, the game will dynamically create those elements for you.

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

```javascript
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

```javascript

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

// pausing...
game.pauseSound(soundPath);
game.pauseSound( audios.sound1 );

// stopping...
game.stopSound(soundPath);
game.stopSound( audios.sound1 );

// Note: there ar similar "Music" methods (playMusic, pauseMusic, stopMusic), and the only real difference is that whether these play will be dependent on your game's settings for keeping sound effects on/off, and keeping music on/off

```

onload - A function to call when the game's constructor has completed setup. Thus this only occurs as a constructor option, and is never used again in game's lifecycle.

hideOnStart - An array of HTML elements (or CSS selectors defining each) to be hidden from the screen when the game starts (e.g., when user presses Start button)

tickDistance - How many pixels apart x-axis (and y-axis) tick marks are from each other. Default is 20.

graphScalar - How much real numbers are scaled into the number of pixels on screen. For instance, if this is 30, then there will be 30 pixels between the point (0, 0) and the point (1, 0). Note: if your graphScalar and tickDistance do not match, this may be confusing to the user. Try to keep one a multiple of the other.

soundOn - A boolean: true to allow sound effects to play, false to mute them. Defaults to false.

musicOn - A boolean: true to allow music (generally longer sound files) to play, false to mute them. Defaults to false.

saveName - A string to use as the localStorage key for saving this game's state details. Essentially your "save file name". If not provided, one will be generated. (If you do not invoke save() or load() methods this value is never used)

frameCap - During each animation cycle, the game stores an internal `frameCount` variable tracking how many animation frames have passed. The dev may find this useful for certain cases like animations. If the game is long, you may want to prevent this value from becoming unbounded, by setting this `frameCap` to some positive integer, because the default is Infinity.

originByRatio - An array allowing you to define the Cartesian "origin" on screen based on game dimensions. This array has 2 elements: the first is a scalar to multiply by the canvas width to get the origin's x position on screen. The second element does the same with y using the game's height. Defaults to \[0.5, 0.5\] (i.e., the center point on the screen, or \[half the width, half the height\].

origin - An array, similar to originByRatio, but takes in actual x and y position, rather than scalars. Defaults to game's center point.

wrapper - An HTML element (or CSS selector for that element) to be used as the canvas "host" or "wrapper" element, used for CSS scaling. If this option is not present, the game looks for an element with id "cmWrapper". If none is found, the game creates and adds a new div to take the role. Default is null.

canvas - An HTML element (or CSS selector for that element) to be used as the visible output canvas element for all game drawing. If this option is not present, the game looks for an element with id "cmCanvas". If none is found, the game creates and adds a new div to take the role. Default is null.

backgroundCanvas - An HTML element (or CSS selector for that element) to be used as the output canvas element for the game's background. If this option is not present, we assume there is no background canvas. Default is null.

pressElement: An HTML element (or CSS selector for that element) defining the element to be used for mouse/touch events. Defaults to the game's canvas (as expected). This option should only be used if you need touch/mouse events handled outside the actual game.

orientation - A string, desired orientation when entering fullscreen. Only makes sense when fullscreen features are being used. Examples: "portrait", "landscape"

tickStyle - A color string for the Cartesian grid tick marks on the axes. Defaults to CMGame.Color.DARK_GRAY.

xAxisStyle - A color string for the line defining the x-axis. Defaults to CMGame.Color.GRAY.

yAxisStyle - A color string for the line defining the y-axis. Defaults to CMGame.Color.GRAY.

gridStyle - A color string for the Cartesian grid graph lines. Defaults to CMGame.Color.LIGHT_GRAY.

ignoreNumLock - A boolean, for keyboard-based games. true if you want numpad arrows to always register as direction (even when NumLock is on); false if you want NumLock to force those keys to register as numbers. Default is false.

multiTouch - A boolean; true if you want every touch to register a new event even if touches are simultaneous. false to allow one touch/mouse press event at a time. Default is false, as this allows desktop and mobile experiences to be similar.

doodleOptions - A plain JS object defining whether the user can draw in the current game.

doodleOptions.enabled - Whether or not user can current "doodle" on the game screen. Defaults to false.

doodleOptions.lineWidth - Number of pixels wide these drawing lines should be.

doodleOptions.strokeStyle - Color string used to draw the new doodle. Default is CMGame.Color.BLACK.

doodleOptions.fillStyleAbove - Color to (try and) fill above the drawn line. May be buggy. Defaults to CMGame.Color.TRANSPARENT.

doodleOptions.fillStyleBelow - Color to (try and) fill below the drawn line. May be buggy. Defaults to CMGame.Color.TRANSPARENT.

doodleOptions.fillStyleLeft - Color to (try and) fill to the left of the drawn line. May be buggy. Defaults to CMGame.Color.TRANSPARENT.

doodleOptions.fillStyleRight - Color to (try and) fill to the right of the drawn line. May be buggy. Defaults to CMGame.Color.TRANSPARENT.

```javascript

// Creates a new game that lets user draw with finger or mouse (while pressing mouse button down)
var game = new CMGame({
  doodleOptions: {
    enabled: true,
    strokeStyle: "green",
    lineWidth: 5
  }
});

game.start(); // Game is started, now try drawing!

```

Numerous callbacks can be applied to the game, as discussed below. You can define these in the constructor, or (perhaps for cleaner code) define them after initialization, but before calling start().

## Callbacks

Multiple callbacks can be added to the game. Two of the most useful are `onupdate` and `ondraw`. While the engine handles the "update and draw" cycle internally, you can add logic on top of what happens in these instances. `onupdate` occurs immediately after game's update() method, and `ondraw` is called immediately after the game's `draw` method.

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

### Player-triggered Events

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

```
x: The end point's x value
y: The end point's y value
oldX: The start point's x value
oldY: The start point's y value
offset: {
  x: End point's x minus start's x
  y: End point's y minus start's y
}
```

This can be used for example, to let the player guide their hero or object around the screen without having to tap directly on it:

```javascript

game.onpressmove = (point) {
  hero.x += point.offset.x;
  hero.y += point.offset.y;
};

```

Or to let the user drag the entire graph around to look at a specific area. Note this code will become buggy if performed while zoom is not 100%.

```javascript

game.onpressmove = (point) {
  game.origin.x += point.offset.x;
  game.origin.y += point.offset.y;
};

```

`onswipe` - Handles a swipe action either from a finger swipe, or from moving mouse while it is pressed. This handler takes a single argument, an instance of the CMSwipe class, from which you can access this information:

newX - The end point's x value

newY - The end point's y value

oldX- The start point's x value

oldY - The start point's y value

direction - A string indicating one of 4 general directions the swipe moved: "up", "down", "left" or "right"

direction8 - A string indicating one of 8 general directions the swipe moved: "right", "downright", "down", "downleft", "left", "upleft", "up", "upright"

```javascript

game.onswipe = (swipe) => {
  if(swipe.direction === "left") {
    alert("How dare you swipe left on me!");
  }
}

```

If you require more control, you can also use the callbacks below. Each of these methods takes a single input- the event that triggered it.

- ontouchstart
- ontouchmove
- ontouchend
- onmousedown
- onmousemove
- onmouseup
- onclick
- ondblclick
- onrightclick

## Adding Functions

For a "graph" type game, you can add functions to the Cartesian grid screen using the static `CMGame.Function` class. The most basic function takes 2 arguments: the game that will use the function, and a function defining the well... function.

```javascript
var func = new CMGame.Function(
  game,
  function(x) {
    return Math.sin(x) + 1;
  }
);

game.addFunction(func);


// Later, if you want to get rid of that function
game.removeFunction(func);
```

You can add multiple functions to the same game screen.

Functions also take in an optional third parameter, defining options for the function, described below.

### CMGame.Function Options

type - A lowercase string defining the type of function. Can be "cartesian", "polar", "parametric", "xofy". Default is "cartesian".
A "cartesian" function is as expected - inputs are represented on the x-axis, and outputs in vertical direction. "xofy" is the opposite. "polar" uses radians and distance from origin to describe points (generally "r" as a function of "theta"). And "parametric" defines both x and y from 0 up to some defined endpoint as functions of a third parameter (usually, t). These are defined in the same general way, except a parametric function must return an object with x and y values, instead of a single number.

```javascript
var cartesianFunc = new CMGame.Function(
  game,
  function(x) {
    return Math.sin(x) + 1;
  }
);

var xOfYFunc = new CMGame.Function(
  game,
  function(y) {
    return Math.sin(y) + 1; // Defined in same way, but now will move up vertically
  },
  {
    type: "xofy"
  }
);

var xOfYFunc = new CMGame.Function(
  game,
  function(theta) {
    return Math.sin(theta) + 1;
  },
  {
    type: "polar"
  }
);

var xOfYFunc = new CMGame.Function(
  game,
  function(t) {
    return {
      x: Math.sin(t) + 1,
      y: Math.cos(t)
    };
  },
  {
    type: "parametric"
  }
);

```

strokeStyle - The color (string) to draw the curve with. Default is black.

lineWidth - How many pixels wide the curve lines should be. Default is 1.

fillStyleBelow - A color string to fill in below the curve (defined differently based on graph's type). Default is transparent.

fillStyleAbove - A color string to fill in above the curve (defined differently based on graph's type). Default is transparent.

static - A boolean that should only be set to true if you know the graph will not change while it is drawn. This is an optimization and lets game save the drawing internally to resuse. Default is false.

onupdate - A callback called after this functions update() method. Defaults to an empty function.

ondraw - A callback called after this functions draw() method, taking in the game's drawing context as the only parameter. Defaults to an empty function.

start - Real values used to define a starting point for this graph, rather than displaying entire graph on screen. Some values are ignored based on function type. Values are: x, y, r, theta, t

end - Real values used to define a ending point for this graph, rather than displaying entire graph on screen. Some values are ignored based on function type. Values are: x, y, r, theta, t

velocity - A plain JS object defining how animations will move in this graph

velocity.animationTime - A number that can used by the dev for timing various actions

velocity.start - A plain JS object defining the velocity at which to move each variable within this function's `start` object (see `start` parameter above)

velocity.end - A plain JS object defining the velocity at which to move each variable within this function's `end` object (see `end` parameter above)

## Building a Venn Diagram

If you define your game's "type" to be "venn" then the game will build a Venn Diagram. Initiate your game as usual, but set type to "venn". Then define the number of sets that will be in your diagram with `game.setNumberOfSets`. This method also takes an optional second parameter defining which "variation" of a certain Venn Diagram to use. The variation is 0 (the "usual" diagram) by default, 1 for a "subsets" diagram, 2 for a different (non-subset) view.

```javascript

let game = new CMGame({
  type: "venn"
});

// Creates a normal 2-set Venn Diagram
game.setNumberOfSets(2);

// Creats a 2-set Venn Diagram with A as a subset of B
// game.setNumberOfSets(2, 2);

```

The sets (VennSet class) are stored as a Map named vennSets using usual naming conventions ("A", "B", "C" for the circle sets, and "U" for the universe). When a Venn Diagram is created, all regions (VennRegion class) are accounted for and stored as a Map named vennRegions. These are stored with the Roman numeral naming convention. Venn sets and regions each have a "containsPoint" method that can be used to detect if a player has clicked/tapped there.

```javascript

let game = new CMGame({
  type: "venn"
});

game.setNumberOfSets(2);

let region1 = game.vennRegions.get("I");
region1.filled = true;
region1.fillStyle = "blue";

let setA = game.vennSets.get("A");

game.onpressstart = (point) {
  if( setA.containsPoint(point) )
    alert("You touched my A!");
};

```

## Building a Graph Theory Graph

If your game's "type" is set to "graphtheory" you can define the indiviual vertices (i.e., nodes or dots) and edges (i.e., lines) with the classes CMVertex and CMEdge, respectively.

```javascript
let game = new CMGame({
  type: "graphtheory"
});

// Arguments: current game, x, y, radius, color, and an option object defining a label
let v1 = new CMVertex(game, 200, 100, 50, "rgb(255, 165, 0)", {
	text: "v1",
	x: 280,
	y: 100
});

let v2 = new CMVertex(game, 300, 100, 50, "rgb(255, 165, 0)", {
	text: "v1",
	x: 380,
	y: 100
});

// In general, edges connect two vertices
// Arguments: current game, first vertex, other vertex, line width, line color, label object (similar to CMVertex), directed
let e1 = new CMEdge(game, v1, v2, 20, "orange", {}, true);

// If CMEdge is "directed" it will point with an arrow from v1 to v2. Otherwise it will just connect them with a line.

game.addVertex( v1 );
game.addVertex( v2 );
game.addEdge( e1 );

// To remove later, you can use:
game.removeVertex( v1 );
game.removeVertex( v2 );
game.removeEdge( e1 );

```

## Sprites

One fundamental concept of game programming is sprites. These are in-game objects with some visual representation, which may be an image or shape, etc.

```javascript

// Create the sprite, and you can add to the game when ready
var boxes = new CMGame.Sprite(
  game,
  100,
  150,
  100,
  20,
  function(ctx) { // You can override sprite's draw function if preferred
    ctx.fillStyle = "brown";
    game.fillRect(this.x, this.y, this.width, this.height);
    game.fillRect(this.x + 80, this.y, this.width, this.height);
  }
);

game.addSprite( boxes );

// to remove this sprite later, you can use:
game.removeSprite( boxes );

```

The constructor takes these arguments, in order (after the first 5, all other arguments are optional):

game - The current game

x - The sprite's starting x value. If a rectangle (the default shape) this is its top left corner's x value. If a circle it is the circle's center's x value.

y - The sprite's starting y value. If a rectangle (the default shape) this is its top left corner's y value. If a circle it is the circle's center's y value.

widthOrRadius - A number used as the rectangle's width, as the radius if it is a circle, or as the line width if it is a line (see heightOrCircle below)

heightOrCircle - A number representing the sprite's height if it is a rectangle; or the string "circle" or "line" describing what shape this actually is

drawRule - An argument describing how this sprite's drawing is handled. If drawRule is an `<img>` element then that image will be drawn at this sprite's rectangular coordinates. If it is a color string, then this sprite's inferred shape will be drawn in that color. If it is a function, then that function will replace the sprite's default draw operations (note: the function should take one parameter, the game's drawing context).

boundingRule - A string description of how to handle this sprite's collision with the 4 sides of the canvas. Options for this string are:

- "none" - do nothing
- "bounce" - bounces off the walls (think Breakout, or the top/bottom sides of Pong)
- "wraparound" - moves sprite to the opposite side of the screen (think Asteroids)
- "clip" - Pushes object back just enough to keep it entirely within the game canvas
- "destroy" - Removes the sprite from the game

If you need different results based on which side is being hit, you can send an array in instead of a single string. The array should have 4 strings (each being one of the options above), written in clockwise order from the top. For example, this is how you might handle the ball in a Pong clone:

```javascript

var ball = new CMGame.Sprite(
  game,
  200,
  100,
  20,
  "circle",
  "yellow",
  ["bounce", "none", "bounce", "none"] // will bounce of top and bottom, but keep going on the left/right sides - handle those situations in game.onupdate
);

game.onupdate = function() {
  if(ball.x > game.width) {
    console.log("Point for computer!");

    // Now reset the ball, or start next round, or end game, etc.
  }
  else
  if(ball.x < 0) {
    console.log("Point for player!");

    // Now reset the ball, or start next round, or end game, etc.
  }
};

```

layer - The "drawing layer" on which to draw the sprite. If you have very specific requirements about which sprites should be drawn first, you can define this to any number for your sprites. They will be drawn in the order you have set, with lower numbers drawn first.

omitFromSprites - A boolean. Mainly used internally for extending the sprite class. Lets us manage extended classes separately from when most game sprites are updated or drawn.

### Sprite methods

When making mobile-driven or desktop games, it can be useful to detect whether the user has clicked/tapped on a sprite. The sprite's "containsPoint" method can help detect this.

```javascript
sprite.containsPoint({ x: 200, y: 150 }); // Returns true if canvas point (200, 150) lies inside this sprite. Sprite should have a defined path, like a rectangle or circle.
sprite.containsPoint(200, 150); // Same as above
```

Once a sprite is created, you can set its constant movement (velocity). The velocity is a point with x, y, and z coordinates. z is generally set to 0, but it is available in case you want to use it.

```
sprite.velocity.x = 2; // Makes sprite move 2 pixels to the right per frame

sprite.velocity.y = -4; // Makes sprite move 4 pixels up the screen per frame (remember, pixel drawing values are reversed vertically, with y=0 being at the top)
```

A very useful tool that makes use of a few we have created is a sprite's setPath method. It can give you a lot of control over your sprite's movement. You can use it to set the sprite's velocity all at once, via a point object or an array. Or, for more interesting patterns, you can set it to a CMGame.Function instance (generally one that is animated).

```javascript
sprite.setPath({
  x: 2,
  y: 1,
  z: 0 // providing a z value is optional
});

sprite.setPath([2, 1, 0]); // Again, last coordinate is optional

var path = new CMGame.Function(
  game,
  function(theta) { return Math.sin(theta) },
  {
    type: "polar",
    strokeStyle: CMGame.Color.TRANSPARENT // Don't show path sprite is following
  }
});

sprite.setPath( path );
```

Occasionally we only need to access the sprite's center point (rather than the top/left (x, y) of a rectangle, say). You can access this with the .center property. Rather than a method, this is only determined when  necessary (when accessed).

```javascript
// Returns a point with an x value and y value representing the sprite's center point on the canvas
var centerPoint = sprite.center;
```

## CMGame Methods

Besides the callbacks described above, there are various methods built into the CMGame prototype, used for converting mathematical points or values, drawing canvas text with more control, reconciling real numbers with their on-screen representations, and managing basic gameplay.

Some basic gameplay methods for a created CMGame instance named 'game':

```javascript

game.start(); // start the game. Should only ever be called once. Use game.pause()/game.unpause() to pause/stop and restart gameplay.

game.pause(); // pause the game

game.unpause(); // unpause the game

// Check if two items are colliding
if( game.areColliding(sprite1, sprite2) ) {
  game.playSound( "audio/collision.wav" ); // play a sound file
}

// Check distance of 2 points (objects with x and y number coordinates defined)
game.distance( point1, point2 );

game.takeScreenshot(); // take a screenshot of current screen and download it

game.takeScreenVideo(3000); // take video of current screen for next 3 seconds and download it

// Zooms to 90% of normal view. Do not change origin while game is zoomed in/out. (Still a little buggy in such a case.)
game.zoom(0.9);

// Saves the current game details (an object you provide) to current browser.
// Object should be JSON-compliant; primitives (strings, numbers) are your safest options. Avoid null values and functions.
// If you provided a saveName option in game constructor, this is saved using that key. Otherwise a new one is generated.
game.save({
  score: 200,
  highScore: 1000,
  name: "Jenny"
});

// If you provide a save name directly as a first argument, that overrides the name you provided in the constructor.
// This is useful if you want the player to name their own files.
game.save("Jen314", {
  score: 200,
  highScore: 1000,
  name: "Tim"
});

// Calling with no arguments generates a new save name and stores game's this.state object. Can be retrieved with game.load() with no arguments.
game.save();

// Returns a game's saved state object from current browser
// If you provided a saveName option in game constructor, this looks for saved game state under that name.
// If none was provided, this looks for the last save fitting the internally created save name syntax.
// If nothing is found an empty object {} is returned.
game.load();

// If a game was saved under a specific name, you can retrieve it directly.
game.load("Jen314");

/**
 * Player can draw!
 */

// Let player start drawing on screen
game.startDoodle();

// No longer let player start drawing on screen
game.stopDoodle();

// Erase all doodles from screen
game.clearDoodles();

// static values and methods

CMGame.noop - Empty function (essentially a placeholder). Does nothing.

CMGame.PIXELS_FOR_SWIPE - This is set to how many pixels you think should be moved across before a "swipe" is registered. Currently set as 5. If you lower this it may cause performance issues due to constant processing.

CMGame.SAVE_PREFIX - A string used internally to generate unique save names. Never change this after a game has already been released/published.

CMGame.FPS - The frame rate for games made with CMGame. Defaults to roughly 60 FPS (frames per second), the standard browser drawing speed. If modified, will change your game's speed instantly, though it is better practice to control speed within the game (e.g., with sprite velocity values).

// Show a brief pop-up style message (called "toasts" in many games and apps) to the user without blocking UI thread.
// With a single arguments, this detects expected length based on the input's length, and fades out accordingly.
CMGame.showToast("Achievement completed!");

// For more control, you can use up to 3 more arguments:
// arguments: string message, number of milliseconds to wait before showing, number of milliseconds to show the message, function to perform after fade completes
CMGame.showToast("Achievement, completed!", 2000, 5000, function() { console.log("toast faded"); });

// If you wnat to show multiple messages without worrying about all the details, use showToasts with an array of strings, an an optional second parameter for delay in milliseconds before showing first message:
CMGame.showToasts(["Achievement Completed!", "Trophy Earned!", "All Trophies Collected"], 2000);

```

Some methods for working with arrays, objects, and Map instances:

```javascript

CMGame.pickFrom( arr ); // Randomly picks an element from the input (an array, Map instance, or object)
CMGame.pluckFrom( arr ); // Randomly picks an element from the input (an array, Map instance, or object) and REMOVES that item from the input
CMGame.shuffle( arr ); // Randomly shuffles the input, which is an array
CMGame.last( arr ); // Gets last element of the array (i.e., elemment index at array.length - 1)
CMGame.isPrimitiveSubArray

// Clears out input object, which can be an array, Map instance, or object, and returns the emptied item.
//Can also take multiple arguments: (CMGame.clearAll( myArr, myArr2, myObj, myMap);
CMGame.clearAll( arr );

```

Some math conversion helper functions:

```javascript

// Built into prototype:

game.fromPolar( 2, Math.PI / 2 ); // polar to Cartesian coordinates
game.toPolar( {x: 2, y: 3} ); // Cartesian to polar coordinates

game.fromBinary( "1001" ); // binary string to positive integer
game.toBinary( 15 ); // positive integer to binary string

game.toRadians( 90 ); // degrees to radians
game.toDegrees( Math.PI / 2 ); // radians to degrees

game.degreesToSlope( 45 ); // degrees to slope of line from origin to this degree point on unit circle
game.radiansToSlope( Math.PI / 4 ); // radians to slope of line from origin to this radian point on unit circle

game.slopeToDegrees( 1 ); // inverse function of game.degreesToSlope
game.slopeToRadians( 1 ); // inverse function of game.radiansToSlope

game.roundSmall( 0.00001 ); // convert tiny numbers to 0 (threshold is Number.EPSILON). Useful when dealing with polar coordinates, Math.PI, etc.

// Static math methods (not including static classes):
CMGame.factorial( 5 ); // Returns factorial of nonnegative integar n, so n!; i.e., that number times every positive integer less than it (and returns 1 for input of 0).
CMGame.P( 6, 4 ); // Takes permutation formula of the given inputs (in this example, "six permute four")
CMGame.C( 6, 4 ); // Takes combination formula of the given inputs (in this example, "six choose four")
CMGame.mean(2, 8, 4); // Takes the mean average of any list of numbers
CMGame.sum( (x) => 1/x, 1, Infinity); // Adds a list of number inputs, or if first coordinate is a function attempts to add the values like a sigma sum. If present, second coordinate represents the starting index, and third represents the ending index. If third parameter is infinite and partial sums become insignificantly different, assumes convegence and returns the latest partial sum rather than continuing the infinite loop.

// Static variables added to Math object for convenience:

Math.TAU // 2 * pi. Convenience for drawing arcs/ellipses and for polar calculations
Math.SQRT3 // Square root of 3. Convenience for unit circle, etc.
Math.SQRT5 // Square root of 5.
Math.PHI // Golden ratio. Convenience for drawing complex patterns.

```

Some other helpful functions for working with canvas coordinates:

```javascript

game.getSlope( point1, point2 ); // Gets slope between 2 points - if vertical may return Infinity or -Infinity
game.getFiniteSlope( point1, point2 ); // Similar to getSlope, but returns undefined for vertical lines
game.midpoint( point1, point2 ); // Returns the point lying halfway between these two (input can be canvas or real point)

game.xToScreen( 2.5 ); // converts real # to the pixel where it is represented horizontally on the current game grid
game.xToReal( 300 ); // converts x-coordinate from canvas to what real number it currently represents

game.yToScreen( 4.1 ); // converts real # to the pixel where it is represented vertically on the current game grid
game.yToReal( 200 ); // converts y-coordinate from canvas to what real number it currently represents

game.toScreen( {x: 2.5, y: 4.1 } ); // Converts real point to its current pixel representation point on the screen
game.toReal({x: 300, y: 200}); // Converts canvas point to what real point it currently represents

```

You can perform canvas drawing as usual in your sprites' drawRule argument, or the game's ondraw(ctx) method, using the usual canvas context methods. This engine provides some additional methods to make drawing a little easier:

```javascript

// These assume the current game's drawing context will be used, so no need to pass it in as an argument

// If you need to optimize, use ctx.lineTo methods and save stroke until path is complete. If not, here is a convenience method, similar to Java's drawLine.
game.drawLine( x1, y1, x2, y2 );

// Or you can pass in 2 point's or point-like objects (e.g., to draw a line from one circle's center to another's). These use context's current line width and strokeStyle.
game.drawLine( point1, point2 );

// rotating images can be confusing, and a lot of code. CMGame provides a drawRotatedImage method that takes in similar arguments to canvas context drawImage method, but with a final argument added as thenumber of radians to rotate by (counterclockwise) around the drawn image's center

game.drawRotatedImage(img, Math.PI / 4); // draws image rotated about it center by pi/4 radians
game.drawRotatedImage(img, 100, 200, Math.PI / 4); // draws image at point (100, 200), but rotated about the image center
game.drawRotatedImage(img, 100, 200, 80, 40, Math.PI / 4); // draws image as width 80 and height 40 at point (100, 200), but rotated about the drawn image's center
game.drawRotatedImage(img, 0, 0, 100, 50, 100, 200, 80, 40, Math.PI / 4); // draws image from source rectangle (0, 0, 100, 50) to destination (100, 200, 80, 40), but rotated about the drawn image's center

// Draw multiple strings together with varying fonts and colors.
// First argument is list of fonts to use. If list of text strings is longer, this will cycle back around when reaching last font.
// Second argument is list of text strings to write. First string is written in first font, second in second font, etc.
// Third argument: the x position to start writing the first string
// Fourth argument: the y position to write the strings
// Fifth argument: optional. A JS object of options:
//   fill (boolean - true to use fillText, false otherwise. default is true);
//   stroke (boolean - true to use strokeText, false otherwise. default is false);
//   fillStyles - An array of colors to use with fillText on corresponding text strings. Cycles around similar to font array.
//   strokeStyles - An array of colors to use with strokeText on corresponding text strings. Cycles around similar to font array.
// Note: this returns the x value where the list of strings ends on the canvas.
game.drawStrings( ["12px Arial", "italic 14px Times New Roman"], ["5", "x", " + 2 = ", "y"] , 200, 100, { fillStyles: ["pink", "blue"] });

// Similar to game.drawStrings, but only calculates the expected width of the strings if they are drawn in the given fonts
game.measureStrings(["12px Arial", "italic 14px Times New Roman"], ["5", "x", " + 2 = ", "y"]);

// Similar to game.drawStrings, but centers around the provided (x, y) point and allows two more options:
//   centerVertically - A boolean; if true, will try and center the text vertically around the point (x, y)
//   angle - An angle in radians to rotate the entire string around if desired
// As with drawStrings, this returns an x value for the end of the drawn strings (however, this assumes they were not rotated)
game.drawStringsCentered( ["12px Arial", "italic 14px Times New Roman"], ["5", "x", " + 2 = ", "y"] , 200, 100, { fillStyles: ["pink", "blue"] )

// Fills a circle of radius 20 around canvas point (200, 100)
game.fillOval(200, 100, 20);

// Fills an ellipse/oval that would be contained in the rectangle with top left point (200, 100), width 20, and height 40
game.fillOval(200, 100, 20, 40);

game.strokeOval is similar to game.fillOval (but only draws the outline)

// Draws a rectangle with top left corner (400, 200), width 80, height 60, with rounded corners of radius 8
game.fillRoundedRect(400, 200, 80, 60, 8);

game.strokeRoundedRect is similar to game.fillRoundedRect (but only draws the outline)

// Setting ctx font

ctx.font = game.font.MONO; // Gets monospace font (if available) of current font size
ctx.font = game.font.SANS_SERIF; // Gets sans-serif font of current font size
ctx.font = game.font.SERIF; // Gets serif font of current font size
ctx.font = game.font.VARIABLE; // Gets expected font for variables (italic, serif) of current font size

// Since canvas scaling is automated and may result in text becoming too small, you can get an appropriate font size relative to current scale
ctx.font = game.font.rel(12) + "px Arial"; // If current screen has canvas scaled to half its starting size, then this value becomes "24px Arial".

```

While drawing, you may want to refer to the predefined modern color palette, with CMGame.Color. This has many constant values represented by the color name in all caps. Color names are as expected, with multiple words being separated by an underscore (_).

```javascript

ctx.fillStyle = CMGame.Color.BLUE;

```

For constistency, it is best to use CMGame.Color.TRANSPARENT rather than "transparent", "rgba(0, 0, 0, 0)", etc. This way the game can reliably check for transparent values before wasting resources on drawing.

If you have HTML elements that you want to use the same color palette, you can add corresponding classes, all lowercase, replacing CMGame.Color with .cm- to use the color as a background, or .cm-text- to use the color as the font color.

```html

<div class="cm-dark_red">Welcome!</div>

<span class="cm-text-dark_red">Are you ready?</span>

<div class="cm-green cm-text-white">Let's go!</div>

```

## Random values

Random values are very useful in creating games. This engine provides a CMRandom class that can be used to access various random values when needed. Many of these, like CMRandom.value, create a random value on access, so do not require any function invocation.

```javascript

CMRandom.color; // Returns a random color from our pre-defined palette
CMRandom.grayscale; // Returns a random color for a black and white palette (black, white, various grays)
CMRandom.colorscale; // Returns a random color from pre-defined palette EXCEPT those in "grayscale" (black, white, various grays)

CMRandom.value; // Returns a random float, similar to Random.value in Unity
CMRandom.radian; // Returns a random float between 0 (inclusive) and 2 * pi (exclusive)
CMRandom.degree; // Returns a random integer between 0 (inclusive) and 360 (exclusive)
CMRandom.sign; // Randomly returns 1 or -1

// range can return a value within a range. If both arguments are integers, returns an integer less than the second argument; similar to Unity's Random.Range method.
CMRandom.range(-40, 80); // Returns a random integer between -40 (inclusive) and 80 (exclusive)
CMRandom.range(-40, 80.1); // Returns a random float between -40 (inclusive) and 80.1 (inclusive)

// nonzero is same method as range, but will never return 0
CMRandom.nonzero(-40, 80);

// With an instance of CMRandom, you can also use two Java-based methods to produce random integers or booleans
let random = new CMRandom();
random.nextInt(); // returns new integer, similar to Java's nextInt() method of the Random class
random.nextBoolean(); // returns new integer, similar to Java's nextBoolean() method of the Random class

```

## License

CMGame is available free for use under the MIT License.
