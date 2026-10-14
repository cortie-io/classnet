import { motion } from "framer-motion";
import { useSession } from "next-auth/react";
import { BrandMark } from "@/components/brand/logo";

const EASE = [0.22, 1, 0.36, 1] as const;

export const Greeting = () => {
  const { data } = useSession();
  const name = data?.user?.role === "student" ? data.user.name : null;

  return (
    <div className="flex flex-col items-center px-6" key="overview">
      <motion.div
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="relative mb-6"
        initial={{ opacity: 0, scale: 0.85, y: 8 }}
        transition={{ delay: 0.1, duration: 0.6, ease: EASE }}
      >
        <div className="absolute inset-0 -z-10 scale-[2.2] rounded-full bg-[radial-gradient(closest-side,oklch(0.75_0.12_277/0.35),transparent)] blur-md" />
        <BrandMark className="size-14 drop-shadow-[0_10px_24px_rgb(67_56_202/0.35)]" />
      </motion.div>
      <motion.h1
        animate={{ opacity: 1, y: 0 }}
        className="text-balance text-center font-bold text-[26px] text-foreground tracking-[-0.04em] md:text-[32px]"
        initial={{ opacity: 0, y: 10 }}
        transition={{ delay: 0.25, duration: 0.5, ease: EASE }}
      >
        {name ? (
          <>
            {name}님, <span className="text-brand">무엇을 공부해볼까요?</span>
          </>
        ) : (
          <>
            무엇이든 <span className="text-brand">물어보세요</span>
          </>
        )}
      </motion.h1>
      <motion.p
        animate={{ opacity: 1, y: 0 }}
        className="mt-3 max-w-md text-balance text-center text-[14px] text-muted-foreground leading-relaxed"
        initial={{ opacity: 0, y: 10 }}
        transition={{ delay: 0.4, duration: 0.5, ease: EASE }}
      >
        개념 설명부터 서브넷 계산, 기출 해설까지 네트워크관리사 2급 공부를
        함께할게요.
      </motion.p>
    </div>
  );
};
