import Image from "next/image";
import { cn } from "@/lib/utils";

type BrandImageProps = {
  className?: string;
  alt?: string;
};

export function BrandLogo({ className, alt = "FormBook" }: BrandImageProps) {
  return (
    <Image
      src="/brand/formbook-lockup.png"
      width={758}
      height={130}
      alt={alt}
      unoptimized
      className={cn("inline-block h-7 w-auto max-w-full object-contain", className)}
    />
  );
}

export function BrandMark({ className, alt = "" }: BrandImageProps) {
  return (
    <Image
      src="/brand/formbook-mark.png"
      width={111}
      height={130}
      alt={alt}
      unoptimized
      className={cn("inline-block h-6 w-auto object-contain", className)}
    />
  );
}
