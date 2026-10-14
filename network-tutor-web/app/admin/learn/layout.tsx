"use client";
import { useAdminPeriod } from "@/components/admin/service-period";
export default function FeaturePeriodGate({
  children,
}: {
  children: React.ReactNode;
}) {
  const { period } = useAdminPeriod();
  if (period === "1")
    return (
      <p className="surface p-5 text-sm">
        이 기능은 2차부터 제공됩니다. 1차 기존 학습 기록은 학생 관리에서 계속
        조회할 수 있습니다.
      </p>
    );
  return children;
}
