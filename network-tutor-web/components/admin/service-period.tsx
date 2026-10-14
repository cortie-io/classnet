"use client";
import { createContext, useContext, useEffect, useState, type ComponentProps, type ReactNode } from "react";
import NextLink from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";

type Period = "1" | "2";
const PeriodContext = createContext<{period: Period; readOnly: boolean}>({period:"2",readOnly:false});
export const useAdminPeriod = () => useContext(PeriodContext);

export function AdminPeriodProvider({children}: {children:ReactNode}) {
  const search=useSearchParams();
  const [meta,setMeta]=useState<{activePeriod:Period;periods:{id:Period;name:string;readOnly:boolean;available:boolean}[]}|null>(null);
  const [error,setError]=useState(false);
  const [retry,setRetry]=useState(0);
  useEffect(()=>{
    const controller=new AbortController();
    fetch("/api/admin/periods",{cache:"no-store",signal:controller.signal}).then(async r=>{
      if(!r.ok)throw Error("조회 실패");return r.json();
    }).then(setMeta).catch(e=>{if(e.name!=="AbortError")setError(true);});
    return ()=>controller.abort();
  },[retry]);
  const requested=search.get("period");
  const period:Period=requested==="1"||requested==="2"?requested:meta?.activePeriod??"2";
  const item=meta?.periods.find(p=>p.id===period);
  if(error)return <div role="alert">차수 정보를 불러오지 못했어요. <Button onClick={()=>{setError(false);setRetry(x=>x+1);}}>다시 시도</Button></div>;
  if(!meta)return <div className="p-6 text-sm text-muted-foreground">차수 정보 불러오는 중…</div>;
  if(!item?.available)return <div role="alert" className="p-6">선택한 차수는 아직 열리지 않았습니다. <NextLink href="/admin">현재 차수로 이동</NextLink></div>;
  return <PeriodContext.Provider value={{period,readOnly:item.readOnly}}><div key={period} className="contents">{children}</div></PeriodContext.Provider>;
}
export function AdminPeriodSelector() {
  const {period,readOnly}=useAdminPeriod();
  const pathname=usePathname();const router=useRouter();
  return <div className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-4">
    <label htmlFor="service-period" className="font-semibold text-sm">서비스 차수</label>
    <select id="service-period" value={period} onChange={e=>router.push(pathname+"?period="+e.target.value)} className="rounded-md border border-border bg-background px-3 py-2 text-sm">
      <option value="1">1차 · 보관 기록</option><option value="2">2차 · 운영</option>
    </select>
    <p role="status" className="text-sm text-muted-foreground">{readOnly?"1차 기록은 동결되어 조회와 내보내기만 가능합니다.":"2차의 독립된 학습 기록과 실제 평가 순위입니다."}</p>
  </div>;
}
export function PeriodButton(props:ComponentProps<typeof Button>) {
  const {readOnly}=useAdminPeriod();
  return <Button {...props} disabled={readOnly||props.disabled}/>;
}
export function AdminLink(props:ComponentProps<typeof NextLink>) {
  const {period}=useAdminPeriod();
  let href=props.href;
  if(typeof href==="string"&&/^\/admin(?:\/|\?|$)/.test(href)) {
    const url=new URL(href,"http://admin.internal");url.searchParams.set("period",period);href=url.pathname+url.search;
  }
  return <NextLink {...props} href={href}/>;
}
