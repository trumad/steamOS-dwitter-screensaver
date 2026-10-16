// Your own dweets. The "CUSTOM" preset in config.js selects them.
// Same fields as the database, except that "code" is plain JavaScript (not percent-encoded).
// "id" can be any unique text. "username" is the credit shown on screen ("by <username>"; leave it empty to show
// none, see ATTRIBUTION_POSITION in config.js) and is also used by the other presets. "awesome_count" likewise.
// Copy the code of a dweet from dwitter.net as it is. If it is somebody else's, put their name in "username".
// The installer never overwrites this file once it exists, so your own dweets are safe when you update.
const CUSTOM_DWEETS = [
    {
        // An example written for this project: rings that drift and change colour.
        id: "example-rings",
        username: "Dwitter Screensaver",
        awesome_count: 0,
        code: "c.width=1920;x.lineWidth=3;for(i=30;i--;x.stroke())x.beginPath(x.strokeStyle=`hsl(${i*12+t*50},85%,60%)`),x.arc(960+S(t+i/4)*150,540+C(t*1.2+i/6)*90,40+i*14+S(t*2+i)*10,0,7)",
    },
];
