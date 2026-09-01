import { ArrowLeftIcon } from "lucide-react";
import Link from "next/link";
import { Preview } from "@/components/chat/preview";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-dvh w-screen bg-sidebar">
      <div className="flex w-full flex-col bg-background p-8 xl:w-[600px] xl:shrink-0 xl:rounded-r-2xl xl:border-r xl:border-border/40 md:p-16">
        <Link
          className="flex w-fit items-center gap-1.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
          href="/"
        >
          <ArrowLeftIcon className="size-3.5" />
          Back
        </Link>
        <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-10">
          <div className="flex flex-col gap-2">
            <div className="mb-2 flex size-16 items-center justify-center rounded-2xl bg-muted/60 ring-1 ring-border/50">
              {/* biome-ignore lint/performance/noImgElement: 고정 로고 자산, next/image 불필요 */}
              <img alt="classnet" className="size-12" src="/logo.svg" />
            </div>
            {children}
          </div>
        </div>
      </div>

      <div className="hidden flex-1 flex-col overflow-hidden pl-12 xl:flex">
        <div className="flex items-center gap-1.5 pt-8 text-[13px] text-muted-foreground/50">
          <span className="font-medium text-muted-foreground">classnet</span>
          <span>· 학교 자체 호스팅 AI로 운영됩니다</span>
        </div>
        <div className="flex-1 pt-4">
          <Preview />
        </div>
      </div>
    </div>
  );
}
