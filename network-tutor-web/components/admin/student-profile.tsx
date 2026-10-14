"use client";
import {useState} from "react";
import {useAdminPeriod} from "@/components/admin/service-period";
import {adminFetch} from "@/lib/admin-period";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {toast} from "@/components/chat/toast";

export interface StudentProfile {
  id:number;name:string;student_id:string|null;email:string;birthdate:string|null;department:string|null;level:string;
}
export function StudentProfileEditor({student,onSaved}:{student:StudentProfile;onSaved:(student:StudentProfile)=>void}) {
  const {readOnly}=useAdminPeriod();
  const [form,setForm]=useState({name:student.name,studentId:student.student_id??"",email:student.email,birthdate:student.birthdate?.slice(0,10)??"",department:student.department??"",level:student.level});
  const [saving,setSaving]=useState(false),[error,setError]=useState("");
  const save=async()=>{
    setSaving(true);setError("");
    try {
      const response=await adminFetch(`/api/admin/users/${student.id}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify(form)});
      const data=await response.json();if(!response.ok)throw Error(data.error??"저장하지 못했어요.");
      onSaved(data.user);toast({type:"success",description:"학생 정보를 저장했어요. 변경한 정보로 다시 로그인하면 됩니다."});
    }catch(e){setError(e instanceof Error?e.message:"저장하지 못했어요.");}finally{setSaving(false);}
  };
  return <section className="surface p-5" aria-label="학생 기본 정보">
    <h2 className="mb-3 font-semibold text-[14px]">학생 기본 정보</h2>
    <form onSubmit={e=>{e.preventDefault();void save();}}>
      <fieldset disabled={readOnly||saving} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {([{key:"name",label:"이름",type:"text",max:100},{key:"studentId",label:"학번",type:"text",max:64},{key:"email",label:"이메일",type:"email",max:254},{key:"birthdate",label:"생년월일",type:"date",max:10},{key:"department",label:"학과",type:"text",max:120}] as const).map(field=><label key={field.key} className="flex flex-col gap-1.5 text-sm">
          {field.label}<Input type={field.type} maxLength={field.max} required={!["birthdate","department"].includes(field.key)} value={form[field.key]} onChange={e=>setForm({...form,[field.key]:e.target.value})}/>
        </label>)}
        <label className="flex flex-col gap-1.5 text-sm">학습 수준
          <select className="rounded-lg border border-border bg-background px-3 py-2" value={form.level} onChange={e=>setForm({...form,level:e.target.value})}>
            <option value="beginner">입문</option><option value="intermediate">중급</option><option value="advanced">고급</option>
          </select>
        </label>
        {!readOnly&&<Button disabled={saving} type="submit" className="sm:col-span-2 sm:justify-self-start">{saving?"저장 중…":"학생 정보 저장"}</Button>}
      </fieldset>
      {error&&<p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
      {!readOnly&&<p className="mt-3 text-xs text-muted-foreground">정보 변경 시 기존 로그인은 종료됩니다. 비밀번호는 아래에서 재설정할 수 있습니다.</p>}
    </form>
  </section>;
}
