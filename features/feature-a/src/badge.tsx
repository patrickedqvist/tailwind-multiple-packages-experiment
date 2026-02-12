export function FeatureABadge({
  label,
  variant = "default",
}: {
  label: string;
  variant?: "default" | "success" | "warning";
}) {
  const variantClasses = {
    default: "bg-blue-100 text-white",
    success: "bg-green-500 text-black",
    warning: "bg-yellow-500 text-black",
  };

  return (
    <span
      className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${variantClasses[variant]}`}
    >
      {label}
    </span>
  );
}
