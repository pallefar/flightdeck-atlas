import {cp,mkdir} from "node:fs/promises";
await mkdir("public/cesium",{recursive:true});
for(const item of ["Assets","Workers","ThirdParty","Widgets","Cesium.js"])await cp(`node_modules/cesium/Build/Cesium/${item}`,`public/cesium/${item}`,{recursive:true});
