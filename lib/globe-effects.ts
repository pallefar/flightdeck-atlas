// Atlas display effects inspired by the visual control surface of God's Eye View.
// These recolour rendered imagery; they do not measure heat, identify objects or reveal hidden data.
export const sensorShader = `
uniform sampler2D colorTexture;
in vec2 v_textureCoordinates;
uniform float mode; uniform float gain; uniform float pixelation;
uniform float scanlines; uniform float grain; uniform float contrast;
uniform float saturation; uniform float vignette; uniform float distortion;
uniform float instability; uniform float sensitivity; uniform float palette;
uniform float snowDensity; uniform float wind; uniform float clockTime;
uniform float sharpen;
float noise(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);}
void main(){
 vec2 uv=v_textureCoordinates; vec2 centre=uv-.5;
 if(mode==1.0){uv+=centre*dot(centre,centre)*distortion*.18;uv.x+=sin(uv.y*80.0+clockTime)*instability*.002;}
 vec2 size=czm_viewport.zw;vec2 px=max(vec2(1.0),vec2(pixelation));
 vec2 sampleUV=(floor(uv*size/px)+.5)*px/size;
 vec3 c=texture(colorTexture,sampleUV).rgb;
 vec2 stepUV=1.0/size;
 vec3 neighbour=(texture(colorTexture,uv+vec2(stepUV.x,0)).rgb+texture(colorTexture,uv-vec2(stepUV.x,0)).rgb+texture(colorTexture,uv+vec2(0,stepUV.y)).rgb+texture(colorTexture,uv-vec2(0,stepUV.y)).rgb)*.25;
 c=clamp(c+(c-neighbour)*sharpen*3.0,0.0,1.0);
 float l=dot(c,vec3(.299,.587,.114));
 c=mix(vec3(l),c,saturation)*gain;c=(c-.5)*contrast+.5;
 if(mode==1.0){c*=1.0-scanlines*.22*(.5+.5*sin(uv.y*size.y*1.6));c+=grain*(noise(uv+fract(clockTime))-.5)*.15;}
 if(mode==2.0){float n=pow(clamp(l*gain,0.0,1.0),.65);c=vec3(.16,.95,.34)*n;c*=1.0-scanlines*.3*(.5+.5*sin(uv.y*size.y));c+=grain*(noise(uv+fract(clockTime))-.5)*.2;}
 if(mode==3.0){float v=clamp(l*(.5+sensitivity*2.0),0.0,1.0);c=palette==1.0?vec3(v):palette==2.0?vec3(1.0-v):clamp(vec3(1.7*v,2.5*v-.65,3.5*v-2.2),0.0,1.0)+vec3(.04,.02,.12)*(1.0-v);}
 if(mode==4.0){c=floor(c*6.0)/6.0;float edge=length(texture(colorTexture,uv+stepUV*2.0).rgb-texture(colorTexture,uv-stepUV*2.0).rgb);c*=1.0-clamp(edge*3.0,0.0,.8);}
 if(mode==5.0){c=vec3(l);c=(c-.5)*contrast+.5;c+=(noise(uv+fract(clockTime))-.5)*grain*.22;}
 if(mode==6.0){vec2 flake=uv*vec2(110.,65.)+vec2(clockTime*wind*4.0,clockTime*3.0);float n=noise(floor(flake));float snow=step(1.0-snowDensity*.075,n)*(1.0-smoothstep(.04,.22,length(fract(flake)-.5)));c=mix(c,vec3(1.),snow*.8);}
 c*=1.0-vignette*smoothstep(.15,.75,length(centre));
 if(any(lessThan(uv,vec2(0.)))||any(greaterThan(uv,vec2(1.))))c=vec3(0.);
 out_FragColor=vec4(clamp(c,0.0,1.0),1.0);
}`;
export const looks = [
  "normal",
  "crt",
  "nvg",
  "thermal",
  "anime",
  "noir",
  "snow",
] as const;
export const sourceCatalog = [
  {
    name: "Projects",
    source: "Atlas",
    state: "Available",
    detail: "Saved projects visible to your account.",
  },
  {
    name: "Earthquakes",
    source: "USGS",
    state: "Available",
    detail: "Reported events from the last 24 hours; event timestamps shown.",
  },
  {
    name: "Photorealistic 3D / Bing imagery",
    source: "Google Maps / Cesium ion",
    state: "Provider setup",
    detail:
      "Restricted map credentials, provider plan and deployment configuration required.",
  },
  {
    name: "Flights / cockpit / military flights",
    source: "OpenSky / adsb.lol",
    state: "Not connected",
    detail:
      "Needs an approved flight-data adapter and usage terms. Cockpit follows a reported flight.",
  },
  {
    name: "Satellites",
    source: "CelesTrak",
    state: "Not connected",
    detail:
      "Dated orbit elements and SGP4 propagation required; positions are calculated.",
  },
  {
    name: "Vessels",
    source: "AISStream",
    state: "Not connected",
    detail: "Needs a server connection and AISStream key.",
  },
  {
    name: "Traffic",
    source: "OSM / TomTom",
    state: "Not connected",
    detail:
      "Road simulations are distinct from observed aggregate flow. Provider adapter required.",
  },
  {
    name: "Transit / bikeshare",
    source: "GTFS-Realtime / GBFS",
    state: "Not connected",
    detail: "Regional feed registration and refresh adapters required.",
  },
  {
    name: "Public cameras / mapped ALPR cameras",
    source: "Municipal feeds / OSM",
    state: "Not connected",
    detail:
      "Published locations and approved public feeds only. No plate recognition or person tracking.",
  },
  {
    name: "Active fires",
    source: "NASA FIRMS",
    state: "Not connected",
    detail: "Satellite detections require a FIRMS key and server adapter.",
  },
  {
    name: "Space missions",
    source: "Launch Library 2",
    state: "Not connected",
    detail:
      "Launch schedules and reconstructed trajectories require a source adapter.",
  },
  {
    name: "Directions / route flythrough",
    source: "OSRM",
    state: "Not connected",
    detail:
      "Route service integration required. Project tours are available now.",
  },
  {
    name: "Radio",
    source: "Radio Browser / broadcasters",
    state: "Not connected",
    detail: "Provider terms and stream playback integration required.",
  },
  {
    name: "Data centres / dams / mapped installations",
    source: "OSM-derived datasets",
    state: "Not connected",
    detail:
      "Versioned datasets, attribution and data-use review required. Not live activity.",
  },
  {
    name: "Submarine cables / historical event layers",
    source: "Third-party datasets",
    state: "Separate permission",
    detail:
      "Reference datasets include noncommercial restrictions and are not bundled in this TE workspace.",
  },
  {
    name: "Voice / AI scene review",
    source: "FlightDeck AI",
    state: "Awaiting SDK",
    detail:
      "Will use your selected FlightDeck AI service; no microphone or provider connection is active.",
  },
];
