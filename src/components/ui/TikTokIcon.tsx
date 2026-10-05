import React from 'react';

/**
 * TikTok logo with the brand's "glitch" look: a cyan layer nudged up-left, a red
 * layer nudged down-right, and the note itself on top. Icon only - there is no
 * background, so it sits on whatever tile or screen it is placed on.
 *
 * The top layer uses `currentColor` (like react-icons did) so it turns white on
 * the active platform tile and takes the platform tint when inactive. The cyan
 * and red layers always keep the official brand colours.
 *
 * Sizing works both ways: `size` (px, like react-icons) or Tailwind classes such
 * as `w-12 h-12` through `className`.
 */
interface TikTokIconProps extends Omit<React.SVGProps<SVGSVGElement>, 'width' | 'height'> {
    size?: number | string;
}

// The stem is 11.8 wide (x 56.7 -> 68.5) and the top edge spans exactly that, so
// the note has clean square corners instead of a nub on the top-left.
const NOTE_PATH =
    'M56.7 12H68.5C69.4 19.6 74.1 25 79.8 26.5V38.2C75.5 37.8 71.6 36 68.5 33.2V62.7C68.5 75.8 57.9 86.4 44.8 86.4C31.6 86.4 21 75.8 21 62.7C21 49.6 31.6 39 44.8 39C46.6 39 48.3 39.2 50 39.6V51.6C48.3 51.1 46.6 50.8 44.8 50.8C38.3 50.8 33 56.1 33 62.7C33 69.3 38.3 74.6 44.8 74.6C51.4 74.6 56.7 69.3 56.7 62.7V12Z';

const OFFSET = 2.5;

// Square box centred on the artwork including both offset layers, so the icon
// fills its box the way the other platform icons do.
const VIEW_BOX = '10.4 9.2 80 80';

const TikTokIcon: React.FC<TikTokIconProps> = ({ size, className, ...rest }) => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox={VIEW_BOX}
        width={size}
        height={size}
        className={className}
        aria-hidden="true"
        focusable="false"
        {...rest}
    >
        {/* Cyan shadow: up and left */}
        <path fill="#25F4EE" transform={`translate(${-OFFSET} ${-OFFSET})`} d={NOTE_PATH} />
        {/* Red shadow: down and right */}
        <path fill="#FE2C55" transform={`translate(${OFFSET} ${OFFSET})`} d={NOTE_PATH} />
        {/* Main note */}
        <path fill="currentColor" d={NOTE_PATH} />
    </svg>
);

export default TikTokIcon;
