type FlashAlertProps = {
  variant: "error" | "notice";
  children: React.ReactNode;
};

const VARIANT_STYLES: Record<FlashAlertProps["variant"], string> = {
  error: "border-danger/20 bg-red-50 text-danger",
  notice: "border-warning/20 bg-orange-50 text-warning",
};

export function FlashAlert({ variant, children }: FlashAlertProps) {
  return (
    <p
      className={`mb-5 max-w-xl rounded-2xl border px-4 py-3 text-sm ${VARIANT_STYLES[variant]}`}
    >
      {children}
    </p>
  );
}
