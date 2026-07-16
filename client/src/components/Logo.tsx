import type { SVGProps } from "react";

// Dooper placeholder brand mark: a rounded speech bubble (incoming tail,
// bottom-left) with a bold "D" knocked out of it — the letter shows the chip's
// color through it. Drawn in currentColor with an even-odd fill so it inherits
// whatever it sits on (white bubble on the oxblood chip). Three even-odd
// contours: bubble body, the D silhouette (hole), the D counter (fill again).
// Purely a placeholder until a real identity exists.
export function Logo({ size = 24, ...rest }: { size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="currentColor"
      fillRule="evenodd"
      aria-hidden
      {...rest}
    >
      <path d="M9 3H23A6 6 0 0 1 29 9V18A6 6 0 0 1 23 24H12L6.5 29L8.5 24A6 6 0 0 1 3 18V9A6 6 0 0 1 9 3ZM11 7.5V19.5H15A6 6 0 0 0 15 7.5ZM14 10.5V16.5H15A3 3 0 0 0 15 10.5Z" />
    </svg>
  );
}
