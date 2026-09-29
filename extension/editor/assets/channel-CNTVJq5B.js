import { an as Utils, ao as Color } from "./mermaid.core-DJNwReCu.js";
const channel = (color, channel2) => {
  return Utils.lang.round(Color.parse(color)[channel2]);
};
export {
  channel as c
};
