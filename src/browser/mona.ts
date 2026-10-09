/** GitHub Mona's seven pixel-art poses, composed from hand-authored geometry.
 * The head, face, eyes and whiskers are shared; each outline describes a body
 * pose rather than a collection of traced pixels. Animation belongs to CSS.
 */
const head = 'M8 2H10V3H11V4H12V5H13V4H14V3H15V2H17V3H18V5H19V6H20V9H21V14H19V15H6V14H5V8H6V5H7V3H8Z';
const face = 'M8 7H15V8H17V10H18V14H16V15H8V14H6V10H7V8H8Z';
const eyes = 'M8 9h1v2H8zM14 9h1v2h-1z';
const mouth = 'M10 11h3v1h-3z';
const smile = 'M11 12h2v1h-2z';
const whiskers = [
  'M3 11h2v1H3zM21 11h1v1h-1zM4 13h1v1h-1zM3 14h1v1h-1zM21 14h1v1h-1z',
  'M4 11h1v1h-1zM3 12h1v1h-1zM21 12h1v1h-1zM4 14h1v1h-1zM20 14h1v1h-1zM3 15h1v1h-1zM21 15h1v1h-1z',
  'M3 10h1v1h-1zM21 10h1v1h-1zM4 11h1v1h-1zM3 13h2v1H3zM21 13h1v1h-1z',
];
const poses = [
  { body: 'M9 15H17V16H18V17H19V19H20V23H19V22H18V21H17V22H16V23H15V21H14V22H13V23H12V22H11V20H10V22H9V21H8V17H9Z', x: 0, y: 0, whiskers: 0, smile: false },
  { body: 'M8 16H18V17H19V18H20V19H21V22H19V21H18V23H16V22H15V23H13V21H12V23H11V22H10V19H9V21H8V20H7V17H8Z', x: 0, y: 1, whiskers: 0, smile: false },
  { body: 'M7 18H21V19H22V22H20V21H19V22H18V23H10V22H8V21H7Z', x: 1, y: 3, whiskers: 2, smile: false },
  { body: 'M11 15H17V16H18V17H19V20H18V22H17V23H14V22H12V21H11V19H10V16H11Z', x: 0, y: 0, whiskers: 1, smile: true },
  { body: 'M10 14H15V15H16V16H17V21H16V22H15V23H12V22H11V21H10V20H9V15H10Z', x: -1, y: -1, whiskers: 1, smile: true },
  { body: 'M10 14H15V15H16V16H17V17H18V19H19V21H17V23H15V22H14V23H11V22H10V20H9V21H7V18H8V17H9V15H10ZM16 20h1v1h-1z', x: -1, y: -1, whiskers: 0, smile: true },
  { body: 'M11 14H16V15H17V16H18V17H19V18H20V21H19V20H18V23H17V22H16V21H15V23H13V22H12V23H11V22H10V20H9V21H8V17H9V16H10V15H11ZM17 19h1v1h-1z', x: 0, y: -1, whiskers: 0, smile: false },
];

/** Trusted, framework-independent inline markup. No image request or DOM IDs. */
export const mona = '<svg class="giscusflare-mona" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="48" height="48" aria-hidden="true" shape-rendering="crispEdges">' + poses.map((pose, frame) =>
  '<g class="mona-pose" data-mona-frame="' + frame + '">' +
  '<path fill-rule="evenodd" d="' + pose.body + '"/>' +
  '<g transform="translate(' + pose.x + ' ' + pose.y + ')">' +
  '<path d="' + head + '"/><path class="mona-face" d="' + face + '"/>' +
  '<path d="' + eyes + mouth + (pose.smile ? smile : '') + whiskers[pose.whiskers] + '"/>' +
  '</g></g>',
).join('') + '</svg>';
