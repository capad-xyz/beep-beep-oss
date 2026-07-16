import type { SVGProps } from "react";

// Dooper placeholder brand mark (the initial one): a rounded speech bubble with
// an incoming tail (bottom-left) and a "D" knocked out of it, so the chip's
// color shows through the letter. Drawn in currentColor with an even-odd fill
// so it inherits whatever it sits on (white bubble on the oxblood chip).
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
      <path d="M10.5 4h11a6.5 6.5 0 0 1 6.5 6.5v6a6.5 6.5 0 0 1-6.5 6.5H12l-5 5.5 2-5.5a6.5 6.5 0 0 1-5-6.5v-6A6.5 6.5 0 0 1 10.5 4Zm2 5.2v13.6h4.2a6.8 6.8 0 0 0 0-13.6h-4.2Z" />
    </svg>
  );
}
