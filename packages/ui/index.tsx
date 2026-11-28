import type { HTMLAttributes, ReactNode } from "react";

type LayoutProps = HTMLAttributes<HTMLDivElement>;

export function Surface({ tone = "paper", className = "", ...props }: LayoutProps & { tone?: "paper" | "forest" }) {
  return <div {...props} className={`fb-jardin ${className}`} data-surface={tone} />;
}

export function Stack({ className = "", ...props }: LayoutProps) {
  return <div {...props} className={`fb-stack ${className}`} />;
}

export function Cluster({ className = "", ...props }: LayoutProps) {
  return <div {...props} className={`fb-cluster ${className}`} />;
}

export function Metric({ label, value }: { label: string; value: ReactNode }) {
  return <dl className="fb-kpi"><dt>{label}</dt><dd>{value}</dd></dl>;
}
