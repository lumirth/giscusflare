import { unsafeSVG } from "lit-html/directives/unsafe-svg.js";
import { icons } from "../icons.js";
/** Trusted SVG remains owned by the template that displays it. */
export function icon(name: keyof typeof icons) { return unsafeSVG(icons[name]); }
