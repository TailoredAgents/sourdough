import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex h-11 items-center justify-center gap-2 rounded-md px-4 text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        primary:
          "bg-[#23443b] text-white hover:bg-[#1b342d] focus-visible:outline-[#23443b]",
        secondary:
          "border border-stone-300 bg-white text-stone-950 hover:bg-stone-50 focus-visible:outline-stone-500",
        ghost: "text-stone-800 hover:bg-stone-100 focus-visible:outline-stone-500",
        warm: "bg-[#a94334] text-white hover:bg-[#8d372a] focus-visible:outline-[#a94334]",
      },
      size: {
        default: "h-11 px-4",
        sm: "h-9 px-3",
        lg: "h-12 px-5 text-base",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "default",
    },
  },
);

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants>;

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return (
    <button
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export function buttonClassName({
  className,
  variant,
  size,
}: VariantProps<typeof buttonVariants> & { className?: string }) {
  return buttonVariants({ variant, size, className });
}
