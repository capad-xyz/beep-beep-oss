import type { SVGProps } from "react";

// Dooper placeholder brand mark: a bold, optically-centered "D" monogram.
// Drawn in currentColor with an even-odd fill (the counter is a real hole), so
// it inherits whatever color it sits on — white on the oxblood chip, oxblood on
// a tint. Legible down to ~14px, where a busier bubble+letter turned to mush.
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
      <path d="M7.5 5h6a11 11 0 0 1 0 22h-6zm4.5 4.5v13h1.5a6.5 6.5 0 0 0 0-13z" />
    </svg>
  );
}
